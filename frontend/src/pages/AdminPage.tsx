import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import {
  approveRegistrationRequest,
  createUser,
  deleteUser,
  deleteProjectReference,
  listProjects,
  listProjectReferences,
  listRegistrationRequests,
  listUsers,
  resetDemoData,
  rejectRegistrationRequest,
  setUserActive,
  updateProjectReference,
  updateUserPermissions,
  updateUserRole,
} from "../api";
import { roleDisplayRuEn, roleTooltipRuEn } from "../roles";
import type {
  CompanyType,
  ProjectItem,
  ProjectReference,
  RegistrationRequest,
  User,
  UserRole,
} from "../types";

interface Props {
  currentUser: User;
}

const roleOptions: { value: UserRole; label: string }[] = [
  { value: "admin", label: roleDisplayRuEn("admin") },
  { value: "owner_manager", label: roleDisplayRuEn("owner_manager") },
  { value: "owner_reviewer", label: roleDisplayRuEn("owner_reviewer") },
  { value: "contractor_manager", label: roleDisplayRuEn("contractor_manager") },
  { value: "contractor_author", label: roleDisplayRuEn("contractor_author") },
  { value: "viewer", label: roleDisplayRuEn("viewer") },
];

const companyOptions: { value: CompanyType; label: string }[] = [
  { value: "admin", label: "admin" },
  { value: "owner", label: "owner" },
  { value: "contractor", label: "contractor" },
];

const referenceTypeLabels: Record<string, string> = {
  document_category: "Категории документации",
  numbering_attribute: "Атрибуты нумерации",
  discipline: "Дисциплины",
  document_type: "Типы документов",
  facility_title: "Титулы объектов",
  pd_book: "Разделы ПД",
  se_reporting_type: "Типы отчетности SE",
  procurement_request_type: "Типы заявок на закупку",
  equipment_type: "Типы оборудования",
  identifier_pattern: "Шаблоны идентификаторов",
  other: "Прочее",
};

