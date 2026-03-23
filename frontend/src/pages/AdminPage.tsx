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
      const text = error instanceof Error ? error.message : "Failed to load admin data";
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
    { title: "Name", dataIndex: "full_name", key: "full_name" },
    { title: "Company", dataIndex: "company_type", key: "company_type" },
    {
      title: "Role",
      dataIndex: "role",
      key: "role",
      render: (value: UserRole) => <Tag color={value === "admin" ? "purple" : "blue"}>{value}</Tag>,
    },
    {
      title: "Active",
      dataIndex: "is_active",
      key: "is_active",
      render: (value: boolean) => (value ? <Tag color="green">ACTIVE</Tag> : <Tag color="red">INACTIVE</Tag>),
    },
    {
      title: "Actions",
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
            Change role
          </Button>
          <Button
            size="small"
            onClick={async () => {
              await setUserActive(row.id, !row.is_active);
              message.success("User status updated");
              await loadData();
            }}
            disabled={!isMainAdmin}
          >
            {row.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Popconfirm
            title="Delete user?"
            description="This action cannot be undone"
            onConfirm={async () => {
              await deleteUser(row.id);
              message.success("User deleted");
              await loadData();
            }}
            okText="Delete"
            cancelText="Cancel"
            disabled={!isMainAdmin}
          >
            <Button danger size="small" disabled={!isMainAdmin}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const requestColumns: ColumnsType<RegistrationRequest> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    { title: "Email", dataIndex: "email", key: "email" },
    { title: "Name", dataIndex: "full_name", key: "full_name" },
    { title: "Company", dataIndex: "company_type", key: "company_type" },
    {
      title: "Requested role",
      dataIndex: "requested_role",
      key: "requested_role",
      render: (value: UserRole | null) => value ?? "-",
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (value: RegistrationRequest["status"]) => {
        const color = value === "PENDING" ? "gold" : value === "APPROVED" ? "green" : "red";
        return <Tag color={color}>{value}</Tag>;
      },
    },
    {
      title: "Actions",
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
            Approve
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
            Reject
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Admin: Users and access
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
            Quick demo setup
          </Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            + Create user
          </Button>
        </Space>
      </Space>

      {!isMainAdmin && (
        <Typography.Paragraph type="warning">
          Вы вошли как обычный админ. Создание пользователей доступно, но назначение admin-роли, удаление,
          деактивация и апрув заявок доступны только главному админу ({currentUser.email}).
        </Typography.Paragraph>
      )}

      <Tabs
        items={[
          {
            key: "users",
            label: "Users",
            children: <Table rowKey="id" loading={loading} columns={userColumns} dataSource={users} />,
          },
          {
            key: "requests",
            label: "Registration requests",
            children: <Table rowKey="id" loading={loading} columns={requestColumns} dataSource={requests} />,
          },
        ]}
      />

      <Modal
        open={createOpen}
        title="Create user"
        onCancel={() => setCreateOpen(false)}
        onOk={async () => {
          const values = await createForm.validateFields();
          await createUser(values);
          message.success("User created");
          createForm.resetFields();
          setCreateOpen(false);
          await loadData();
        }}
      >
        <Form form={createForm} layout="vertical" initialValues={{ company_type: "contractor", role: "viewer" }}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="full_name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="company_type" label="Company" rules={[{ required: true }]}>
            <Select options={companyOptions} />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={visibleRoleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={roleOpen}
        title={`Change role: ${selectedUser?.email ?? ""}`}
        onCancel={() => setRoleOpen(false)}
        onOk={async () => {
          if (!selectedUser) return;
          const values = await roleForm.validateFields();
          await updateUserRole(selectedUser.id, values.role as UserRole);
          message.success("Role updated");
          setRoleOpen(false);
          await loadData();
        }}
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={approveOpen}
        title={`Approve request: ${selectedRequest?.email ?? ""}`}
        onCancel={() => setApproveOpen(false)}
        onOk={async () => {
          if (!selectedRequest) return;
          const values = await approveForm.validateFields();
          await approveRegistrationRequest(selectedRequest.id, values);
          message.success("Request approved");
          setApproveOpen(false);
          await loadData();
        }}
      >
        <Form form={approveForm} layout="vertical">
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="company_type" label="Company" rules={[{ required: true }]}>
            <Select options={companyOptions} />
          </Form.Item>
          <Form.Item name="is_active" label="Active" rules={[{ required: true }]}>
            <Select
              options={[
                { value: true, label: "Yes" },
                { value: false, label: "No" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={rejectOpen}
        title={`Reject request: ${selectedRequest?.email ?? ""}`}
        onCancel={() => setRejectOpen(false)}
        onOk={async () => {
          if (!selectedRequest) return;
          const values = await rejectForm.validateFields();
          await rejectRegistrationRequest(selectedRequest.id, values.review_note ?? "");
          message.success("Request rejected");
          setRejectOpen(false);
          await loadData();
        }}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="review_note" label="Reject note">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={quickOpen}
        title="Quick demo setup"
        onCancel={() => setQuickOpen(false)}
        onOk={async () => {
          const values = await quickForm.validateFields();
          const result = await createQuickDemoSetup(values);
          setQuickResult(result);
          message.success("Demo workflow created");
          await loadData();
        }}
        okText="Create demo flow"
      >
        <Typography.Paragraph>
          Создаст подрядчика, заказчика и готовую демо-цепочку:
          MDR → Document → Revision → Comment → Response.
        </Typography.Paragraph>
        <Form form={quickForm} layout="vertical">
          <Form.Item
            name="contractor_email"
            label="Contractor email"
            rules={[{ required: true, type: "email" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="owner_email" label="Owner email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password for both users" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
        </Form>

        {quickResult && (
          <div style={{ marginTop: 12, background: "#fafafa", border: "1px solid #f0f0f0", padding: 12 }}>
            <Typography.Text strong>Created demo credentials:</Typography.Text>
            <div>Contractor: {quickResult.contractor_email}</div>
            <div>Owner: {quickResult.owner_email}</div>
            <div>Password: {quickResult.password}</div>
            <div style={{ marginTop: 8 }}>
              IDs: MDR #{quickResult.mdr_id}, Document #{quickResult.document_id}, Revision #{quickResult.revision_id}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
