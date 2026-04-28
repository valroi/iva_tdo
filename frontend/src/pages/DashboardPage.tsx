import { Button, Card, Col, Row, Space, Statistic, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { listDocumentsRegistry, listOwnerReviewQueue, listProjectMembers, listReviewMatrix, listRevisionsOverview } from "../api";
import { formatDateTimeRu } from "../utils/datetime";

import type { DocumentItem, DocumentRegistryItem, MDRRecord, NotificationItem, ProjectItem, ProjectMemberRole, RevisionOverviewItem, TdoQueueItem, User } from "../types";

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
  type DashboardTask = {
    id: string;
    event_type: string;
    message: string;
    created_at: string;
    task_deadline: string | null;
    revision_id: number | null;
    project_code: string | null;
  };
  const [overdueDocs, setOverdueDocs] = useState<DocumentRegistryItem[]>([]);
  const [projectRoles, setProjectRoles] = useState<Array<{ project_code: string; project_name: string; role: ProjectMemberRole; role_label: string }>>([]);
  const [ownerReviewTasks, setOwnerReviewTasks] = useState<DashboardTask[]>([]);
  const [developerWorkItems, setDeveloperWorkItems] = useState<RevisionOverviewItem[]>([]);
  const activeNotifications = notifications.filter((n) => !n.is_read);
  const unread = activeNotifications.length;
  const notificationTasks: DashboardTask[] = activeNotifications.map((item) => ({
    id: `notif_${item.id}`,
    event_type: item.event_type,
    message: item.message,
    created_at: item.created_at,
    task_deadline: item.task_deadline,
    revision_id: item.revision_id ?? null,
    project_code: item.project_code ?? null,
  }));
  const myTasks = [...ownerReviewTasks, ...notificationTasks].slice(0, 12);
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
    OWNER_REVIEW_PENDING: "Требуется отработка замечаний до отправки CRS",
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
            const baseLabelByRole: Record<ProjectMemberRole, string> = {
              main_admin: "Главный администратор",
              contractor_tdo_lead: "ТДО разработчика",
              contractor_member: "Разработчик подрядчика",
              owner_member: "R/LR заказчика",
              observer: "Наблюдатель",
            };
            if (mine.member_role === "owner_member") {
              const matrix = await listReviewMatrix(project.id);
              const ownRows = matrix.filter((row) => row.user_id === currentUser.id && row.level === 1);
              if (ownRows.length > 0) {
                return ownRows.map((row) => ({
                  project_code: project.code,
                  project_name: project.name,
                  role: mine.member_role,
                  role_label: `${row.state} по дисциплине ${row.discipline_code}`,
                }));
              }
            }
            return {
              project_code: project.code,
              project_name: project.name,
              role: mine.member_role,
              role_label: baseLabelByRole[mine.member_role] ?? mine.member_role,
            };
          }),
        );
        if (!cancelled) {
          const flattened = memberships.flatMap((item) => (Array.isArray(item) ? item : item ? [item] : []));
          setProjectRoles(flattened);
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
  useEffect(() => {
    if (currentUser.company_type !== "owner") {
      setOwnerReviewTasks([]);
      return;
    }
    let cancelled = false;
    listOwnerReviewQueue()
      .then((items) => {
        if (cancelled) return;
        const pending = items
          .filter((item: TdoQueueItem) => item.status !== "OWNER_COMMENTS_SENT")
          .map((item: TdoQueueItem) => ({
            id: `owner_queue_${item.revision_id}`,
            event_type: "OWNER_REVIEW_PENDING",
            message: `${item.document_num}, ревизия ${item.revision_code}, TRM ${item.trm_number ?? "—"}`,
            created_at: item.created_at,
            task_deadline: item.review_deadline,
            revision_id: item.revision_id,
            project_code: item.project_code,
          }));
        setOwnerReviewTasks(pending);
      })
      .catch(() => {
        if (!cancelled) setOwnerReviewTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.company_type]);
  useEffect(() => {
    if (currentUser.company_type !== "contractor" || !currentUser.permissions.can_upload_files) {
      setDeveloperWorkItems([]);
      return;
    }
    let cancelled = false;
    listRevisionsOverview()
      .then((items) => {
        if (cancelled) return;
        const mine = items
          .filter((item) => item.author_id === currentUser.id)
          .filter((item) => item.status !== "SUBMITTED")
          .sort((a, b) => (a.review_deadline ?? "") < (b.review_deadline ?? "") ? -1 : 1)
          .slice(0, 15);
        setDeveloperWorkItems(mine);
      })
      .catch(() => {
        if (!cancelled) setDeveloperWorkItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.company_type, currentUser.id, currentUser.permissions.can_upload_files]);
  const roleLabelByProjectCode = projectRoles.reduce<Record<string, string>>((acc, item) => {
    if (!acc[item.project_code]) acc[item.project_code] = item.role_label;
    return acc;
  }, {});
  const openByNotification = (item: DashboardTask): void => {
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
  const taskColumns: ColumnsType<DashboardTask> = [
    {
      title: "Задача",
      key: "message",
      width: 360,
      render: (_, row) => (
        <Space direction="vertical" size={2} style={{ width: "100%" }}>
          <Typography.Text strong>{eventTitleMap[row.event_type] ?? "Уведомление по процессу"}</Typography.Text>
          <Typography.Text style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}>
            {row.message}
          </Typography.Text>
        </Space>
      ),
    },
    { title: "Дата создания", dataIndex: "created_at", key: "created_at", width: 170, render: (v) => formatDateTimeRu(v) },
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 120, render: (v) => v ?? "—" },
    {
      title: "Роль",
      key: "project_role",
      width: 220,
      render: (_, row) => (row.project_code ? (roleLabelByProjectCode[row.project_code] ?? "—") : "—"),
    },
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
  const getRemainingLabel = (deadline: string | null): string => {
    if (!deadline) return "—";
    const end = new Date(deadline).getTime();
    if (Number.isNaN(end)) return "—";
    const diffMs = end - Date.now();
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return `Просрочено ${Math.abs(diffDays)} дн`;
    if (diffDays === 0) return "Сегодня дедлайн";
    return `${diffDays} дн осталось`;
  };
  const developerColumns: ColumnsType<RevisionOverviewItem> = [
    { title: "Проект", dataIndex: "project_code", width: 110 },
    { title: "Документ", dataIndex: "document_num", ellipsis: true },
    { title: "Ревизия", dataIndex: "revision_code", width: 90 },
    { title: "Статус", dataIndex: "status", width: 190 },
    { title: "SLA дедлайн", dataIndex: "review_deadline", width: 130, render: (v) => formatDateTimeRu(v) },
    {
      title: "Осталось",
      key: "remaining",
      width: 140,
      render: (_, row) => getRemainingLabel(row.review_deadline),
    },
    {
      title: "Действие",
      key: "action",
      width: 110,
      render: (_, row) => (
        <Button size="small" onClick={() => onNavigate("revision_card", row.revision_id)}>
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
            onClick={() => onNavigate(currentUser.company_type === "owner" ? "trm" : (currentUser.permissions.can_publish_comments ? "crs_queue" : "notifications"))}
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
      <Card title="Текущие задачи" className="hrp-card" style={{ marginTop: 16 }}>
        <Table
          columns={taskColumns}
          dataSource={myTasks}
          pagination={false}
          size="small"
          scroll={{ x: 1300 }}
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
          rowKey={(row) => `${row.project_code}_${row.role}_${row.role_label}`}
          size="small"
          pagination={false}
          dataSource={projectRoles}
          locale={{ emptyText: "Нет назначенных ролей в проектах" }}
          columns={[
            { title: "Проект", key: "project", render: (_, row) => `${row.project_code} - ${row.project_name}` },
            { title: "Назначение", dataIndex: "role_label", key: "role_label" },
          ]}
        />
      </Card>
      {currentUser.company_type === "contractor" && currentUser.permissions.can_upload_files && (
        <Card title="Документы в работе (SLA контроль)" className="hrp-card" style={{ marginTop: 16 }}>
          <Table
            rowKey="revision_id"
            size="small"
            pagination={{ pageSize: 8 }}
            dataSource={developerWorkItems}
            columns={developerColumns}
            locale={{ emptyText: "Активных документов в работе нет." }}
          />
        </Card>
      )}
    </div>
  );
}
