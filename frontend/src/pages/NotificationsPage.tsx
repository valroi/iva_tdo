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
    { title: "Type", dataIndex: "event_type", key: "event_type" },
    { title: "Message", dataIndex: "message", key: "message" },
    {
      title: "Read",
      dataIndex: "is_read",
      key: "is_read",
      render: (value: boolean) => (value ? <Tag color="green">YES</Tag> : <Tag color="red">NO</Tag>),
    },
    {
      title: "Action",
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
          Mark read
        </Button>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Notifications
        </Typography.Title>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={notifications} />
    </>
  );
}
