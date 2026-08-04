import {
  AuditOutlined,
  BellOutlined,
  BarChartOutlined,
  FileTextOutlined,
  HomeOutlined,
  LogoutOutlined,
  ProjectOutlined,
  QuestionCircleOutlined,
  SafetyOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Avatar, Breadcrumb, Button, Layout, Menu, Segmented, Space, Spin, Typography, message } from "antd";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearTokens,
  hasAccessToken,
  listDocuments,
  listMdr,
  listNotifications,
  listProjects,
  me,
} from "./api";
import ChangePasswordModal from "./components/ChangePasswordModal";
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
import FeedPage from "./pages/FeedPage";
import VendorsPage from "./pages/VendorsPage";
import VendorPortalPage from "./pages/VendorPortalPage";
import { I18nProvider } from "./i18n";
import LanguageSwitcher from "./components/LanguageSwitcher";
import type { DocumentItem, MDRRecord, NotificationItem, ProjectItem, User } from "./types";

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
  | "vendors"
  | "sessions"
  | "admin"
  | "help"
  | "docchecker";
type AppModule = "dcc" | "vendors" | "docchecker";

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

// Гостевой портал подрядчика: #/vendor/<invitationId>?t=<token>.
// Распознаём ДО логина — внешний подрядчик не входит в основную систему.
function parseVendorPortal(): { invitationId: number; token: string } | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [path] = hash.split("?");
  const segments = path.split("/");
  if (segments[0] !== "vendor" || !segments[1]) return null;
  const invitationId = Number(segments[1]);
  if (!Number.isFinite(invitationId)) return null;
  const search = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const token = search.get("t") ?? "";
  if (!token) return null;
  return { invitationId, token };
}

export default function App(): JSX.Element {
  const vendorPortal = parseVendorPortal();
  if (vendorPortal) {
    return (
      <I18nProvider>
        <UiErrorBoundary>
          <VendorPortalPage invitationId={vendorPortal.invitationId} token={vendorPortal.token} />
        </UiErrorBoundary>
      </I18nProvider>
    );
  }
  return (
    <I18nProvider>
      <MainApp />
    </I18nProvider>
  );
}