export default function AdminPage({ currentUser }: Props): JSX.Element {
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [referenceRows, setReferenceRows] = useState<ProjectReference[]>([]);
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [referenceEditOpen, setReferenceEditOpen] = useState(false);
  const [selectedReference, setSelectedReference] = useState<ProjectReference | null>(null);
  const [referenceEditForm] = Form.useForm();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();

  const [roleOpen, setRoleOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [roleForm] = Form.useForm();
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [permissionsForm] = Form.useForm();

  const [approveOpen, setApproveOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RegistrationRequest | null>(null);
  const [approveForm] = Form.useForm();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectForm] = Form.useForm();

  const loadData = async () => {
    setLoading(true);
    try {
      const usersResp = await listUsers();
      setUsers(usersResp);
      const projectsResp = await listProjects();
      setProjects(projectsResp);
      if (projectsResp.length === 0) {
        setReferenceRows([]);
        setSelectedProjectId(null);
      } else {
        const fallbackProjectId = selectedProjectId ?? projectsResp[0].id;
        const projectId = projectsResp.some((p) => p.id === fallbackProjectId) ? fallbackProjectId : projectsResp[0].id;
        setSelectedProjectId(projectId);
        const refs = await listProjectReferences(projectId);
        setReferenceRows(refs);
      }

      try {
        const reqResp = await listRegistrationRequests();
        setRequests(reqResp);
        setIsMainAdmin(true);
      } catch {
        setRequests([]);
        setIsMainAdmin(false);
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

  const visibleRoleOptions = roleOptions.filter((item) => isMainAdmin || item.value !== "admin");

  const userColumns: ColumnsType<User> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    { title: "Email", dataIndex: "email", key: "email" },
    { title: "ФИО", dataIndex: "full_name", key: "full_name" },
    { title: "Компания", dataIndex: "company_type", key: "company_type" },
    {
      title: "Роль",
      dataIndex: "role",
      key: "role",
      render: (value: UserRole) => (
        <Tooltip title={roleTooltipRuEn(value)}>
          <Tag color={value === "admin" ? "purple" : "blue"}>{roleDisplayRuEn(value)}</Tag>
        </Tooltip>
      ),
    },
    {
      title: "Код компании",
      dataIndex: "originator_code",
      key: "originator_code",
      render: (value: string | null | undefined) => value || "—",
    },
    {
      title: "Права",
      key: "permissions",
      render: (_, row) => (
        <Space size={4} wrap>
          <Tag color={row.can_manage_mdr ? "green" : "default"}>
            MDR: {row.can_manage_mdr ? "Да" : "Нет"}
          </Tag>
          <Tag color={row.can_manage_project_members ? "green" : "default"}>
            Участники проекта: {row.can_manage_project_members ? "Да" : "Нет"}
          </Tag>
        </Space>
      ),
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
              permissionsForm.setFieldsValue({
                originator_code: row.originator_code ?? "",
                can_manage_mdr: Boolean(row.can_manage_mdr),
                can_manage_project_members: Boolean(row.can_manage_project_members),
              });
              setPermissionsOpen(true);
            }}
            disabled={!isMainAdmin}
          >
            Права
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
                role: row.requested_role ?? "viewer",
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

  const referenceColumns: ColumnsType<ProjectReference> = [
    { title: "Тип", dataIndex: "ref_type", key: "ref_type", width: 220 },
    { title: "Код", dataIndex: "code", key: "code", width: 140 },
    { title: "Значение", dataIndex: "value", key: "value" },
    {
      title: "Активен",
      dataIndex: "is_active",
      key: "is_active",
      width: 100,
      render: (value: boolean) => (value ? <Tag color="green">Да</Tag> : <Tag color="default">Нет</Tag>),
    },
    {
      title: "Действия",
      key: "actions",
      width: 120,
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setSelectedReference(row);
              referenceEditForm.setFieldsValue({ value: row.value, is_active: row.is_active });
              setReferenceEditOpen(true);
            }}
          >
            Изменить
          </Button>
          <Popconfirm
            title="Удалить запись справочника?"
            description="Операция необратима."
            onConfirm={async () => {
              try {
                await deleteProjectReference(row.id);
                message.success("Запись удалена");
                await loadData();
              } catch (error: unknown) {
                const text = error instanceof Error ? error.message : "Не удалось удалить запись";
                message.error(text);
              }
            }}
          >
            <Button size="small" danger>
              Удалить
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Администрирование: пользователи и права
        </Typography.Title>
        <Space>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            + Создать пользователя
          </Button>
          <Popconfirm
            title="Очистить все рабочие данные?"
            description="Будут удалены проекты, MDR, документы, ревизии, комментарии и уведомления. Пользователи останутся."
            disabled={!isMainAdmin}
            onConfirm={async () => {
              try {
                const result = await resetDemoData();
                message.success(
                  `Данные очищены: проектов ${result.deleted_projects}, MDR ${result.deleted_mdr_records}, документов ${result.deleted_documents}`,
                );
                await loadData();
              } catch (error: unknown) {
                const text = error instanceof Error ? error.message : "Не удалось выполнить сброс данных";
                message.error(text);
              }
            }}
          >
            <Button danger disabled={!isMainAdmin}>
              Сбросить рабочие данные
            </Button>
          </Popconfirm>
        </Space>
      </Space>

      {!isMainAdmin && (
        <Typography.Paragraph type="warning">
          Вы вошли как обычный администратор. Создание пользователей доступно, но назначение admin-роли,
          удаление, деактивация и апрув заявок доступны только главному админу.
        </Typography.Paragraph>
      )}

      <Tabs
        tabPosition="left"
        items={[
          {
            key: "users",
            label: "Пользователи",
            children: <Table rowKey="id" loading={loading} columns={userColumns} dataSource={users} />,
          },
          {
            key: "requests",
            label: "Заявки на регистрацию",
            children: <Table rowKey="id" loading={loading} columns={requestColumns} dataSource={requests} />,
          },
          {
            key: "references",
            label: "Справочники",
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                <Select
                  style={{ minWidth: 360 }}
                  placeholder="Выберите проект"
                  value={selectedProjectId ?? undefined}
                  onChange={async (value) => {
                    setSelectedProjectId(value);
                    const refs = await listProjectReferences(value);
                    setReferenceRows(refs);
                  }}
                  options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
                />
                <Tabs
                  type="card"
                  items={Object.entries(referenceTypeLabels).map(([refType, label]) => ({
                    key: refType,
                    label,
                    children: (
                      <Table
                        rowKey="id"
                        loading={loading}
                        columns={referenceColumns}
                        dataSource={referenceRows.filter((row) => row.ref_type === refType)}
                      />
                    ),
                  }))}
                />
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={referenceEditOpen}
        title={`Изменить справочник: ${selectedReference?.code ?? ""}`}
        onCancel={() => setReferenceEditOpen(false)}
        onOk={async () => {
          if (!selectedReference) return;
          const values = await referenceEditForm.validateFields();
          try {
            await updateProjectReference(selectedReference.id, values);
            message.success("Запись справочника обновлена");
            setReferenceEditOpen(false);
            await loadData();
          } catch (error: unknown) {
            const text = error instanceof Error ? error.message : "Не удалось обновить запись справочника";
            message.error(text);
          }
        }}
      >
        <Form form={referenceEditForm} layout="vertical">
          <Form.Item name="value" label="Значение" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label="Активен" rules={[{ required: true }]}>
            <Select
              options={[
                { value: true, label: "Да / Yes" },
                { value: false, label: "Нет / No" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

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
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{
            company_type: "contractor",
            role: "viewer",
            can_manage_mdr: false,
            can_manage_project_members: false,
          }}
        >
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="full_name" label="ФИО" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="company_type" label="Компания" rules={[{ required: true }]}>
            <Select options={companyOptions} />
          </Form.Item>
          <Form.Item name="role" label="Роль" rules={[{ required: true }]}>
            <Select
              options={visibleRoleOptions}
              optionRender={(option) => (
                <Tooltip title={roleTooltipRuEn(option.value as UserRole)}>
                  <span>{String(option.label)}</span>
                </Tooltip>
              )}
            />
          </Form.Item>
          <Form.Item name="originator_code" label="Код компании разработчика (BBB)">
            <Input maxLength={10} placeholder="CTR" />
          </Form.Item>
          <Form.Item name="can_manage_mdr" label="Право: вносить записи в MDR" rules={[{ required: true }]}>
            <Select
              options={[
                { value: true, label: "Да / Yes" },
                { value: false, label: "Нет / No" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="can_manage_project_members"
            label="Право: добавлять пользователей в проект"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: true, label: "Да / Yes" },
                { value: false, label: "Нет / No" },
              ]}
            />
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
            <Select
              options={roleOptions}
              optionRender={(option) => (
                <Tooltip title={roleTooltipRuEn(option.value as UserRole)}>
                  <span>{String(option.label)}</span>
                </Tooltip>
              )}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={permissionsOpen}
        title={`Права пользователя: ${selectedUser?.email ?? ""}`}
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
        <Form form={permissionsForm} layout="vertical">
          <Form.Item name="originator_code" label="Код компании разработчика (BBB)">
            <Input maxLength={10} placeholder="CTR" />
          </Form.Item>
          <Form.Item name="can_manage_mdr" label="Право: вносить записи в MDR" rules={[{ required: true }]}>
            <Select
              options={[
                { value: true, label: "Да / Yes" },
                { value: false, label: "Нет / No" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="can_manage_project_members"
            label="Право: добавлять пользователей в проект"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: true, label: "Да / Yes" },
                { value: false, label: "Нет / No" },
              ]}
            />
          </Form.Item>
        </Form>
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
            <Select
              options={roleOptions}
              optionRender={(option) => (
                <Tooltip title={roleTooltipRuEn(option.value as UserRole)}>
                  <span>{String(option.label)}</span>
                </Tooltip>
              )}
            />
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

      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        Текущий пользователь: {currentUser.full_name} ({currentUser.email})
      </Typography.Paragraph>
    </>
  );
}
