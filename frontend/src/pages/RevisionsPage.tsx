import { Button, Card, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { listRevisionsOverview } from "../api";
import type { RevisionOverviewItem } from "../types";

interface Props {
  onOpenRevision: (target: { project_code: string; document_num: string; revision_id: number }) => void;
}

export default function RevisionsPage({ onOpenRevision }: Props): JSX.Element {
  const [items, setItems] = useState<RevisionOverviewItem[]>([]);

  const load = async () => {
    try {
      setItems(await listRevisionsOverview());
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить ревизии";
      message.error(text);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns: ColumnsType<RevisionOverviewItem> = [
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 90 },
    { title: "Документ", dataIndex: "document_num", key: "document_num" },
    { title: "Название", dataIndex: "document_title", key: "document_title" },
    { title: "Рев", dataIndex: "revision_code", key: "revision_code", width: 70 },
    {
      title: "Автор ревизии",
      key: "author",
      width: 260,
      render: (_, row) => (row.author_email ? `${row.author_name ?? "—"} (${row.author_email})` : "—"),
    },
    { title: "Статус", dataIndex: "status", key: "status", width: 220 },
    { title: "TRM", dataIndex: "trm_number", key: "trm_number", width: 220, render: (v: string | null) => v ?? "—" },
    { title: "Срок", dataIndex: "review_deadline", key: "review_deadline", width: 130, render: (v: string | null) => v ?? "—" },
    {
      title: "Ссылка",
      key: "link",
      render: (_, row) => (
        <Button
          type="link"
          onClick={() => onOpenRevision({ project_code: row.project_code, document_num: row.document_num, revision_id: row.revision_id })}
        >
          Карточка ревизии
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Ревизии
        </Typography.Title>
        <Button onClick={() => void load()}>Обновить</Button>
      </Space>
      <Card>
        <Table rowKey="revision_id" columns={columns} dataSource={items} pagination={{ pageSize: 12 }} scroll={{ x: "max-content" }} />
      </Card>
    </div>
  );
}
