import { Button, Card, Descriptions, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";

import { getRevisionCard } from "../api";
import type { RevisionCard } from "../types";

interface Props {
  revisionId: number;
  onBack: () => void;
}

export default function RevisionCardPage({ revisionId, onBack }: Props): JSX.Element {
  const [card, setCard] = useState<RevisionCard | null>(null);

  useEffect(() => {
    getRevisionCard(revisionId)
      .then(setCard)
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "Не удалось открыть карточку ревизии";
        message.error(text);
      });
  }, [revisionId]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={onBack}>Назад</Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Карточка документа
        </Typography.Title>
      </Space>

      <Card style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="Проект">{card?.project_code ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Документ">{card?.document_num ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Название">{card?.document_title ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Категория">{card?.category ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Дисциплина">{card?.discipline_code ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Тип">{card?.doc_type ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Статус последней ревизии">
            {card?.revisions.length ? card.revisions[card.revisions.length - 1].status : "—"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Иерархия ревизий" style={{ marginBottom: 12 }}>
        <Table
          rowKey="id"
          dataSource={card?.revisions ?? []}
          pagination={false}
          size="small"
          columns={[
            { title: "ID", dataIndex: "id", width: 80 },
            { title: "Рев", dataIndex: "revision_code", width: 90 },
            { title: "Цель", dataIndex: "issue_purpose", width: 120 },
            { title: "Статус", dataIndex: "status", width: 220 },
            { title: "TRM", dataIndex: "trm_number", render: (v: string | null) => v ?? "—" },
            { title: "Создана", dataIndex: "created_at", width: 180 },
          ]}
          scroll={{ x: "max-content" }}
        />
      </Card>

      <Card title="Таблица ревизий и комментариев (по нарастанию)">
        <Table
          rowKey="revision_id"
          dataSource={card?.history ?? []}
          pagination={false}
          expandable={{
            expandedRowRender: (row) => (
              <Table
                rowKey="id"
                dataSource={row.comments}
                pagination={false}
                size="small"
                columns={[
                  { title: "ID", dataIndex: "id", width: 80 },
                  { title: "Текст", dataIndex: "text" },
                  {
                    title: "Статус",
                    dataIndex: "status",
                    width: 140,
                    render: (value: string) => <Tag>{value}</Tag>,
                  },
                  { title: "Лист", dataIndex: "page", width: 90, render: (v: number | null) => v ?? "—" },
                  { title: "Создан", dataIndex: "created_at", width: 180 },
                ]}
                scroll={{ x: "max-content", y: 260 }}
              />
            ),
          }}
          columns={[
            { title: "Ревизия", dataIndex: "revision_code", width: 100 },
            { title: "Статус ревизии", dataIndex: "status", width: 220 },
            { title: "Комментариев", key: "comments_count", width: 120, render: (_, row) => row.comments.length },
            { title: "Дата", dataIndex: "created_at", width: 180 },
          ]}
          scroll={{ x: "max-content" }}
        />
      </Card>
    </div>
  );
}
