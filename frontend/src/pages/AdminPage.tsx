import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  approveRegistrationRequest,
  impersonateLogin,
  createQuickDemoSetup,
  createUser,
  deleteUser,
  listRegistrationRequests,
  listUsers,
  rejectRegistrationRequest,
  setUserActive,
  updateUserPermissions,
  updateUserPassword,
  updateUserRole,
  updateUser,
  listUserSessions,
  revokeUserSession,
  getAdminReviewSlaSettings,
  updateAdminReviewSlaSettings,
} from "../api";
import type { CompanyType, QuickDemoSetupResult, RegistrationRequest, User, UserPermissions, UserRole, UserSession } from "../types";

interface Props {
  currentUser: User;
}

const roleOptions: { value: UserRole; label: string }[] = [
  { value: "admin", label: "admin" },
  { value: "user", label: "user" },
];

const companyOptions: { value: CompanyType; label: string }[] = [
  { value: "admin", label: "admin" },
  { value: "owner", label: "owner" },
  { value: "contractor", label: "contractor" },
];

const permissionFields: { key: keyof UserPermissions; label: string }[] = [
  { key: "can_manage_users", label: "Управление пользователями" },
  { key: "can_manage_projects", label: "Управление проектами" },
  { key: "can_edit_project_references", label: "Редактирование справочников" },
  { key: "can_manage_review_matrix", label: "Управление матрицей назначений" },
  { key: "can_create_mdr", label: "Создание/редактирование MDR" },
  { key: "can_upload_files", label: "Загрузка файлов" },
  { key: "can_comment", label: "Комментарии и ответы" },
  { key: "can_raise_comments", label: "Может задавать вопросы/замечания" },
  { key: "can_respond_comments", label: "Может отвечать на замечания" },
  { key: "can_publish_comments", label: "Подтверждает замечания в подряд" },
  { key: "can_edit_workflow_statuses", label: "Редактирование workflow статусов" },
  { key: "can_process_tdo_queue", label: "Обработка очереди ТДО (TRM/отклонение)" },
];

type PermissionPresetId = "lr_owner" | "contractor_tdo_lead" | "contractor_developer" | "custom";

const permissionPresets: Record<
  Exclude<PermissionPresetId, "custom">,
  { label: string; permissions: Partial<UserPermissions> }
> = {
  lr_owner: {
    label: "LR заказчика (только рассмотрение)",
    permissions: {
      can_manage_users: false,
      can_manage_projects: false,
      can_edit_project_references: false,
      can_manage_review_matrix: false,
      can_create_mdr: false,
      can_upload_files: false,
      can_comment: true,
      can_raise_comments: true,
      can_respond_comments: false,
      can_publish_comments: true,
      can_edit_workflow_statuses: false,
      can_process_tdo_queue: false,
    },
  },
  contractor_tdo_lead: {
    label: "Руководитель ТДО подрядчика (управление контуром)",
    permissions: {
      can_manage_users: false,
      can_manage_projects: false,
      can_edit_project_references: false,
      can_manage_review_matrix: true,
      can_create_mdr: true,
      can_upload_files: true,
      can_comment: true,
      can_raise_comments: false,
      can_respond_comments: true,
      can_publish_comments: false,
      can_edit_workflow_statuses: false,
      can_process_tdo_queue: true,
    },
  },
  contractor_developer: {
    label: "Разработчик подрядчика (разработка/подача)",
    permissions: {
      can_manage_users: false,
      can_manage_projects: false,
      can_edit_project_references: false,
      can_manage_review_matrix: false,
      can_create_mdr: true,
      can_upload_files: true,
      can_comment: true,
      can_raise_comments: false,
      can_respond_comments: true,
      can_publish_comments: false,
      can_edit_workflow_statuses: false,
      can_process_tdo_queue: false,
    },
  },
};

