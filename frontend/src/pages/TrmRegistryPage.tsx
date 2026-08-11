import { Button, Card, Space, Table, Tag, Tooltip, Typography, App } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { downloadTrmTransmittal, listTrm } from "../api";
import type { TrmListItem, TrmRevisionItem } from "../api";
import type { User } from "../types";
import { formatDateRu, formatDeadlineRu } from "../utils/datetime";
import { paginationProps } from "../utils/pagination";

interface Props {
  currentUser: User;
  onOpenRevision: (target: { revision_id: number }) => void;
  focusTrm?: string | null;
  onFocusHandled?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  REVISION_CREATED: "Ревизия создана",
  UPLOADED_WAITING_TDO: "Загружен PDF (ожидает ТДО)",
  UNDER_REVIEW: "На рассмотрении заказчиком",
  OWNER_COMMENTS_SENT: "Замечания отправлены подрядчику (CRS)",
  CONTRACTOR_REPLY_I: "Ответ подрядчика (обсуждение)",
  CONTRACTOR_REPLY_A: "Ответ подрядчика (принято)",
  CANCELLED_BY_TDO: "Отклонено ТДО",
  SUBMITTED: "Выпущено",
};

function codeTag(code: string | null): React.ReactNode {
  if (!code) return "—";
  const color = code === "AP" ? "green" : code === "AN" ? "blue" : code === "CO" ? "orange" : code === "RJ" ? "red" : "default";
  return <Tag color={color}>{code}</Tag>;
}

export default function TrmRegistryPage({ currentUser: _currentUser, onOpenRevision, focusTrm, onFocusHandled }: Props): JSX.Element {
  const { message } = App.useApp();
  const [items, setItems] = useState<TrmListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyTrm, setBusyTrm] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const load = () => {
    setLoading(true);
    listTrm()
      .then(setItems)
      .catch((error) => message.error(error instanceof Error ? error.message : "Не удалось загрузить ТРМ"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Раскрыть ТРМ, на который пришли по ссылке.
  useEffect(() => {
    if (focusTrm && items.some((t) => t.trm_number === focusTrm)) {
      setExpandedKeys((prev) => (prev.includes(focusTrm) ? prev : [...prev, focusTrm]));
      onFocusHandled?.();
    }
  }, [focusTrm, items, onFocusHandled]);

  const revisionColumns: ColumnsType<TrmRevisionItem> = useMemo(
    () => [
      {
        title: "Документ",
        dataIndex: "document_num",
        width: 300,
        render: (value: string, row) => (
          <Button type="link" className="mono" style={{ padding: 0 }} onClick={() => onOpenRevision({ revision_id: row.revision_id })}>
            <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 280 }}>{value}</Typography.Text>
          </Button>
        ),
      },
      { title: "Название", dataIndex: "document_title", ellipsis: true, render: (v) => v || "—" },
      { title: "Рев", dataIndex: "revision_code", width: 70 },
      { title: "Цель", dataIndex: "issue_purpose", width: 90 },
      { title: "Статус", dataIndex: "status", width: 240, render: (v: string) => STATUS_LABEL[v] ?? v },
      { title: "Код замечаний", dataIndex: "review_code", width: 130, render: (v: string | null) => codeTag(v) },
    ],
    [onOpenRevision],
  );

  const columns: ColumnsType<TrmListItem> = [
    { title: "ТРМ", dataIndex: "trm_number", render: (v: string) => <Typography.Text strong className="mono">{v}</Typography.Text> },
    { title: "Проект", dataIndex: "project_code", width: 100 },
    { title: "Кол-во документов", dataIndex: "document_count", width: 160 },
    { title: "Последний статус", dataIndex: "last_status", width: 260, render: (v: string | null) => (v ? STATUS_LABEL[v] ?? v : "—") },
    { title: "Дедлайн", dataIndex: "review_deadline", width: 150, render: (v: string | null) => formatDeadlineRu(v) },
    {
      title: "Действие",
      key: "action",
      width: 200,
      render: (_, row) => (
        <Tooltip title="Скачать сопроводительный лист ТРМ (Excel) со списком документов">
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={busyTrm === row.trm_number}
            onClick={async () => {
              setBusyTrm(row.trm_number);
              try {
                await downloadTrmTransmittal(row.trm_number);
              } catch (error) {
                message.error(error instanceof Error ? error.message : "Не удалось сформировать сопроводиловку");
              } finally {
                setBusyTrm(null);
              }
            }}
          >
            Сопроводиловка (Excel)
          </Button>
        </Tooltip>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>ТРМ</Typography.Title>
        <Button onClick={load}>Обновить</Button>
      </Space>
      <Card className="hrp-card">
        <Table<TrmListItem>
          rowKey="trm_number"
          loading={loading}
          columns={columns}
          dataSource={items}
          size="small"
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys as string[]),
            expandedRowRender: (row) => (
              <Table<TrmRevisionItem>
                rowKey="revision_id"
                columns={revisionColumns}
                dataSource={row.revisions}
                size="small"
                pagination={false}
              />
            ),
          }}
          pagination={paginationProps("trm_registry")}
          locale={{ emptyText: "ТРМ по вашим проектам пока нет." }}
        />
      </Card>
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
        Дата: {formatDateRu(new Date().toISOString())}
      </Typography.Text>
    </div>
  );
}
