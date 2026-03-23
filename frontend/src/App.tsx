import { BellOutlined, DatabaseOutlined, FileOutlined, HomeOutlined, LogoutOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Layout, Menu, Space, Spin, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import { clearTokens, hasAccessToken, listDocuments, listMdr, listNotifications, listWorkflowStatuses, me } from "./api";
import LoginForm from "./components/LoginForm";
import DashboardPage from "./pages/DashboardPage";
import DocumentsPage from "./pages/DocumentsPage";
import MdrPage from "./pages/MdrPage";
import NotificationsPage from "./pages/NotificationsPage";
import AdminPage from "./pages/AdminPage";
import type { DocumentItem, MDRRecord, NotificationItem, User, WorkflowStatus } from "./types";

const { Header, Sider, Content } = Layout;

type Section = "dashboard" | "mdr" | "documents" | "notifications" | "admin";

export default function App(): JSX.Element {
  const [authenticated, setAuthenticated] = useState(hasAccessToken());
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("dashboard");

  const [user, setUser] = useState<User | null>(null);
  const [mdr, setMdr] = useState<MDRRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [workflowStatuses, setWorkflowStatuses] = useState<WorkflowStatus[]>([]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [userResp, mdrResp, docsResp, notificationsResp, statusResp] = await Promise.all([
        me(),
        listMdr(),
        listDocuments(),
        listNotifications(),
        listWorkflowStatuses(),
      ]);
      setUser(userResp);
      setMdr(mdrResp);
      setDocuments(docsResp);
      setNotifications(notificationsResp);
      setWorkflowStatuses(statusResp);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Failed to load";
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
    const baseItems = [
      { key: "dashboard", icon: <HomeOutlined />, label: "Dashboard" },
      { key: "mdr", icon: <DatabaseOutlined />, label: "MDR" },
      { key: "documents", icon: <FileOutlined />, label: "Documents" },
      { key: "notifications", icon: <BellOutlined />, label: "Notifications" },
    ];

    if (user?.role === "admin") {
      baseItems.push({ key: "admin", icon: <TeamOutlined />, label: "Admin users" });
    }

    return baseItems;
  }, [user?.role]);

  if (!authenticated) {
    return <LoginForm onLoggedIn={() => setAuthenticated(true)} />;
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider>
        <div style={{ color: "white", fontWeight: 700, padding: 16 }}>IvaMaris TDO</div>
        <Menu
          theme="dark"
          mode="inline"
          items={menuItems}
          selectedKeys={[activeSection]}
          onSelect={(item) => setActiveSection(item.key as Section)}
        />
      </Sider>

      <Layout>
        <Header style={{ background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Space>
            <Typography.Text strong>{user?.full_name}</Typography.Text>
            <Typography.Text type="secondary">{user?.role}</Typography.Text>
          </Space>
          <Button
            icon={<LogoutOutlined />}
            onClick={() => {
              clearTokens();
              setAuthenticated(false);
            }}
          >
            Logout
          </Button>
        </Header>

        <Content style={{ margin: 16 }}>
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
              {activeSection === "mdr" && <MdrPage mdr={mdr} onCreated={loadInitialData} />}
              {activeSection === "documents" && (
                <DocumentsPage documents={documents} mdr={mdr} onReloadDocuments={loadInitialData} />
              )}
              {activeSection === "notifications" && (
                <NotificationsPage notifications={notifications} onReload={loadInitialData} />
              )}
              {activeSection === "admin" && user?.role === "admin" && <AdminPage currentUser={user} />}
            </>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
