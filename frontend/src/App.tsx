import {
  BellOutlined,
  DatabaseOutlined,
  FileOutlined,
  HomeOutlined,
  LogoutOutlined,
  ProjectOutlined,
  ReadOutlined,
  TeamOutlined,
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
import DocumentsPage from "./pages/DocumentsPage";
import HelpPage from "./pages/HelpPage";
import MdrPage from "./pages/MdrPage";
import NotificationsPage from "./pages/NotificationsPage";
import AdminPage from "./pages/AdminPage";
import ProjectsPage from "./pages/ProjectsPage";
import type { DocumentItem, MDRRecord, NotificationItem, ProjectItem, User, WorkflowStatus } from "./types";

const { Header, Sider, Content } = Layout;

type Section = "dashboard" | "projects" | "mdr" | "documents" | "notifications" | "admin" | "help";

export default function App(): JSX.Element {
  const [authenticated, setAuthenticated] = useState(hasAccessToken());
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");

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
      { key: "mdr", icon: <DatabaseOutlined />, label: "Реестр MDR" },
      { key: "documents", icon: <FileOutlined />, label: "Документы" },
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
    mdr: "Реестр MDR",
    documents: "Документы",
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
                <ProjectsPage currentUser={user} projects={projects} onReload={loadInitialData} />
              )}
              {activeSection === "mdr" && <MdrPage mdr={mdr} projects={projects} onCreated={loadInitialData} />}
              {activeSection === "documents" && (
                <DocumentsPage documents={documents} mdr={mdr} onReloadDocuments={loadInitialData} />
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
