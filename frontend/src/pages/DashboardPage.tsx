import { Button, Card, Col, Row, Space, Statistic, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { listDocumentsRegistry, listProjectMembers } from "../api";
import { formatDateTimeRu } from "../utils/datetime";

import type { DocumentItem, DocumentRegistryItem, MDRRecord, NotificationItem, ProjectItem, ProjectMemberRole, User } from "../types";

interface Props {
  mdr: MDRRecord[];
  documents: DocumentItem[];
  projects: ProjectItem[];
  notifications: NotificationItem[];
  currentUser: User;
  onNavigate: (
    target: "documents_registry" | "notifications" | "trm" | "tdo_queue" | "crs_queue" | "revision_card",
    revisionId?: number | null,
    options?: { overdueOnly?: boolean },
  ) => void;
}

export default function DashboardPage({
  mdr,
  documents,
  projects,
  notifications,
  currentUser,
  onNavigate,
}: Props): JSX.Element {
  const [overdueDocs, setOverdueDocs] = useState<DocumentRegistryItem[]>([]);
  const [projectRoles, setProjectRoles] = useState<Array<{ project_code: string; project_name: string; role: ProjectMemberRole }>>([]);
  const activeNotifications = notifications.filter((n) => !n.is_read);
  const unread = activeNotifications.length;
  const myTasks = activeNotifications.slice(0, 12);
  const parseCommentContext = (message: string): { author: string } => {
    const authorMatch = message.match(/Автор:\s*([^\.]+)/i);
    return {
      author: authorMatch?.[1]?.trim() ?? "—",
    };
  };
  const eventTitleMap: Record<string, string> = {
    TDO_SENT_TO_OWNER: "Новая ревизия на рассмотрении",
    OWNER_COMMENT_CREATED: "Новое замечание по ревизии",
    OWNER_COMMENTS_PUBLISHED: "Замечания отправлены подрядчику",
    OWNER_COMMENT_PUBLISHED: "Замечание отправлено подрядчику",
    NEW_COMMENT: "Новый комментарий",
    COMMENT_RESPONSE: "Получен ответ на замечание",
    REVISION_UPLOADED_FOR_TDO: "Ревизия ожидает решение ТДО",
    NEW_REVISION_FOR_TDO: "Новая ревизия в очереди ТДО",
    DOC_OVERDUE_PLAN_START: "Просрочка старта разработки",
  };
  useEffect(() => {
    if (!currentUser.permissions.can_process_tdo_queue) return;
    listDocumentsRegistry({ overdue_only: true, comments_scope: "ANY" })
      .then((rows) => setOverdueDocs(rows))
      .catch(() => setOverdueDocs([]));
  }, [currentUser.permissions.can_process_tdo_queue]);
  useEffect(() => {
    let cancelled = false;
    const loadRoles = async (): Promise<void> => {
      try {
        const memberships = await Promise.all(
          projects.map(async (project) => {
            const members = await listProjectMembers(project.id);
            const mine = members.find((item) => item.user_id === currentUser.id);
            if (!mine) return null;
            return {
              project_code: project.code,
              project_name: project.name,
              role: mine.member_role,
            };
          }),
        );
        if (!cancelled) {
          setProjectRoles(memberships.filter((item): item is { project_code: string; project_name: string; role: ProjectMemberRole } => item !== null));
        }
      } catch {
        if (!cancelled) setProjectRoles([]);
      }
    };
    void loadRoles();
    return () => {
      cancelled = true;
    };
  }, [projects, currentUser.id]);
  const projectRoleLabel: Record<ProjectMemberRole, string> = {
    main_admin: "Главный администратор",
    contractor_tdo_lead: "ТДО разработчика",
    contractor_member: "Участник разработчика",
    owner_member: "R/LR заказчика",
    observer: "Наблюдатель",
  };
  const openByNotification = (item: NotificationItem): void => {
    if (item.event_type === "REVISION_UPLOADED_FOR_TDO" || item.event_type === "NEW_REVISION_FOR_TDO") {
      onNavigate(currentUser.company_type === "owner" ? "trm" : "tdo_queue");
      return;
    }
    if (item.event_type === "OWNER_COMMENTS_PUBLISHED" && currentUser.permissions.can_publish_comments) {
      onNavigate("crs_queue");
      return;
    }
    if (item.revision_id) {
      onNavigate("revision_card", item.revision_id);
      return;
    }
    onNavigate("notifications");
  };
  const taskColumns: ColumnsType<NotificationItem> = [
    {
      title: "Задача",
      key: "message",
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{eventTitleMap[row.event_type] ?? "Уведомление по процессу"}</Typography.Text>
          <Typography.Text>{row.message}</Typography.Text>
        </Space>
      ),
    },
    { title: "Дата создания", dataIndex: "created_at", key: "created_at", width: 170, render: (v) => formatDateTimeRu(v) },
    { title: "Дедлайн", dataIndex: "task_deadline", key: "task_deadline", width: 130, render: (v) => formatDateTimeRu(v) },
    {
      title: "От кого",
      key: "author_status",
      width: 220,
      render: (_, row) => {
        const meta = parseCommentContext(row.message);
        return (
          <Space direction="vertical" size={2}>
            <Typography.Text type="secondary">Автор: {meta.author}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: "Действие",
      key: "action",
      width: 120,
      render: (_, row) => (
        <Button size="small" onClick={() => openByNotification(row)}>
          Открыть
        </Button>
      ),
    },
  ];

  return (
    <div className="dashboard-module">
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card className="hrp-card dashboard-stat-card" hoverable onClick={() => onNavigate("documents_registry")}>
            <Statistic title="Документы" value={documents.length || mdr.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="hrp-card dashboard-stat-card" hoverable onClick={() => onNavigate("notifications")}>
            <Statistic title="Уведомления" value={activeNotifications.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card className="hrp-card dashboard-stat-card" hoverable onClick={() => onNavigate("notifications")}>
            <Statistic title="Непрочитанные" value={unread} valueStyle={{ color: unread > 0 ? "#cf1322" : "#3f8600" }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card
            className="hrp-card dashboard-stat-card"
            hoverable
            onClick={() => onNavigate(currentUser.permissions.can_publish_comments ? "crs_queue" : "notifications")}
          >
            <Statistic
              title="Задачи по замечаниям"
              value={myTasks.length}
            />
          </Card>
        </Col>
        {currentUser.permissions.can_process_tdo_queue && (
          <Col span={6}>
            <Card
              className="hrp-card dashboard-stat-card"
              hoverable
              onClick={() => onNavigate("documents_registry", null, { overdueOnly: true })}
            >
              <Statistic title="Просроченные документы" value={overdueDocs.length} valueStyle={{ color: overdueDocs.length > 0 ? "#cf1322" : "#3f8600" }} />
            </Card>
          </Col>
        )}
      </Row>
      <Card title={`Мои задачи по роли (${currentUser.company_type})`} className="hrp-card" style={{ marginTop: 16 }}>
        <Table
          columns={taskColumns}
          dataSource={myTasks}
          pagination={false}
          size="small"
          rowKey="id"
          onRow={(record) => ({ onDoubleClick: () => openByNotification(record) })}
        />
      </Card>
      <Card title="Профиль и роли в проектах" className="hrp-card" style={{ marginTop: 16 }}>
        <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 12 }}>
          <Typography.Text>
            <b>ФИО:</b> {currentUser.full_name || "—"}
          </Typography.Text>
          <Typography.Text>
            <b>Email:</b> {currentUser.email}
          </Typography.Text>
        </Space>
        <Table
          rowKey={(row) => `${row.project_code}_${row.role}`}
          size="small"
          pagination={false}
          dataSource={projectRoles}
          locale={{ emptyText: "Нет назначенных ролей в проектах" }}
          columns={[
            { title: "Проект", key: "project", render: (_, row) => `${row.project_code} - ${row.project_name}` },
            { title: "Роль", dataIndex: "role", key: "role", render: (value: ProjectMemberRole) => projectRoleLabel[value] ?? value },
          ]}
        />
      </Card>
    </div>
  );
}
