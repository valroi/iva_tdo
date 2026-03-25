import { Button, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { markNotificationRead } from "../api";
import type { NotificationItem } from "../types";

interface Props {
  notifications: NotificationItem[];
  onReload: () => Promise<void>;
}

export default function NotificationsPage({ notifications, onReload }: Props): JSX.Element {
  const columns: ColumnsType<NotificationItem> = [
    { title: "Тип", dataIndex: "event_type", key: "event_type" },
    { title: "Сообщение", dataIndex: "message", key: "message" },
    {
      title: "Прочитано",
      dataIndex: "is_read",
      key: "is_read",
      render: (value: boolean) => (value ? <Tag color="green">YES</Tag> : <Tag color="red">NO</Tag>),
    },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Button
          size="small"
          disabled={row.is_read}
          onClick={async () => {
            await markNotificationRead(row.id);
            await onReload();
          }}
        >
          Отметить
        </Button>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Уведомления
        </Typography.Title>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={notifications} />
    </>
  );
}
