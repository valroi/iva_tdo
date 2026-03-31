import { Button, Card, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { deleteMySession, listMySessions } from "../api";
import type { UserSession } from "../types";

export default function SessionsPage(): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<UserSession[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listMySessions();
      setSessions(data);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка загрузки сессий";
      message.error(text);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns: ColumnsType<UserSession> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    { title: "IP", dataIndex: "ip_address", key: "ip_address", render: (v) => v ?? "—" },
    { title: "Страна", dataIndex: "country", key: "country", render: (v) => v ?? "—" },
    {
      title: "Устройство (UA)",
      dataIndex: "user_agent",
      key: "user_agent",
      render: (v) => (v ? v.slice(0, 40) + (v.length > 40 ? "…" : "") : "—"),
    },
    { title: "Создана", dataIndex: "created_at", key: "created_at" },
    { title: "Последняя активность", dataIndex: "last_seen_at", key: "last_seen_at" },
    {
      title: "Статус",
      key: "status",
      render: (_, row) => (
        <Tag color={row.is_active ? "green" : "default"}>{row.is_active ? "ACTIVE" : "REVOKED/EXPIRED"}</Tag>
      ),
    },
    {
      title: "Действие",
      key: "actions",
      render: (_, row) => (
        <Button
          size="small"
          danger
          disabled={!row.is_active}
          onClick={async () => {
            try {
              await deleteMySession(row.id);
              message.success("Сессия отключена");
              await load();
            } catch (error) {
              const text = error instanceof Error ? error.message : "Ошибка отключения сессии";
              message.error(text);
            }
          }}
        >
          Удалить сессию
        </Button>
      ),
    },
  ];

  return (
    <div className="sessions-module">
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Сессии входа
        </Typography.Title>
      </Space>
      <Card className="hrp-card">
        <Table rowKey="id" loading={loading} size="small" columns={columns} dataSource={sessions} pagination={false} />
      </Card>
    </div>
  );
}