function MainApp(): JSX.Element {
  const [authenticated, setAuthenticated] = useState(hasAccessToken());
  const [loading, setLoading] = useState(false);
  // Активная секция и открытая ревизия сохраняются в URL hash, чтобы F5
  // или прямая ссылка восстанавливали место работы, а не сбрасывали на «Обзор».
  // Формат: #/<section>            например, #/projects
  //         #/revision_card/<id>   например, #/revision_card/42
  //         #/module=docchecker    переключает модуль DCC ↔ DOCchecker
  const parseHash = (): { section: Section; module: AppModule; revisionId: number | null } => {
    if (typeof window === "undefined") {
      return { section: "dashboard", module: "dcc", revisionId: null };
    }
    const raw = window.location.hash.replace(/^#\/?/, "").trim();
    if (!raw) return { section: "dashboard", module: "dcc", revisionId: null };
    if (raw === "module=docchecker" || raw === "docchecker") {
      return { section: "docchecker", module: "docchecker", revisionId: null };
    }
    const [seg, arg] = raw.split("/");
    const validSections: Section[] = [
      "dashboard",
      "projects",
      "vendors",
      "documents_registry",
      "revisions",
      "trm",
      "reporting",
      "crs_queue",
      "revision_card",
      "notifications",
      "tdo_queue",
      "sessions",
      "admin",
      "help",
      "docchecker",
    ];
    const section = (validSections as string[]).includes(seg) ? (seg as Section) : "dashboard";
    const revisionId = section === "revision_card" && arg ? Number(arg) || null : null;
    const module: AppModule =
      section === "docchecker" ? "docchecker" : section === "vendors" ? "vendors" : "dcc";
    return { section, module, revisionId };
  };
  const initialHash = parseHash();
  const [activeSection, setActiveSection] = useState<Section>(initialHash.section);
  const [activeModule, setActiveModule] = useState<AppModule>(initialHash.module);

  const [user, setUser] = useState<User | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [mdr, setMdr] = useState<MDRRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationTarget, setNotificationTarget] = useState<{
    project_code?: string | null;
    document_num?: string | null;
    revision_id?: number | null;
  } | null>(null);
  const [openedRevisionId, setOpenedRevisionId] = useState<number | null>(initialHash.revisionId);
  const [documentsRegistryPreset, setDocumentsRegistryPreset] = useState<{ overdue_only?: boolean } | null>(null);

  // История секций для кнопок «Назад» — возвращаемся туда, откуда пришли,
  // а не на фиксированную страницу. Пуш прошлой секции при каждой смене;
  // при переходе через goBack пуш пропускаем (флаг), чтобы не зациклиться.
  const navStackRef = useRef<Section[]>([]);
  const prevSectionRef = useRef<Section>(activeSection);
  const isBackNavRef = useRef(false);
  useEffect(() => {
    if (prevSectionRef.current !== activeSection) {
      if (!isBackNavRef.current) {
        navStackRef.current.push(prevSectionRef.current);
        if (navStackRef.current.length > 50) navStackRef.current.shift();
      }
      isBackNavRef.current = false;
      prevSectionRef.current = activeSection;
    }
  }, [activeSection]);
  const goBack = useCallback(() => {
    const prev = navStackRef.current.pop();
    isBackNavRef.current = true;
    setActiveSection(prev ?? "dashboard");
  }, []);

  // Немедленный рефетч уведомлений при заходе на «Обзор»/«Уведомления» —
  // чтобы после действия на другой странице список/бейдж были свежими сразу,
  // не дожидаясь фонового поллинга (item 11).
  useEffect(() => {
    if (!user) return;
    if (activeSection === "dashboard" || activeSection === "notifications") {
      void listNotifications().then(setNotifications).catch(() => {});
    }
  }, [activeSection, user]);

  // Синхронизация состояния в URL hash: при изменении секции/ревизии — push в URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let hash = `#/${activeSection}`;
    if (activeSection === "revision_card" && openedRevisionId) {
      hash = `#/revision_card/${openedRevisionId}`;
    }
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  }, [activeSection, openedRevisionId]);

  // Реакция на «Назад/Вперёд» в браузере — синхронизируем состояние из URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const next = parseHash();
      setActiveSection(next.section);
      setActiveModule(next.module);
      setOpenedRevisionId(next.revisionId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      // Авторизация зависит ТОЛЬКО от профиля пользователя. Раньше Promise.all
      // разлогинивал при сбое любого из второстепенных списков (MDR/документы/
      // и т.п.) — один битый запрос выкидывал из системы. Теперь они грузятся
      // отказоустойчиво и не влияют на сессию.
      const userResp = await me();
      setUser(userResp);
      const [mdrResp, docsResp, projectsResp, notificationsResp] = await Promise.allSettled([
        listMdr(),
        listDocuments(),
        listProjects(),
        listNotifications(),
      ]);
      if (mdrResp.status === "fulfilled") setMdr(mdrResp.value);
      if (docsResp.status === "fulfilled") setDocuments(docsResp.value);
      if (projectsResp.status === "fulfilled") setProjects(projectsResp.value);
      if (notificationsResp.status === "fulfilled") setNotifications(notificationsResp.value);
    } catch (error) {
      // Сюда попадаем только если упал сам me() — токен действительно невалиден.
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

  // Polling всех ключевых списков каждые 20 секунд: уведомления,
  // реестр (mdr), документы, проекты. Это даёт «онлайн»-эффект:
  // создал документ con_tdo — у разработчика появляется без F5.
  // Polling работает только когда вкладка видима — иначе зря грузим
  // сервер, когда пользователь переключился на другую вкладку браузера.
  useEffect(() => {
    if (!authenticated) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void listNotifications().then(setNotifications).catch(() => {});
      void listMdr().then(setMdr).catch(() => {});
      void listDocuments().then(setDocuments).catch(() => {});
      void listProjects().then(setProjects).catch(() => {});
    };
    const id = window.setInterval(tick, 8_000);
    // Дополнительный «толчок» при возврате на вкладку — данные обновятся
    // сразу, не дожидаясь следующего тика.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authenticated]);

  // Протухшая сессия (401 от API): понятное сообщение + возврат на вход,
  // вместо непонятных ошибок на каждой кнопке (item 10).
  useEffect(() => {
    const onExpired = () => {
      message.warning("Сессия истекла. Войдите заново.");
      clearTokens();
      setUser(null);
    };
    window.addEventListener("tdo:session-expired", onExpired);
    return () => window.removeEventListener("tdo:session-expired", onExpired);
  }, []);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications],
  );

  const menuItems = useMemo(() => {
    // Документы и ревизии открываются внутри проекта (Проекты → вкладки),
    // а также по кнопкам «Открыть» из «Обзора» и уведомлений — отдельных
    // пунктов меню для них нет, чтобы не дублировать точки входа.
    const items = [
      { key: "dashboard", icon: <HomeOutlined />, label: "Обзор" },
      { key: "projects", icon: <ProjectOutlined />, label: "Проекты" },
      { key: "documents_registry", icon: <FileTextOutlined />, label: "Документы" },
      { key: "notifications", icon: <BellOutlined />, label: `Уведомления${unreadNotificationsCount ? ` (${unreadNotificationsCount})` : ""}` },
      { key: "sessions", icon: <SafetyOutlined />, label: "Сессии" },
      { key: "help", icon: <QuestionCircleOutlined />, label: "Инструкция" },
    ];

    if (user?.permissions.can_manage_users) {
      items.push({ key: "admin", icon: <TeamOutlined />, label: "Администрирование" });
    }
    if (user?.permissions.can_view_reporting) {
      items.push({ key: "reporting", icon: <BarChartOutlined />, label: "Отчетность" });
    }
    if (user?.permissions.can_process_tdo_queue) {
      items.push({ key: "tdo_queue", icon: <UnorderedListOutlined />, label: "Очередь ТРМ" });
    }
    if (user?.permissions.can_publish_comments) {
      items.push({ key: "crs_queue", icon: <AuditOutlined />, label: "CRS" });
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
    vendors: "Закупки",
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
    docchecker: "FEED",
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
                ...(user?.permissions.can_access_vendors ? [{ label: "Закупки", value: "vendors" }] : []),
                ...(user?.permissions.can_access_feed ? [{ label: "FEED", value: "docchecker" }] : []),
              ]}
              onChange={(value) => {
                const next = value as AppModule;
                setActiveModule(next);
                setActiveSection(next === "docchecker" ? "docchecker" : next === "vendors" ? "vendors" : "dashboard");
              }}
            />
          </div>
          {/* Боковое меню — только для DCC (там много разделов). Для модулей
              FEED/Закупки активный модуль уже виден в переключателе выше, и
              дублирующий одинокий пункт меню только мешал. */}
          {activeModule === "dcc" && (
            <Menu
              theme="light"
              mode="inline"
              items={menuItems}
              selectedKeys={[activeSection]}
              onSelect={(item) => {
                setActiveModule("dcc");
                setActiveSection(item.key as Section);
              }}
            />
          )}

          <div
            className="sider-user-card"
            style={{ cursor: "pointer" }}
            title="Сменить пароль"
            onClick={() => setChangePasswordOpen(true)}
          >
            <Avatar>{user?.full_name?.slice(0, 1).toUpperCase() ?? "U"}</Avatar>
            <div className="sider-user-info">
              <div className="name">{user?.full_name}</div>
              <div className="email">{user?.email}</div>
            </div>
          </div>
          <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
        </Sider>

        <Layout className="app-main-layout">
          <Header className="app-header">
            <Space style={{ justifyContent: "space-between", width: "100%", alignItems: "center" }}>
              <div style={{ lineHeight: 1 }}>
                <Breadcrumb
                  style={{ marginBottom: 2 }}
                  items={[
                    { title: activeModule === "docchecker" ? "FEED" : activeModule === "vendors" ? "Закупки" : "DCC" },
                    { title: sectionTitleMap[activeSection] },
                  ]}
                />
                <Typography.Title level={4} style={{ margin: 0, lineHeight: 1.2 }}>
                  {sectionTitleMap[activeSection]}
                </Typography.Title>
              </div>
              <Space>
                <LanguageSwitcher />
                <Button
                  icon={<LogoutOutlined />}
                  size="small"
                  onClick={() => {
                    clearTokens();
                    setAuthenticated(false);
                  }}
                >
                  Выйти
                </Button>
              </Space>
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
                  projects={projects}
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
              {activeSection === "vendors" && user && <VendorsPage currentUser={user} />}
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
                  onBack={goBack}
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
                      if (item.revision_id) {
                        setOpenedRevisionId(item.revision_id);
                        setActiveSection("revision_card");
                      } else {
                        setActiveSection("trm");
                      }
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
              {activeSection === "docchecker" && user && <FeedPage currentUser={user} />}
              </div>
            )}
          </Content>
        </Layout>
      </Layout>
    </UiErrorBoundary>
  );
}
