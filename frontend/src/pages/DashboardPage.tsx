import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { listDocumentsRegistry, listOwnerReviewQueue, listProjectMembers, listReviewMatrix, listRevisionsOverview } from "../api";
import { formatDateTimeRu, formatDeadlineRu } from "../utils/datetime";
import { getRuStatusLabel } from "../utils/revisionHints";

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
    author_name?: string | null;
  };
  const [overdueDocs, setOverdueDocs] = useState<DocumentRegistryItem[]>([]);
  const [projectRoles, setProjectRoles] = useState<Array<{ project_code: string; project_name: string; role: ProjectMemberRole; role_label: string }>>([]);
  const [ownerReviewTasks, setOwnerReviewTasks] = useState<DashboardTask[]>([]);
  const [developerWorkItems, setDeveloperWorkItems] = useState<RevisionOverviewItem[]>([]);
  // Виджет «Приближается выпуск» — для рук. ТДО подрядчика: документы,
  // у которых до планового выпуска первой ревизии ≤ 7 дней и ревизия
  // ещё не создана. Пропадают как только подрядчик создаёт ревизию A.
  const [upcomingReleases, setUpcomingReleases] = useState<
    Array<{ document_num: string; document_title: string; project_code: string; planned_release: string; days_left: number }>
  >([]);
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

  // «Приближается выпуск ≤ 7 дн» — только для рук. ТДО подрядчика
  // (или любой роли, ведущей реестр документов).
  useEffect(() => {
    if (!currentUser.permissions.can_create_mdr) {
      setUpcomingReleases([]);
      return;
    }
    let cancelled = false;
    listDocumentsRegistry({ for_reporting: true })
      .then((rows) => {
        if (cancelled) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const PLAN_INITIAL_DAYS = 20; // план выпуска A = старт + 20 дн (PD/IFR initial)
        const result = rows
          .filter((doc) => doc.revisions.length === 0)
          .map((doc) => {
            const start = doc.planned_dev_start ? new Date(doc.planned_dev_start) : null;
            if (!start) return null;
            const release = new Date(start);
            release.setDate(release.getDate() + PLAN_INITIAL_DAYS);
            const days = Math.ceil((release.getTime() - today.getTime()) / 86400000);
            return {
              document_num: doc.document_num,
              document_title: doc.document_title,
              project_code: doc.project_code,
              planned_release: release.toISOString().slice(0, 10),
              days_left: days,
            };
          })
          .filter((r): r is NonNullable<typeof r> => !!r && r.days_left <= 7)
          .sort((a, b) => a.days_left - b.days_left);
        setUpcomingReleases(result);
      })
      .catch(() => {
        if (!cancelled) setUpcomingReleases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.permissions.can_create_mdr]);
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
    const load = () => {
      listOwnerReviewQueue()
        .then((items) => {
          if (cancelled) return;
          // Заказчик «держит мяч» только в UNDER_REVIEW и CONTRACTOR_REPLY_A.
          // В OWNER_COMMENTS_SENT и CONTRACTOR_REPLY_I ходит подрядчик —
          // задачи у LR/R быть не должно.
          const pending = items
            .filter((item: TdoQueueItem) => item.status === "UNDER_REVIEW" || item.status === "CONTRACTOR_REPLY_A")
            .map((item: TdoQueueItem) => ({
              id: `owner_queue_${item.revision_id}`,
              event_type: "OWNER_REVIEW_PENDING",
              message: `${item.document_num}, ревизия ${item.revision_code}, TRM ${item.trm_number ?? "—"}`,
              created_at: item.created_at,
              task_deadline: item.review_deadline,
              revision_id: item.revision_id,
              project_code: item.project_code,
              author_name: item.author_name ?? item.author_email ?? null,
            }));
          setOwnerReviewTasks(pending);
        })
        .catch(() => {
          if (!cancelled) setOwnerReviewTasks([]);
        });
    };
    load();
    // Polling 30 сек — новые ревизии на рассмотрение появляются «вживую».
    const intervalId = window.setInterval(load, 30_000);
    return () => {
      window.clearInterval(intervalId);
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
    // Карточка ревизии — самый короткий путь: сразу нужный документ с PDF и
    // замечаниями. Списки-очереди открываем, только если ревизия неизвестна:
    // раньше заказчика по любой задаче уводило в «Очередь ТРМ», где документ
    // приходилось искать глазами.
    if (item.revision_id) {
      onNavigate("revision_card", item.revision_id);
      return;
    }
    if (item.event_type === "REVISION_UPLOADED_FOR_TDO" || item.event_type === "NEW_REVISION_FOR_TDO") {
      onNavigate(currentUser.company_type === "owner" ? "trm" : "tdo_queue");
      return;
    }
    if (item.event_type === "OWNER_COMMENTS_PUBLISHED" && currentUser.permissions.can_publish_comments) {
      onNavigate("crs_queue");
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
    {
      title: "Дата создания",
      dataIndex: "created_at",
      key: "created_at",
      width: 170,
      render: (v) => formatDateTimeRu(v),
      sorter: (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime(),
    },
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 120, render: (v) => v ?? "—" },
    {
      title: "Роль",
      key: "project_role",
      width: 220,
      render: (_, row) => (row.project_code ? (roleLabelByProjectCode[row.project_code] ?? "—") : "—"),
    },
    {
      title: "Дедлайн",
      dataIndex: "task_deadline",
      key: "task_deadline",
      width: 130,
      render: (v) => formatDeadlineRu(v),
      sorter: (a, b) => String(a.task_deadline ?? "").localeCompare(String(b.task_deadline ?? "")),
      defaultSortOrder: "ascend" as const,
    },
    {
      title: "От кого",
      key: "author_status",
      width: 220,
      render: (_, row) => {
        // Сначала — явный author_name (из owner-review-queue), иначе
        // пытаемся вытащить из текста уведомления, иначе прочерк.
        const meta = parseCommentContext(row.message);
        const author = (row.author_name && row.author_name.trim()) || meta.author;
        return (
          <Space direction="vertical" size={2}>
            <Typography.Text type="secondary">Автор: {author}</Typography.Text>
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
    { title: "Статус", dataIndex: "status", width: 190, render: (v: string) => getRuStatusLabel(v) },
    { title: "SLA дедлайн", dataIndex: "review_deadline", width: 130, render: (v) => formatDeadlineRu(v) },
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
            <Statistic title="Уведомления" value={unread} valueStyle={{ color: unread > 0 ? "#cf1322" : "#3f8600" }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card
            className="hrp-card dashboard-stat-card"
            hoverable
            // Плитка ведёт к списку задач ниже на этой же странице: оттуда
            // каждая задача открывается в карточке нужного документа. Раньше
            // заказчика уводило в «Очередь ТРМ», где документ надо было искать.
            onClick={() => {
              document.getElementById("dashboard-tasks")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <Statistic
              title="Мои задачи"
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
      {currentUser.permissions.can_create_mdr && upcomingReleases.length > 0 && (
        <Card
          title={`Приближается выпуск (≤ 7 дн) — ${upcomingReleases.length}`}
          className="hrp-card"
          style={{ marginTop: 16 }}
          extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>Напоминание о плановом выпуске первой ревизии</Typography.Text>}
        >
          <Table
            rowKey="document_num"
            size="small"
            pagination={false}
            dataSource={upcomingReleases}
            locale={{ emptyText: "Нет ближайших выпусков." }}
            columns={[
              { title: "Проект", dataIndex: "project_code", key: "project_code", width: 110 },
              { title: "Документ", dataIndex: "document_num", key: "document_num", width: 260 },
              { title: "Название", dataIndex: "document_title", key: "document_title", ellipsis: true },
              {
                title: "Плановый выпуск",
                dataIndex: "planned_release",
                key: "planned_release",
                width: 160,
                render: (v: string) => {
                  const dt = new Date(v);
                  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
                },
              },
              {
                title: "Осталось",
                dataIndex: "days_left",
                key: "days_left",
                width: 120,
                render: (d: number) => {
                  const color = d < 0 ? "red" : d <= 2 ? "orange" : "blue";
                  const label = d < 0 ? `Просрочено ${Math.abs(d)} дн` : d === 0 ? "Сегодня" : `${d} дн`;
                  return <Tag color={color}>{label}</Tag>;
                },
              },
            ]}
          />
        </Card>
      )}
      <Card id="dashboard-tasks" title="Текущие задачи" className="hrp-card" style={{ marginTop: 16 }}>
        <Table
          columns={taskColumns}
          dataSource={myTasks}
          pagination={false}
          size="small"
          scroll={{ x: 1300 }}
          rowKey="id"
          onRow={(record) => ({ onDoubleClick: () => openByNotification(record) })}
          locale={{ emptyText: "Нет текущих задач." }}
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
