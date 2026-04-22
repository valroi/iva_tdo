import {
  BellOutlined,
  FileSearchOutlined,
  HomeOutlined,
  LogoutOutlined,
  ProjectOutlined,
  ReadOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Avatar, Breadcrumb, Button, Layout, Menu, Segmented, Space, Spin, Typography, message } from "antd";
import { Component, useCallback, useEffect, useMemo, useState } from "react";

import {
  clearTokens,
  getActiveProfileId,
  hasAccessToken,
  listDocuments,
  listMdr,
  listNotifications,
  listProjects,
  listWorkflowStatuses,
  me,
} from "./api";
import LoginForm from "./components/LoginForm";
import DashboardPage from "./pages/DashboardPage";
import HelpPage from "./pages/HelpPage";
import NotificationsPage from "./pages/NotificationsPage";
import AdminPage from "./pages/AdminPage";
import ProjectsPage from "./pages/ProjectsPage";
import SessionsPage from "./pages/SessionsPage";
import TdoQueuePage from "./pages/TdoQueuePage";
import RevisionsPage from "./pages/RevisionsPage";
import TrmPage from "./pages/TrmPage";
import RevisionCardPage from "./pages/RevisionCardPage";
import DocumentsRegistryPage from "./pages/DocumentsRegistryPage";
import CrsPage from "./pages/CrsPage";
import ReportingPage from "./pages/ReportingPage";
import DocCheckerPage from "./pages/DocCheckerPage";
import type { DocumentItem, MDRRecord, NotificationItem, ProjectItem, User, WorkflowStatus } from "./types";

const { Header, Sider, Content } = Layout;

type Section =
  | "dashboard"
  | "projects"
  | "documents_registry"
  | "revisions"
  | "trm"
  | "reporting"
  | "crs_queue"
  | "revision_card"
  | "notifications"
  | "tdo_queue"
  | "sessions"
  | "admin"
  | "help"
  | "docchecker";
type AppModule = "dcc" | "docchecker";

