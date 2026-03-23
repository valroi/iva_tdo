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
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  approveRegistrationRequest,
  createQuickDemoSetup,
  createUser,
  deleteUser,
  listRegistrationRequests,
  listUsers,
  rejectRegistrationRequest,
  setUserActive,
  updateUserRole,
} from "../api";
import type { CompanyType, QuickDemoSetupResult, RegistrationRequest, User, UserRole } from "../types";

interface Props {
  currentUser: User;
}

const roleOptions: { value: UserRole; label: string }[] = [
  { value: "admin", label: "admin" },
  { value: "owner_manager", label: "owner_manager" },
  { value: "owner_reviewer", label: "owner_reviewer" },
  { value: "contractor_manager", label: "contractor_manager" },
  { value: "contractor_author", label: "contractor_author" },
  { value: "viewer", label: "viewer" },
];

const companyOptions: { value: CompanyType; label: string }[] = [
  { value: "admin", label: "admin" },
  { value: "owner", label: "owner" },
  { value: "contractor", label: "contractor" },
];

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
              roleForm.setFieldsValue({ role: row.role });
              setRoleOpen(true);
            }}
            disabled={!isMainAdmin}
          >
            Изменить роль
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

  return (
    <>
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

      <Tabs
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
        ]}
      />

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
        <Form form={createForm} layout="vertical" initialValues={{ company_type: "contractor", role: "viewer" }}>
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
            <Select options={visibleRoleOptions} />
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
    </>
  );
}
