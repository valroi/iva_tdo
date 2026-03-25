import { Badge, Button, Card, Space, Spin, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { listComments, listRevisions } from "../api";
import type { CommentItem, DocumentItem, MDRRecord, NotificationItem, Revision, User } from "../types";

interface TaskRow {
  key: string;
  source: "notification" | "comment";
  kind: "review" | "response" | "info";
  title: string;
  status: string;
  meta: string;
}

interface Props {
  currentUser: User;
  notifications: NotificationItem[];
  documents: DocumentItem[];
  mdr: MDRRecord[];
}

function commentStatusToTaskKind(status: CommentItem["status"], isContractor: boolean): TaskRow["kind"] {
  if (isContractor && status === "OPEN") {
    return "response";
  }
  if (!isContractor && status === "IN_PROGRESS") {
    return "review";
  }
  return "info";
}

export default function MyTasksPage({ currentUser, notifications, documents, mdr }: Props): JSX.Element {
  const isContractor = currentUser.company_type === "contractor";
  const isOwner = currentUser.company_type === "owner";
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadTaskData = async () => {
      setLoading(true);
      try {
        const revisionsChunks = await Promise.all(documents.map((doc) => listRevisions(doc.id)));
        const allRevisions = revisionsChunks.flat();
        setRevisions(allRevisions);

        const commentsChunks = await Promise.all(allRevisions.map((rev) => listComments(rev.id)));
        setComments(commentsChunks.flat());
      } catch (error: unknown) {
        const text = error instanceof Error ? error.message : "Не удалось загрузить задачи";
        message.error(text);
        setRevisions([]);
        setComments([]);
      } finally {
        setLoading(false);
      }
    };
    void loadTaskData();
  }, [documents]);

  const rows = useMemo(() => {
    const revisionById = new Map(revisions.map((r) => [r.id, r]));
    const documentById = new Map(documents.map((d) => [d.id, d]));
    const mdrById = new Map(mdr.map((row) => [row.id, row]));

    const fromComments: TaskRow[] = comments.map((comment) => {
      const revision = revisionById.get(comment.revision_id);
      const document = revision ? documentById.get(revision.document_id) : undefined;
      const mdrRow = document ? mdrById.get(document.mdr_id) : undefined;

      return {
        key: `comment-${comment.id}`,
        source: "comment",
        kind: commentStatusToTaskKind(comment.status, isContractor),
        title: `Комментарий #${comment.id}: ${comment.text}`,
        status: comment.status,
        meta: `${mdrRow?.project_code ?? "—"} / ${document?.document_num ?? "—"} / Rev ${revision?.revision_code ?? "—"}`,
      };
    });

    const fromNotifications: TaskRow[] = notifications.map((item) => ({
      key: `notification-${item.id}`,
      source: "notification",
      kind: item.event_type.includes("COMMENT") ? (isContractor ? "response" : "review") : "info",
      title: item.message,
      status: item.is_read ? "READ" : "NEW",
      meta: item.event_type,
    }));

    const merged = [...fromComments, ...fromNotifications];
    if (isOwner) {
      merged.sort((a, b) => (a.kind === "review" ? -1 : 1) - (b.kind === "review" ? -1 : 1));
    }
    return merged;
  }, [comments, currentUser.company_type, documents, isContractor, isOwner, mdr, notifications, revisions]);

  const pendingCount = rows.filter((row) => row.status === "OPEN" || row.status === "NEW" || row.status === "IN_PROGRESS").length;

  const columns: ColumnsType<TaskRow> = [
    {
      title: "Тип задачи",
      dataIndex: "kind",
      key: "kind",
      width: 180,
      render: (value: TaskRow["kind"]) => {
        if (value === "response") return <Tag color="orange">Исправить / Respond</Tag>;
        if (value === "review") return <Tag color="blue">Проверить / Review</Tag>;
        return <Tag>Инфо / Info</Tag>;
      },
    },
    { title: "Задача", dataIndex: "title", key: "title" },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      width: 140,
      render: (value: string) => {
        if (value === "OPEN" || value === "NEW") return <Tag color="red">{value}</Tag>;
        if (value === "IN_PROGRESS") return <Tag color="gold">{value}</Tag>;
        if (value === "RESOLVED" || value === "READ") return <Tag color="green">{value}</Tag>;
        return <Tag>{value}</Tag>;
      },
    },
    { title: "Контекст", dataIndex: "meta", key: "meta", width: 360 },
  ];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={12}>
      <Card>
        <Space style={{ justifyContent: "space-between", width: "100%" }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Мои задачи / My Tasks
            </Typography.Title>
            <Typography.Text type="secondary">
              Для разработчиков: задачи на исправление и ответы. Для заказчика: просмотр и комментарии.
            </Typography.Text>
          </div>
          <Badge count={pendingCount} showZero>
            <Button>Активные задачи</Button>
          </Badge>
        </Space>
      </Card>

      {loading ? <Spin /> : <Table rowKey="key" columns={columns} dataSource={rows} />}
    </Space>
  );
}
