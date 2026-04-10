import { Button, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";

import { markNotificationRead } from "../api";
import type { NotificationItem } from "../types";
import { formatDateTimeRu } from "../utils/datetime";

interface Props {
  notifications: NotificationItem[];
  onReload: () => Promise<void>;
  onOpenTarget: (item: NotificationItem) => void;
}

export default function NotificationsPage({ notifications, onReload, onOpenTarget }: Props): JSX.Element {
  const activeNotifications = useMemo(
    () => notifications.filter((item) => !item.is_read),
    [notifications],
  );
  const archivedNotifications = useMemo(
    () => notifications.filter((item) => item.is_read),
    [notifications],
  );

  const eventTag = (eventType: string): { color: string; label: string } => {
    if (eventType.includes("TDO")) return { color: "blue", label: "TDO" };
    if (eventType.includes("OWNER") || eventType.includes("COMMENT")) return { color: "purple", label: "COMMENTS" };
    if (eventType.includes("REVISION")) return { color: "geekblue", label: "REVISION" };
    return { color: "default", label: eventType };
  };

  const columns: ColumnsType<NotificationItem> = [
    {
      title: "Тип",
      dataIndex: "event_type",
      key: "event_type",
      render: (value: string) => {
        const tag = eventTag(value);
        return <Tag color={tag.color}>{tag.label}</Tag>;
      },
    },
    { title: "Сообщение", dataIndex: "message", key: "message" },
    {
      title: "Дата задачи",
      dataIndex: "created_at",
      key: "created_at",
      width: 150,
      render: (v: string) => formatDateTimeRu(v),
    },
    {
      title: "Срок",
      dataIndex: "task_deadline",
      key: "task_deadline",
      width: 130,
      render: (v: string | null | undefined) => formatDateTimeRu(v),
    },
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
        <Space>
          <Button
            size="small"
            disabled={!row.project_code || !row.document_num}
            onClick={() => onOpenTarget(row)}
          >
            Открыть
          </Button>
          <Button
            size="small"
            disabled={row.is_read}
            onClick={async () => {
              await markNotificationRead(row.id);
              await onReload();
            }}
          >
            Отработано
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="notifications-module">
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Уведомления
        </Typography.Title>
      </Space>
      <Tabs
        items={[
          {
            key: "active",
            label: `Активные (${activeNotifications.length})`,
            children: <Table rowKey="id" columns={columns} dataSource={activeNotifications} size="small" />,
          },
          {
            key: "archive",
            label: `Архив (${archivedNotifications.length})`,
            children: <Table rowKey="id" columns={columns} dataSource={archivedNotifications} size="small" />,
          },
        ]}
      />
    </div>
  );
}