export default function AdminPage({ currentUser }: Props): JSX.Element {
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();

  const [roleOpen, setRoleOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [roleForm] = Form.useForm();

  const [approveOpen, setApproveOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RegistrationRequest | null>(null);
  const [approveForm] = Form.useForm();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectForm] = Form.useForm();

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm] = Form.useForm();
  const [quickResult, setQuickResult] = useState<QuickDemoSetupResult | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionsForm] = Form.useForm<UserPermissions>();
  const [permissionsPresetId, setPermissionsPresetId] = useState<PermissionPresetId>("custom");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm] = Form.useForm<{ new_password: string }>();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm<{ email: string; full_name: string; company_code?: string; company_type: CompanyType; is_active: boolean }>();
  const [slaForm] = Form.useForm<{
    initial_days: number;
    next_days: number;
    owner_dcc_incoming_days: number;
    owner_specialist_review_days: number;
    owner_lr_approval_days: number;
    contractor_consideration_days: number;
    contractor_ap_issue_days: number;
    contractor_an_issue_days: number;
    contractor_co_rj_issue_days: number;
    owner_final_approval_days: number;
    owner_stamp_days: number;
  }>();

  const loadData = async () => {
    setLoading(true);
    try {
      const usersResp = await listUsers();
      setUsers(usersResp);

      try {
        const reqResp = await listRegistrationRequests();
        setRequests(reqResp);
        setIsMainAdmin(true);
      } catch {
        setRequests([]);
        setIsMainAdmin(false);
      }
      try {
        const sla = await getAdminReviewSlaSettings();
        slaForm.setFieldsValue(sla);
      } catch {
        // ignore for non-main admins
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка загрузки админ-данных";
      message.error(text);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const visibleRoleOptions = useMemo(
    () => roleOptions.filter((item) => isMainAdmin || item.value !== "admin"),
    [isMainAdmin],
  );

  const userColumns: ColumnsType<User> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    { title: "Email", dataIndex: "email", key: "email" },
    { title: "ФИО", dataIndex: "full_name", key: "full_name" },
    { title: "Код компании", dataIndex: "company_code", key: "company_code", render: (value: string | null) => value ?? "—" },
    { title: "Компания", dataIndex: "company_type", key: "company_type" },
    {
      title: "Роль",
      dataIndex: "role",
      key: "role",
      render: (value: UserRole) => <Tag color={value === "admin" ? "purple" : "blue"}>{value}</Tag>,
    },
    {
      title: "Активен",
      dataIndex: "is_active",
      key: "is_active",
      render: (value: boolean) => (value ? <Tag color="green">ДА</Tag> : <Tag color="red">НЕТ</Tag>),
    },
    {
      title: "Действия",
      key: "actions",
      render: (_, row) => (
        <Space wrap>
          <Button
            size="small"
            onClick={() => {
              setSelectedUser(row);
              editForm.setFieldsValue({
                email: row.email,
                full_name: row.full_name,
                company_code: row.company_code ?? undefined,
                company_type: row.company_type,
                is_active: row.is_active,
              });
              setEditOpen(true);
            }}
            disabled={!isMainAdmin}
          >
            Редактировать
          </Button>
          <Button
            size="small"
            onClick={() => {
              setSelectedUser(row);
              roleForm.setFieldsValue({ role: row.role });
              setRoleOpen(true);
            }}
            disabled={!isMainAdmin}
          >
            Изменить роль
          </Button>
          <Button
            size="small"
            onClick={() => {
              setSelectedUser(row);
              permissionsForm.setFieldsValue(row.permissions);
              setPermissionsPresetId("custom");
              setPermissionsOpen(true);
            }}
            disabled={!isMainAdmin}
          >
            Права действий
          </Button>
          <Button
            size="small"
            onClick={() => {
              setSelectedUser(row);
              passwordForm.resetFields();
              setPasswordOpen(true);
            }}
            disabled={!isMainAdmin}
          >
            Сменить пароль
          </Button>
          <Button
            size="small"
            onClick={async () => {
              setSelectedUser(row);
              const data = await listUserSessions(row.id);
              setSessions(data);
              setSessionsOpen(true);
            }}
            disabled={!isMainAdmin}
          >
            Сессии
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={async () => {
              await impersonateLogin(row.id);
              message.success(`Вход выполнен как ${row.email}`);
              window.location.reload();
            }}
            disabled={!isMainAdmin || row.id === currentUser.id || !row.is_active}
          >
            Войти как
          </Button>
          <Button
            size="small"
            onClick={async () => {
              await setUserActive(row.id, !row.is_active);
              message.success("Статус пользователя обновлен");
              await loadData();
            }}
            disabled={!isMainAdmin}
          >
            {row.is_active ? "Деактивировать" : "Активировать"}
          </Button>
          <Popconfirm
            title="Удалить пользователя?"
            description="Это действие нельзя отменить"
            onConfirm={async () => {
              await deleteUser(row.id);
              message.success("Пользователь удален");
              await loadData();
            }}
            okText="Удалить"
            cancelText="Отмена"
            disabled={!isMainAdmin}
          >
            <Button danger size="small" disabled={!isMainAdmin}>
              Удалить
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const requestColumns: ColumnsType<RegistrationRequest> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    { title: "Email", dataIndex: "email", key: "email" },
    { title: "ФИО", dataIndex: "full_name", key: "full_name" },
    { title: "Компания", dataIndex: "company_type", key: "company_type" },
    {
      title: "Запрошенная роль",
      dataIndex: "requested_role",
      key: "requested_role",
      render: (value: UserRole | null) => value ?? "—",
    },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      render: (value: RegistrationRequest["status"]) => {
        const color = value === "PENDING" ? "gold" : value === "APPROVED" ? "green" : "red";
        return <Tag color={color}>{value}</Tag>;
      },
    },
    {
      title: "Действия",
      key: "actions",
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            disabled={!isMainAdmin || row.status !== "PENDING"}
            onClick={() => {
              setSelectedRequest(row);
              approveForm.setFieldsValue({
                role: row.requested_role ?? "user",
                company_type: row.company_type,
                is_active: true,
              });
              setApproveOpen(true);
            }}
          >
            Одобрить
          </Button>
          <Button
            size="small"
            danger
            disabled={!isMainAdmin || row.status !== "PENDING"}
            onClick={() => {
              setSelectedRequest(row);
              rejectForm.resetFields();
              setRejectOpen(true);
            }}
          >
            Отклонить
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="admin-module">
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Администрирование: пользователи и права
        </Typography.Title>
        <Space>
          <Button
            onClick={() => {
              setQuickResult(null);
              quickForm.setFieldsValue({
                contractor_email: "contractor.demo@ivamaris.io",
                owner_email: "owner.demo@ivamaris.io",
                password: "DemoPass123!",
              });
              setQuickOpen(true);
            }}
            disabled={!isMainAdmin}
          >
            Быстрый мастер
          </Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            + Создать пользователя
          </Button>
        </Space>
      </Space>

      {!isMainAdmin && (
        <Typography.Paragraph type="warning">
          Вы вошли как обычный администратор. Создание пользователей доступно, но назначение admin-роли,
          удаление, деактивация и апрув заявок доступны только главному админу.
        </Typography.Paragraph>
      )}

      <Card className="hrp-card">
        <Tabs
        items={[
          {
            key: "users",
            label: "Пользователи",
            children: <Table rowKey="id" loading={loading} columns={userColumns} dataSource={users} size="small" />,
          },
          {
            key: "requests",
            label: "Заявки на регистрацию",
            children: <Table rowKey="id" loading={loading} columns={requestColumns} dataSource={requests} size="small" />,
          },
          {
            key: "sla_settings",
            label: "Настройки SLA",
            children: (
              <Card size="small">
                <Typography.Paragraph type="secondary">
                  Глобальные сроки по умолчанию для дедлайна замечаний (если не задано в справочнике проекта `review_sla_days`).
                </Typography.Paragraph>
                <Form form={slaForm} layout="vertical" style={{ maxWidth: 420 }}>
                  <Form.Item name="initial_days" label="Первая ревизия (дней)" rules={[{ required: true }]}>
                    <Input type="number" min={1} max={365} />
                  </Form.Item>
                  <Form.Item name="next_days" label="Следующая ревизия (дней)" rules={[{ required: true }]}>
                    <Input type="number" min={1} max={365} />
                  </Form.Item>
                  <Form.Item name="owner_dcc_incoming_days" label="Входной контроль ТДО заказчика (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Form.Item name="owner_specialist_review_days" label="Проверка специалистов заказчика (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Form.Item name="owner_lr_approval_days" label="Консолидация LR заказчика (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Form.Item name="contractor_consideration_days" label="Рассмотрение комментариев подрядчиком (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Form.Item name="contractor_ap_issue_days" label="Перевыпуск при AP (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Form.Item name="contractor_an_issue_days" label="Перевыпуск при AN (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Form.Item name="contractor_co_rj_issue_days" label="Перевыпуск при CO/RJ (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Form.Item name="owner_final_approval_days" label="Финальное рассмотрение заказчиком (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Form.Item name="owner_stamp_days" label="Проставление штампа (дн.)" rules={[{ required: true }]}>
                    <Input type="number" min={0.1} step={0.1} />
                  </Form.Item>
                  <Button
                    type="primary"
                    disabled={!isMainAdmin}
                    onClick={async () => {
                      const values = await slaForm.validateFields();
                      await updateAdminReviewSlaSettings({
                        initial_days: Number(values.initial_days),
                        next_days: Number(values.next_days),
                        owner_dcc_incoming_days: Number(values.owner_dcc_incoming_days),
                        owner_specialist_review_days: Number(values.owner_specialist_review_days),
                        owner_lr_approval_days: Number(values.owner_lr_approval_days),
                        contractor_consideration_days: Number(values.contractor_consideration_days),
                        contractor_ap_issue_days: Number(values.contractor_ap_issue_days),
                        contractor_an_issue_days: Number(values.contractor_an_issue_days),
                        contractor_co_rj_issue_days: Number(values.contractor_co_rj_issue_days),
                        owner_final_approval_days: Number(values.owner_final_approval_days),
                        owner_stamp_days: Number(values.owner_stamp_days),
                      });
                      message.success("SLA настройки обновлены");
                    }}
                  >
                    Сохранить SLA
                  </Button>
                </Form>
              </Card>
            ),
          },
        ]}
        />
      </Card>

      <Modal
        open={createOpen}
        title="Создать пользователя"
        onCancel={() => setCreateOpen(false)}
        onOk={async () => {
          const values = await createForm.validateFields();
          await createUser(values);
          message.success("Пользователь создан");
          createForm.resetFields();
          setCreateOpen(false);
          await loadData();
        }}
      >
        <Form form={createForm} layout="vertical" initialValues={{ company_type: "contractor", role: "user" }}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="full_name" label="ФИО" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="company_code"
            label="Код компании (3 символа)"
            normalize={(value: string) => (value ?? "").toUpperCase().slice(0, 3)}
            rules={[{ len: 3, message: "Ровно 3 символа" }, { pattern: /^[A-Z]*$/, message: "Только A-Z" }]}
          >
            <Input placeholder="CTR" maxLength={3} />
          </Form.Item>
          <Form.Item name="company_type" label="Компания" rules={[{ required: true }]}>
            <Select options={companyOptions} />
          </Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select options={visibleRoleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={permissionsOpen}
        title={`Права действий: ${selectedUser?.email ?? ""}`}
        onCancel={() => setPermissionsOpen(false)}
        onOk={async () => {
          if (!selectedUser) return;
          const values = await permissionsForm.validateFields();
          await updateUserPermissions(selectedUser.id, values);
          message.success("Права обновлены");
          setPermissionsOpen(false);
          await loadData();
        }}
      >
        <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
          <Typography.Text strong>Пресет прав</Typography.Text>
          <Select
            style={{ width: 360 }}
            value={permissionsPresetId}
            onChange={(value) => {
              const presetId = value as PermissionPresetId;
              setPermissionsPresetId(presetId);
              if (!selectedUser) return;
              if (presetId === "custom") {
                permissionsForm.setFieldsValue(selectedUser.permissions);
                return;
              }
              const preset = permissionPresets[presetId];
              const next = permissionFields.reduce((acc, item) => {
                acc[item.key] = Boolean(preset.permissions[item.key]);
                return acc;
              }, {} as UserPermissions);
              permissionsForm.setFieldsValue(next);
            }}
            options={[
              { value: "lr_owner", label: permissionPresets.lr_owner.label },
              { value: "contractor_tdo_lead", label: permissionPresets.contractor_tdo_lead.label },
              { value: "contractor_developer", label: permissionPresets.contractor_developer.label },
              { value: "custom", label: "Свои настройки" },
            ]}
          />
        </Space>
        <Form form={permissionsForm} layout="vertical">
          {permissionFields.map((item) => (
            <Form.Item key={item.key} name={item.key} label={item.label} valuePropName="checked">
              <Switch onChange={() => setPermissionsPresetId("custom")} />
            </Form.Item>
          ))}
        </Form>
      </Modal>

      <Modal
        open={editOpen}
        title={`Редактировать: ${selectedUser?.email ?? ""}`}
        onCancel={() => setEditOpen(false)}
        onOk={async () => {
          if (!selectedUser) return;
          const values = await editForm.validateFields();
          await updateUser(selectedUser.id, values);
          message.success("Данные пользователя обновлены");
          setEditOpen(false);
          await loadData();
        }}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="full_name" label="ФИО" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="company_code"
            label="Код компании (3 символа)"
            normalize={(value: string) => (value ?? "").toUpperCase().slice(0, 3)}
            rules={[{ len: 3, message: "Ровно 3 символа" }, { pattern: /^[A-Z]*$/, message: "Только A-Z" }]}
          >
            <Input placeholder="CTR" maxLength={3} />
          </Form.Item>
          <Form.Item name="company_type" label="Компания" rules={[{ required: true }]}>
            <Select options={companyOptions} />
          </Form.Item>
          <Form.Item name="is_active" label="Активен" rules={[{ required: true }]}>
            <Select options={[{ value: true, label: "Да" }, { value: false, label: "Нет" }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={roleOpen}
        title={`Изменить роль: ${selectedUser?.email ?? ""}`}
        onCancel={() => setRoleOpen(false)}
        onOk={async () => {
          if (!selectedUser) return;
          const values = await roleForm.validateFields();
          await updateUserRole(selectedUser.id, values.role as UserRole);
          message.success("Роль обновлена");
          setRoleOpen(false);
          await loadData();
        }}
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={passwordOpen}
        title={`Сменить пароль: ${selectedUser?.email ?? ""}`}
        onCancel={() => setPasswordOpen(false)}
        onOk={async () => {
          if (!selectedUser) return;
          const values = await passwordForm.validateFields();
          await updateUserPassword(selectedUser.id, values.new_password);
          message.success("Пароль обновлен");
          setPasswordOpen(false);
        }}
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item name="new_password" label="Новый пароль" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={sessionsOpen}
        title={`Сессии пользователя: ${selectedUser?.email ?? ""}`}
        width={980}
        footer={null}
        onCancel={() => setSessionsOpen(false)}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={sessions}
          pagination={false}
          columns={[
            { title: "ID", dataIndex: "id", key: "id", width: 80 },
            { title: "IP", dataIndex: "ip_address", key: "ip_address", render: (value) => value ?? "—" },
            { title: "Страна", dataIndex: "country", key: "country", render: (value) => value ?? "—" },
            {
              title: "Устройство",
              dataIndex: "user_agent",
              key: "user_agent",
              render: (value: string | null) => value ?? "—",
            },
            { title: "Создана", dataIndex: "created_at", key: "created_at" },
            { title: "Последняя активность", dataIndex: "last_seen_at", key: "last_seen_at" },
            {
              title: "Статус",
              key: "status",
              render: (_, row) => (
                <Tag color={row.is_active ? "green" : "default"}>
                  {row.is_active ? "ACTIVE" : "REVOKED/EXPIRED"}
                </Tag>
              ),
            },
            {
              title: "Действие",
              key: "actions",
              render: (_, row) => (
                <Button
                  size="small"
                  danger
                  disabled={!row.is_active || !selectedUser}
                  onClick={async () => {
                    if (!selectedUser) return;
                    await revokeUserSession(selectedUser.id, row.id);
                    message.success("Сессия отключена");
                    const data = await listUserSessions(selectedUser.id);
                    setSessions(data);
                  }}
                >
                  Удалить сессию
                </Button>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={approveOpen}
        title={`Одобрить заявку: ${selectedRequest?.email ?? ""}`}
        onCancel={() => setApproveOpen(false)}
        onOk={async () => {
          if (!selectedRequest) return;
          const values = await approveForm.validateFields();
          await approveRegistrationRequest(selectedRequest.id, values);
          message.success("Заявка одобрена");
          setApproveOpen(false);
          await loadData();
        }}
      >
        <Form form={approveForm} layout="vertical">
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="company_type" label="Компания" rules={[{ required: true }]}>
            <Select options={companyOptions} />
          </Form.Item>
          <Form.Item name="is_active" label="Активен" rules={[{ required: true }]}>
            <Select
              options={[
                { value: true, label: "Да" },
                { value: false, label: "Нет" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={rejectOpen}
        title={`Отклонить заявку: ${selectedRequest?.email ?? ""}`}
        onCancel={() => setRejectOpen(false)}
        onOk={async () => {
          if (!selectedRequest) return;
          const values = await rejectForm.validateFields();
          await rejectRegistrationRequest(selectedRequest.id, values.review_note ?? "");
          message.success("Заявка отклонена");
          setRejectOpen(false);
          await loadData();
        }}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="review_note" label="Комментарий к отклонению">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={quickOpen}
        title="Быстрый мастер демо-процесса"
        onCancel={() => setQuickOpen(false)}
        onOk={async () => {
          const values = await quickForm.validateFields();
          const result = await createQuickDemoSetup(values);
          setQuickResult(result);
          message.success("Демо-процесс создан");
          await loadData();
        }}
        okText="Создать демо-процесс"
      >
        <Typography.Paragraph>
          Создаст подрядчика, заказчика и готовую демо-цепочку: MDR → Document → Revision → Comment → Response.
        </Typography.Paragraph>
        <Form form={quickForm} layout="vertical">
          <Form.Item name="contractor_email" label="Email подрядчика" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="owner_email" label="Email заказчика" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Пароль для двух пользователей" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
        </Form>

        {quickResult && (
          <div style={{ marginTop: 12, background: "#fafafa", border: "1px solid #f0f0f0", padding: 12 }}>
            <Typography.Text strong>Созданы демо-учетные данные:</Typography.Text>
            <div>Подрядчик: {quickResult.contractor_email}</div>
            <div>Заказчик: {quickResult.owner_email}</div>
            <div>Пароль: {quickResult.password}</div>
            <div style={{ marginTop: 8 }}>
              IDs: MDR #{quickResult.mdr_id}, Document #{quickResult.document_id}, Revision #{quickResult.revision_id}
            </div>
          </div>
        )}
      </Modal>

      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Текущий пользователь: {currentUser.full_name} ({currentUser.email})
      </Typography.Paragraph>
    </div>
  );
}