class UiErrorBoundary extends Component<{ children: JSX.Element }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24 }}>
          <Typography.Title level={4}>Ошибка интерфейса</Typography.Title>
          <Typography.Paragraph>
            {this.state.error.message}
          </Typography.Paragraph>
          <Button
            type="primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            Перезагрузить страницу
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App(): JSX.Element {
  const profileId = useMemo(() => getActiveProfileId(), []);
  const [authenticated, setAuthenticated] = useState(hasAccessToken());
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [activeModule, setActiveModule] = useState<AppModule>("dcc");

  const [user, setUser] = useState<User | null>(null);
  const [mdr, setMdr] = useState<MDRRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [workflowStatuses, setWorkflowStatuses] = useState<WorkflowStatus[]>([]);
  const [notificationTarget, setNotificationTarget] = useState<{
    project_code?: string | null;
    document_num?: string | null;
    revision_id?: number | null;
  } | null>(null);
  const [openedRevisionId, setOpenedRevisionId] = useState<number | null>(null);
  const [documentsRegistryPreset, setDocumentsRegistryPreset] = useState<{ overdue_only?: boolean } | null>(null);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [userResp, mdrResp, docsResp, projectsResp, notificationsResp, statusResp] = await Promise.all([
        me(),
        listMdr(),
        listDocuments(),
        listProjects(),
        listNotifications(),
        listWorkflowStatuses(),
      ]);
      setUser(userResp);
      setMdr(mdrResp);
      setDocuments(docsResp);
      setProjects(projectsResp);
      setNotifications(notificationsResp);
      setWorkflowStatuses(statusResp);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка загрузки";
      message.error(text);
      clearTokens();
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      void loadInitialData();
    }
  }, [authenticated, loadInitialData]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications],
  );

  const menuItems = useMemo(() => {
    const items = [
      { key: "dashboard", icon: <HomeOutlined />, label: "Обзор" },
      { key: "projects", icon: <ProjectOutlined />, label: "Проекты" },
      { key: "documents_registry", icon: <ReadOutlined />, label: "Документы" },
      { key: "revisions", icon: <ReadOutlined />, label: "Ревизии" },
      { key: "trm", icon: <ReadOutlined />, label: "TRM" },
      { key: "notifications", icon: <BellOutlined />, label: `Уведомления${unreadNotificationsCount ? ` (${unreadNotificationsCount})` : ""}` },
      { key: "sessions", icon: <LogoutOutlined />, label: "Сессии" },
      { key: "help", icon: <ReadOutlined />, label: "Инструкция" },
    ];

    if (user?.permissions.can_manage_users) {
      items.push({ key: "admin", icon: <TeamOutlined />, label: "Администрирование" });
    }
    if (user?.permissions.can_view_reporting) {
      items.push({ key: "reporting", icon: <ReadOutlined />, label: "Отчетность" });
    }
    if (user?.permissions.can_process_tdo_queue) {
      items.push({ key: "tdo_queue", icon: <ReadOutlined />, label: "Очередь ТРМ" });
    }
    if (user?.permissions.can_publish_comments) {
      items.push({ key: "crs_queue", icon: <ReadOutlined />, label: "CRS" });
    }

    return items;
  }, [
    unreadNotificationsCount,
    user?.permissions.can_manage_users,
    user?.permissions.can_view_reporting,
    user?.permissions.can_process_tdo_queue,
    user?.permissions.can_publish_comments,
  ]);

  const sectionTitleMap: Record<Section, string> = {
    dashboard: "Обзор",
    projects: "Проекты",
    documents_registry: "Документы",
    revisions: "Ревизии",
    trm: "TRM",
    reporting: "Отчетность",
    crs_queue: "CRS",
    revision_card: "Карточка документа",
    notifications: "Уведомления",
    tdo_queue: "Очередь ТРМ",
    sessions: "Сессии",
    admin: "Администрирование",
    help: "Инструкция",
    docchecker: "DOCchecker",
  };

  if (!authenticated) {
    return <LoginForm onLoggedIn={() => setAuthenticated(true)} />;
  }

  return (
    <UiErrorBoundary>
      <Layout style={{ minHeight: "100vh" }} className="hrp-shell">
        <Sider width={260} className="app-sider" theme="light">
          <div className="app-logo">IvaMaris TDO</div>
          <div className="module-switcher">
            <Segmented
              block
              value={activeModule}
              options={[
                { label: "DCC", value: "dcc" },
                { label: "DOCchecker", value: "docchecker" },
              ]}
              onChange={(value) => {
                const next = value as AppModule;
                setActiveModule(next);
                setActiveSection(next === "docchecker" ? "docchecker" : "dashboard");
              }}
            />
          </div>
          <Menu
            theme="light"
            mode="inline"
            items={
              activeModule === "docchecker"
                ? [{ key: "docchecker", icon: <FileSearchOutlined />, label: "DOCchecker" }]
                : menuItems
            }
            selectedKeys={[activeModule === "docchecker" ? "docchecker" : activeSection]}
            onSelect={(item) => {
              if (item.key === "docchecker") {
                setActiveModule("docchecker");
                setActiveSection("docchecker");
                return;
              }
              setActiveModule("dcc");
              setActiveSection(item.key as Section);
            }}
          />

          <div className="sider-user-card">
            <Avatar>{user?.full_name?.slice(0, 1).toUpperCase() ?? "U"}</Avatar>
            <div className="sider-user-info">
              <div className="name">{user?.full_name}</div>
              <div className="email">{user?.email}</div>
              <div className="email">profile: {profileId}</div>
            </div>
          </div>
        </Sider>

        <Layout className="app-main-layout">
          <Header className="app-header">
            <Space style={{ justifyContent: "space-between", width: "100%" }}>
              <div>
                <Breadcrumb
                  items={[
                    { title: activeModule === "docchecker" ? "DOCchecker" : "DCC" },
                    { title: sectionTitleMap[activeSection] },
                  ]}
                />
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {sectionTitleMap[activeSection]}
                </Typography.Title>
              </div>
              <Button
                icon={<LogoutOutlined />}
                onClick={() => {
                  clearTokens();
                  setAuthenticated(false);
                }}
              >
                Выйти
              </Button>
            </Space>
          </Header>

          <Content className="app-content">
            {loading ? (
              <Spin />
            ) : (
              <div className="page-surface">
              {activeSection === "dashboard" && user && (
                <DashboardPage
                  mdr={mdr}
                  documents={documents}
                  notifications={notifications}
                  currentUser={user}
                  onNavigate={(target, revisionId, options) => {
                    if (target === "revision_card" && revisionId) {
                      setOpenedRevisionId(revisionId);
                      setActiveSection("revision_card");
                      return;
                    }
                    if (target === "documents_registry" && options?.overdueOnly) {
                      setDocumentsRegistryPreset({ overdue_only: true });
                    }
                    setActiveSection(target);
                  }}
                />
              )}
              {activeSection === "projects" && user && (
                <ProjectsPage
                  currentUser={user}
                  projects={projects}
                  mdr={mdr}
                  documents={documents}
                  notificationTarget={notificationTarget}
                  onNotificationTargetHandled={() => setNotificationTarget(null)}
                  onReload={loadInitialData}
                />
              )}
              {activeSection === "revisions" && user && (
                <RevisionsPage
                  currentUser={user}
                  onOpenRevision={(target) => {
                    setOpenedRevisionId(target.revision_id);
                    setActiveSection("revision_card");
                  }}
                />
              )}
              {activeSection === "documents_registry" && user && (
                <DocumentsRegistryPage
                  currentUser={user}
                  presetFilters={documentsRegistryPreset}
                  onPresetConsumed={() => setDocumentsRegistryPreset(null)}
                  onOpenRevision={(target) => {
                    setOpenedRevisionId(target.revision_id);
                    setActiveSection("revision_card");
                  }}
                />
              )}
              {activeSection === "trm" && user && (
                <TrmPage
                  currentUser={user}
                  onOpenRevision={(target) => {
                    setOpenedRevisionId(target.revision_id);
                    setActiveSection("revision_card");
                  }}
                />
              )}
              {activeSection === "reporting" && user?.permissions.can_view_reporting && (
                <ReportingPage projects={projects} mdr={mdr} />
              )}
              {activeSection === "crs_queue" && user?.permissions.can_publish_comments && <CrsPage />}
              {activeSection === "revision_card" && openedRevisionId && user && (
                <RevisionCardPage
                  revisionId={openedRevisionId}
                  currentUser={user}
                  onBack={() => setActiveSection("revisions")}
                />
              )}
              {activeSection === "notifications" && (
                <NotificationsPage
                  notifications={notifications}
                  onReload={loadInitialData}
                  onOpenTarget={(item) => {
                    setNotificationTarget({
                      project_code: item.project_code,
                      document_num: item.document_num,
                      revision_id: item.revision_id,
                    });
                    if (item.event_type === "REVISION_UPLOADED_FOR_TDO" || item.event_type === "NEW_REVISION_FOR_TDO") {
                      setActiveSection(user?.company_type === "owner" ? "trm" : "tdo_queue");
                    } else if (item.event_type === "TDO_SENT_TO_OWNER") {
                      setActiveSection("trm");
                    } else {
                      setOpenedRevisionId(item.revision_id ?? null);
                      setActiveSection(item.revision_id ? "revision_card" : "projects");
                    }
                  }}
                />
              )}
              {activeSection === "tdo_queue" && user && (
                <TdoQueuePage
                  currentUser={user}
                  onReload={loadInitialData}
                  onOpenRevision={(target) => {
                    setOpenedRevisionId(target.revision_id);
                    setActiveSection("revision_card");
                  }}
                />
              )}
              {activeSection === "sessions" && user && <SessionsPage />}
              {activeSection === "admin" && user?.permissions.can_manage_users && (
                <AdminPage currentUser={user} onGlobalReload={loadInitialData} />
              )}
              {activeSection === "help" && user && <HelpPage currentUser={user} />}
              {activeSection === "docchecker" && user && <DocCheckerPage />}
              </div>
            )}
          </Content>
        </Layout>
      </Layout>
    </UiErrorBoundary>
  );
}
