import { Alert, Button, Card, Descriptions, Space, Spin, Tag, Timeline, Typography, App } from "antd";
import { DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

import { downloadCommentAttachment, getRemarkCard } from "../api";
import type { RemarkCard } from "../api";
import { formatDateTimeRu } from "../utils/datetime";

interface Props {
  remarkNumber: string;
  onBack: () => void;
  onOpenRevision: (revisionId: number) => void;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Открыто",
  IN_PROGRESS: "В работе",
  RESOLVED: "Устранено",
  REJECTED: "Отклонено",
};

const KIND_COLOR: Record<string, string> = {
  CREATED: "blue",
  CRS_SENT: "cyan",
  CONTRACTOR_REPLY: "gold",
  LR_DECISION: "green",
  CARRY_OVER: "gray",
};

function codeTag(code: string | null): React.ReactNode {
  if (!code) return "—";
  const color = code === "AP" ? "green" : code === "AN" ? "blue" : code === "CO" ? "orange" : "red";
  return <Tag color={color}>{code}</Tag>;
}

export default function RemarkCardPage({ remarkNumber, onBack, onOpenRevision }: Props): JSX.Element {
  const { message } = App.useApp();
  const [card, setCard] = useState<RemarkCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRemarkCard(remarkNumber)
      .then((data) => {
        if (!cancelled) setCard(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить замечание");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [remarkNumber]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button onClick={onBack}>Назад</Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Замечание <span className="mono">{remarkNumber}</span>
        </Typography.Title>
        {card && (
          <Button onClick={() => onOpenRevision(card.revision_id)}>Открыть карточку документа</Button>
        )}
      </Space>

      {loading && <Spin />}
      {error && <Alert type="error" showIcon message={error} />}

      {card && !loading && (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Card className="hrp-card" title="Замечание">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Номер">
                <Typography.Text className="mono" copyable>{card.remark_number ?? "—"}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Код">{codeTag(card.review_code)}</Descriptions.Item>
              <Descriptions.Item label="Документ">
                <Typography.Text className="mono">{card.document_num}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Название">{card.document_title || "—"}</Descriptions.Item>
              <Descriptions.Item label="Ревизия">
                {card.revision_code} ({card.issue_purpose})
              </Descriptions.Item>
              <Descriptions.Item label="Лист">{card.page ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Автор">{card.author_name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Создано">{formatDateTimeRu(card.created_at)}</Descriptions.Item>
              <Descriptions.Item label="Статус">{STATUS_LABEL[card.status] ?? card.status}</Descriptions.Item>
              <Descriptions.Item label="Ответ подрядчика">
                {card.contractor_status === "A"
                  ? "Принято (A)"
                  : card.contractor_status === "I"
                    ? "Не согласен (I)"
                    : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="CRS">
                {card.crs_number ? (
                  <Typography.Text className="mono">{card.crs_number}</Typography.Text>
                ) : card.is_published_to_contractor ? (
                  "передано"
                ) : (
                  "не передано подрядчику"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Передано">{formatDateTimeRu(card.crs_sent_at)}</Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
              {card.text}
            </Typography.Paragraph>
            {card.attachments.length > 0 && (
              <Space style={{ marginTop: 10 }} wrap>
                {card.attachments.map((file) => (
                  <Button
                    key={file.id}
                    size="small"
                    icon={<PaperClipOutlined />}
                    onClick={async () => {
                      try {
                        await downloadCommentAttachment(file.id, file.file_name);
                      } catch (err) {
                        message.error(err instanceof Error ? err.message : "Не удалось скачать файл");
                      }
                    }}
                  >
                    {file.file_name}
                  </Button>
                ))}
              </Space>
            )}
          </Card>

          <Card className="hrp-card" title="История замечания">
            <Timeline
              items={card.history.map((event) => ({
                color: KIND_COLOR[event.kind] ?? "gray",
                children: (
                  <Space direction="vertical" size={2}>
                    <Typography.Text strong>{event.title}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTimeRu(event.at)}
                      {event.actor ? ` · ${event.actor}` : ""}
                    </Typography.Text>
                    {event.detail && <Typography.Text>{event.detail}</Typography.Text>}
                  </Space>
                ),
              }))}
            />
          </Card>
        </Space>
      )}
      {!loading && !error && !card && (
        <Alert type="info" showIcon icon={<DownloadOutlined />} message="Замечание не найдено" />
      )}
    </div>
  );
}
