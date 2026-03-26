import {
  ApartmentOutlined,
  BellOutlined,
  CheckSquareOutlined,
  EyeOutlined,
  HomeOutlined,
  LogoutOutlined,
  ProjectOutlined,
  ReadOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Avatar, Breadcrumb, Button, Layout, Menu, Space, Spin, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  clearTokens,
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
import MyTasksPage from "./pages/MyTasksPage";
import NotificationsPage from "./pages/NotificationsPage";
import AdminPage from "./pages/AdminPage";
import ProjectsPage from "./pages/ProjectsPage";
import RegistryTreePage from "./pages/RegistryTreePage";
import IncomingControlPage from "./pages/IncomingControlPage";
import ReviewCenterPage from "./pages/ReviewCenterPage";
import ViewerPage from "./pages/ViewerPage";
import type { DocumentItem, MDRRecord, NotificationItem, ProjectItem, User, WorkflowStatus } from "./types";

const { Header, Sider, Content } = Layout;

type Section =
  | "dashboard"
  | "projects"
  | "registry_tree"
  | "incoming_control"
  | "review_center"
  | "viewer"
  | "tasks"
  | "notifications"
  | "admin"
  | "help";

export default function App(): JSX.Element {
  const [authenticated, setAuthenticated] = useState(hasAccessToken());
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");
  const [registryPrefill, setRegistryPrefill] = useState<{ projectCode?: string; category?: string } | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [mdr, setMdr] = useState<MDRRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [workflowStatuses, setWorkflowStatuses] = useState<WorkflowStatus[]>([]);

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

  const menuItems = useMemo(() => {
    const items = [
      { key: "dashboard", icon: <HomeOutlined />, label: "Обзор" },
      { key: "projects", icon: <ProjectOutlined />, label: "Проекты" },
      { key: "registry_tree", icon: <ApartmentOutlined />, label: "Иерархия реестра" },
      { key: "incoming_control", icon: <SafetyCertificateOutlined />, label: "Входной контроль" },
      { key: "review_center", icon: <CheckSquareOutlined />, label: "Review Center" },
      { key: "viewer", icon: <EyeOutlined />, label: "Viewer" },
      { key: "tasks", icon: <CheckSquareOutlined />, label: "Мои задачи" },
      { key: "notifications", icon: <BellOutlined />, label: "Уведомления" },
      { key: "help", icon: <ReadOutlined />, label: "Инструкция" },
    ];

    if (user?.role === "admin") {
      items.push({ key: "admin", icon: <TeamOutlined />, label: "Администрирование" });
    }

    return items;
  }, [user?.role]);

  const sectionTitleMap: Record<Section, string> = {
    dashboard: "Обзор",
    projects: "Проекты",
    registry_tree: "Иерархия реестра",
    incoming_control: "Входной контроль",
    review_center: "Review Center",
    viewer: "Viewer",
    tasks: "Мои задачи",
    notifications: "Уведомления",
    admin: "Администрирование",
    help: "Инструкция",
  };

  if (!authenticated) {
    return <LoginForm onLoggedIn={() => setAuthenticated(true)} />;
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={260} className="app-sider" theme="light">
        <div className="app-logo">IvaMaris TDO</div>
        <Menu
          theme="light"
          mode="inline"
          items={menuItems}
          selectedKeys={[activeSection]}
          onSelect={(item) => setActiveSection(item.key as Section)}
        />

        <div className="sider-user-card">
          <Avatar>{user?.full_name?.slice(0, 1).toUpperCase() ?? "U"}</Avatar>
          <div className="sider-user-info">
            <div className="name">{user?.full_name}</div>
            <div className="email">{user?.email}</div>
          </div>
        </div>
      </Sider>

      <Layout>
        <Header className="app-header">
          <Space style={{ justifyContent: "space-between", width: "100%" }}>
            <div>
              <Breadcrumb
                items={[
                  { title: "Проекты" },
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
            <>
              {activeSection === "dashboard" && (
                <DashboardPage
                  mdr={mdr}
                  documents={documents}
                  notifications={notifications}
                  workflowStatuses={workflowStatuses}
                />
              )}
              {activeSection === "projects" && user && (
                <ProjectsPage
                  currentUser={user}
                  projects={projects}
                  onReload={loadInitialData}
                  onOpenMdr={(projectCode, category) => {
                    setRegistryPrefill({ projectCode, category });
                    setActiveSection("registry_tree");
                  }}
                />
              )}
              {activeSection === "registry_tree" && user && (
                <RegistryTreePage
                  currentUser={user}
                  projects={projects}
                  mdr={mdr}
                  documents={documents}
                  onReloadAll={loadInitialData}
                  preselectedProjectCode={registryPrefill?.projectCode}
                  preselectedCategory={registryPrefill?.category}
                />
              )}
              {activeSection === "incoming_control" && user && (
                <IncomingControlPage currentUser={user} onReloadAll={loadInitialData} />
              )}
              {activeSection === "review_center" && user && (
                <ReviewCenterPage documents={documents} currentUser={user} onReloadAll={loadInitialData} />
              )}
              {activeSection === "viewer" && <ViewerPage documents={documents} />}
              {activeSection === "tasks" && user && (
                <MyTasksPage currentUser={user} notifications={notifications} documents={documents} mdr={mdr} />
              )}
              {activeSection === "notifications" && (
                <NotificationsPage notifications={notifications} onReload={loadInitialData} />
              )}
              {activeSection === "admin" && user?.role === "admin" && <AdminPage currentUser={user} />}
              {activeSection === "help" && <HelpPage />}
            </>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
