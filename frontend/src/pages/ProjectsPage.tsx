import { Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  addProjectMember,
  createProject,
  createProjectReference,
  listProjectMembers,
  listProjectReferences,
  listUsers,
  updateProjectReference,
} from "../api";
import type { ProjectItem, ProjectMember, ProjectMemberRole, ProjectReference, User } from "../types";

interface Props {
  currentUser: User;
  projects: ProjectItem[];
  onReload: () => Promise<void>;
}

const projectMemberRoleOptions: { value: ProjectMemberRole; label: string }[] = [
  { value: "main_admin", label: "main_admin" },
  { value: "contractor_tdo_lead", label: "contractor_tdo_lead" },
  { value: "contractor_member", label: "contractor_member" },
  { value: "owner_member", label: "owner_member" },
  { value: "observer", label: "observer" },
];

export default function ProjectsPage({ currentUser, projects, onReload }: Props): JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [projectOpen, setProjectOpen] = useState(false);
  const [projectForm] = Form.useForm();

  const [memberOpen, setMemberOpen] = useState(false);
  const [memberForm] = Form.useForm();

  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceForm] = Form.useForm();

  const [referenceEditOpen, setReferenceEditOpen] = useState(false);
  const [referenceEditForm] = Form.useForm();
  const [selectedReference, setSelectedReference] = useState<ProjectReference | null>(null);

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => {
        setUsers([]);
      });
  }, []);

  const reloadProjectData = async () => {
    if (!selectedProjectId) return;

    try {
      const [membersResp, refsResp] = await Promise.all([
        listProjectMembers(selectedProjectId),
        listProjectReferences(selectedProjectId),
      ]);
      setMembers(membersResp);
      setReferences(refsResp);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка загрузки проекта";
      message.error(text);
    }
  };

  useEffect(() => {
    void reloadProjectData();
  }, [selectedProjectId]);

  const userById = useMemo(() => {
    return new Map(users.map((u) => [u.id, u]));
  }, [users]);

  const projectColumns: ColumnsType<ProjectItem> = [
    { title: "Код", dataIndex: "code", key: "code" },
    { title: "Название", dataIndex: "name", key: "name" },
    { title: "Создан", dataIndex: "created_at", key: "created_at" },
    { title: "Обновлен", dataIndex: "updated_at", key: "updated_at" },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Button size="small" onClick={() => setSelectedProjectId(row.id)}>
          Открыть
        </Button>
      ),
    },
  ];

  const memberColumns: ColumnsType<ProjectMember> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    {
      title: "Пользователь",
      key: "user",
      render: (_, row) => {
        const user = userById.get(row.user_id);
        return user ? `${user.full_name} (${user.email})` : `user_id=${row.user_id}`;
      },
    },
    {
      title: "Роль в проекте",
      dataIndex: "member_role",
      key: "member_role",
      render: (value: ProjectMemberRole) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: "Приглашение подрядчика",
      dataIndex: "can_manage_contractor_users",
      key: "can_manage_contractor_users",
      render: (value: boolean) => (value ? <Tag color="green">Да</Tag> : <Tag>Нет</Tag>),
    },
  ];

  const referenceColumns: ColumnsType<ProjectReference> = [
    { title: "Тип", dataIndex: "ref_type", key: "ref_type" },
    { title: "Код", dataIndex: "code", key: "code" },
    { title: "Значение", dataIndex: "value", key: "value" },
    {
      title: "Активен",
      dataIndex: "is_active",
      key: "is_active",
      render: (value: boolean) => (value ? <Tag color="green">Да</Tag> : <Tag color="red">Нет</Tag>),
    },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Button
          size="small"
          disabled={currentUser.role !== "admin"}
          onClick={() => {
            setSelectedReference(row);
            referenceEditForm.setFieldsValue({ value: row.value, is_active: row.is_active });
            setReferenceEditOpen(true);
          }}
        >
          Изменить
        </Button>
      ),
    },
  ];

  const contractorUsers = users.filter((u) => u.company_type === "contractor");

  return (
    <>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Проекты
        </Typography.Title>
        <Button type="primary" onClick={() => setProjectOpen(true)} disabled={currentUser.role !== "admin"}>
          + Создать проект
        </Button>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <Table rowKey="id" columns={projectColumns} dataSource={projects} pagination={false} />
      </Card>

      <Card title={`Карточка проекта: ${selectedProjectId ?? "—"}`}>
        <Tabs
          items={[
            {
              key: "members",
              label: "Участники проекта",
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      onClick={() => setMemberOpen(true)}
                      disabled={!selectedProjectId}
                    >
                      + Добавить участника
                    </Button>
                  </Space>
                  <Table rowKey="id" columns={memberColumns} dataSource={members} pagination={false} />
                </>
              ),
            },
            {
              key: "references",
              label: "Справочники проекта",
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      onClick={() => setReferenceOpen(true)}
                      disabled={!selectedProjectId || currentUser.role !== "admin"}
                    >
                      + Добавить значение
                    </Button>
                  </Space>
                  <Table rowKey="id" columns={referenceColumns} dataSource={references} pagination={false} />
                </>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={projectOpen}
        title="Создать карточку проекта"
        onCancel={() => setProjectOpen(false)}
        onOk={async () => {
          const values = await projectForm.validateFields();
          await createProject(values);
          message.success("Проект создан");
          setProjectOpen(false);
          projectForm.resetFields();
          await onReload();
        }}
      >
        <Form form={projectForm} layout="vertical">
          <Form.Item name="code" label="Код проекта" rules={[{ required: true }]}>
            <Input placeholder="IVA" />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Город столиц" />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="contractor_tdo_manager_user_id" label="Руководитель ТДО подрядчика">
            <Select
              allowClear
              options={contractorUsers.map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={memberOpen}
        title="Добавить участника в проект"
        onCancel={() => setMemberOpen(false)}
        onOk={async () => {
          if (!selectedProjectId) {
            message.warning("Сначала выберите проект");
            return;
          }
          const values = await memberForm.validateFields();
          await addProjectMember(selectedProjectId, values);
          message.success("Участник добавлен");
          setMemberOpen(false);
          memberForm.resetFields();
          await reloadProjectData();
        }}
      >
        <Form form={memberForm} layout="vertical">
          <Form.Item name="user_id" label="Пользователь" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }))}
            />
          </Form.Item>
          <Form.Item name="member_role" label="Роль в проекте" rules={[{ required: true }]}>
            <Select options={projectMemberRoleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={referenceOpen}
        title="Добавить значение справочника"
        onCancel={() => setReferenceOpen(false)}
        onOk={async () => {
          if (!selectedProjectId) {
            message.warning("Сначала выберите проект");
            return;
          }
          const values = await referenceForm.validateFields();
          await createProjectReference(selectedProjectId, values);
          message.success("Справочник обновлен");
          setReferenceOpen(false);
          referenceForm.resetFields();
          await reloadProjectData();
        }}
      >
        <Form form={referenceForm} layout="vertical" initialValues={{ is_active: true }}>
          <Form.Item name="ref_type" label="Тип" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "discipline", label: "discipline" },
                { value: "document_type", label: "document_type" },
                { value: "document_class", label: "document_class" },
                { value: "other", label: "other" },
              ]}
            />
          </Form.Item>
          <Form.Item name="code" label="Код" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="value" label="Значение" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label="Активен" rules={[{ required: true }]}>
            <Select options={[{ value: true, label: "Да" }, { value: false, label: "Нет" }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={referenceEditOpen}
        title={`Изменить справочник: ${selectedReference?.code ?? ""}`}
        onCancel={() => setReferenceEditOpen(false)}
        onOk={async () => {
          if (!selectedReference) return;
          const values = await referenceEditForm.validateFields();
          await updateProjectReference(selectedReference.id, values);
          message.success("Справочник обновлен");
          setReferenceEditOpen(false);
          await reloadProjectData();
        }}
      >
        <Form form={referenceEditForm} layout="vertical">
          <Form.Item name="value" label="Значение" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label="Активен" rules={[{ required: true }]}>
            <Select options={[{ value: true, label: "Да" }, { value: false, label: "Нет" }]} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
