import {
  Button,
  Card,
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
  addProjectMember,
  createReviewMatrixItem,
  createProject,
  createProjectReference,
  deleteReviewMatrixItem,
  deleteProject,
  deleteProjectMember,
  listProjectMembers,
  listProjectReferences,
  listReviewMatrix,
  listUsers,
  updateProjectReference,
  updateReviewMatrixItem,
} from "../api";
import type { ProjectItem, ProjectMember, ProjectMemberRole, ProjectReference, ReviewMatrixMember, User } from "../types";

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

const referenceTabs: { key: string; label: string }[] = [
  { key: "document_category", label: "Категории документов" },
  { key: "discipline", label: "Дисциплины" },
  { key: "document_type", label: "Типы документов" },
  { key: "identifier_pattern", label: "Шаблоны шифрования" },
  { key: "numbering_attribute", label: "Атрибуты нумерации" },
  { key: "se_reporting_type", label: "SE отчеты" },
  { key: "procurement_request_type", label: "Типы запросов закупки" },
  { key: "equipment_type", label: "Типы оборудования" },
  { key: "other", label: "Прочее" },
];

export default function ProjectsPage({ currentUser, projects, onReload }: Props): JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [reviewMatrix, setReviewMatrix] = useState<ReviewMatrixMember[]>([]);

  const [projectOpen, setProjectOpen] = useState(false);
  const [projectForm] = Form.useForm();

  const [memberOpen, setMemberOpen] = useState(false);
  const [memberForm] = Form.useForm();

  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceForm] = Form.useForm();

  const [referenceEditOpen, setReferenceEditOpen] = useState(false);
  const [referenceEditForm] = Form.useForm();
  const [selectedReference, setSelectedReference] = useState<ProjectReference | null>(null);
  const [activeReferenceType, setActiveReferenceType] = useState<string>(referenceTabs[0].key);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixEditOpen, setMatrixEditOpen] = useState(false);
  const [matrixForm] = Form.useForm();
  const [matrixEditForm] = Form.useForm();
  const [selectedMatrixItem, setSelectedMatrixItem] = useState<ReviewMatrixMember | null>(null);

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
      const [membersResp, refsResp, matrixResp] = await Promise.all([
        listProjectMembers(selectedProjectId),
        listProjectReferences(selectedProjectId),
        listReviewMatrix(selectedProjectId),
      ]);
      setMembers(membersResp);
      setReferences(refsResp);
      setReviewMatrix(matrixResp);
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
        <Space>
          <Button size="small" onClick={() => setSelectedProjectId(row.id)}>
            Открыть
          </Button>
          <Popconfirm
            title="Удалить проект?"
            description="Проект удалится только если в нем нет MDR"
            onConfirm={async () => {
              await deleteProject(row.id);
              message.success("Проект удален");
              if (selectedProjectId === row.id) {
                setSelectedProjectId(null);
                setMembers([]);
                setReferences([]);
              }
              await onReload();
            }}
            disabled={currentUser.role !== "admin"}
          >
            <Button size="small" danger disabled={currentUser.role !== "admin"}>
              Удалить
            </Button>
          </Popconfirm>
        </Space>
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
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Popconfirm
          title="Удалить участника?"
          onConfirm={async () => {
            if (!selectedProjectId) return;
            await deleteProjectMember(selectedProjectId, row.id);
            message.success("Участник удален");
            await reloadProjectData();
          }}
        >
          <Button size="small" danger>
            Удалить
          </Button>
        </Popconfirm>
      ),
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

  const matrixColumns: ColumnsType<ReviewMatrixMember> = [
    { title: "Дисциплина", dataIndex: "discipline_code", key: "discipline_code" },
    { title: "Тип документа", dataIndex: "doc_type", key: "doc_type" },
    { title: "Пользователь", key: "user_id", render: (_, row) => userById.get(row.user_id)?.full_name ?? row.user_id },
    { title: "Уровень", dataIndex: "level", key: "level" },
    { title: "Состояние", dataIndex: "state", key: "state", render: (v: "LR" | "R") => <Tag>{v}</Tag> },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setSelectedMatrixItem(row);
              matrixEditForm.setFieldsValue({ level: row.level, state: row.state });
              setMatrixEditOpen(true);
            }}
          >
            Изменить
          </Button>
          <Popconfirm
            title="Удалить строку матрицы?"
            onConfirm={async () => {
              await deleteReviewMatrixItem(row.id);
              message.success("Строка матрицы удалена");
              await reloadProjectData();
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
              key: "matrix",
              label: "Матрица проверки",
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button onClick={() => setMatrixOpen(true)} disabled={!selectedProjectId}>
                      + Добавить строку матрицы
                    </Button>
                  </Space>
                  <Table rowKey="id" columns={matrixColumns} dataSource={reviewMatrix} pagination={false} />
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
                  <Tabs
                    activeKey={activeReferenceType}
                    onChange={setActiveReferenceType}
                    items={referenceTabs.map((tab) => ({
                      key: tab.key,
                      label: tab.label,
                      children: (
                        <Table
                          rowKey="id"
                          columns={referenceColumns}
                          dataSource={references.filter((ref) => ref.ref_type === tab.key)}
                          pagination={false}
                        />
                      ),
                    }))}
                  />
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
        <Form form={referenceForm} layout="vertical" initialValues={{ is_active: true, ref_type: activeReferenceType }}>
          <Form.Item name="ref_type" label="Тип" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "document_category", label: "document_category" },
                { value: "numbering_attribute", label: "numbering_attribute" },
                { value: "discipline", label: "discipline" },
                { value: "document_type", label: "document_type" },
                { value: "se_reporting_type", label: "se_reporting_type" },
                { value: "procurement_request_type", label: "procurement_request_type" },
                { value: "equipment_type", label: "equipment_type" },
                { value: "identifier_pattern", label: "identifier_pattern" },
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

      <Modal
        open={matrixOpen}
        title="Добавить строку матрицы проверки"
        onCancel={() => setMatrixOpen(false)}
        onOk={async () => {
          if (!selectedProjectId) return;
          const values = await matrixForm.validateFields();
          await createReviewMatrixItem(selectedProjectId, values);
          message.success("Строка матрицы добавлена");
          setMatrixOpen(false);
          matrixForm.resetFields();
          await reloadProjectData();
        }}
      >
        <Form form={matrixForm} layout="vertical" initialValues={{ level: 1, state: "R" }}>
          <Form.Item name="discipline_code" label="Дисциплина" rules={[{ required: true }]}>
            <Input placeholder="PI" />
          </Form.Item>
          <Form.Item name="doc_type" label="Тип документа" rules={[{ required: true }]}>
            <Input placeholder="DWG" />
          </Form.Item>
          <Form.Item name="user_id" label="Сотрудник" rules={[{ required: true }]}>
            <Select options={users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }))} />
          </Form.Item>
          <Form.Item name="level" label="Уровень" rules={[{ required: true }]}>
            <Select options={[{ value: 1, label: "1" }, { value: 2, label: "2" }]} />
          </Form.Item>
          <Form.Item name="state" label="Состояние" rules={[{ required: true }]}>
            <Select options={[{ value: "R", label: "R" }, { value: "LR", label: "LR" }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={matrixEditOpen}
        title="Изменить строку матрицы"
        onCancel={() => setMatrixEditOpen(false)}
        onOk={async () => {
          if (!selectedMatrixItem) return;
          const values = await matrixEditForm.validateFields();
          await updateReviewMatrixItem(selectedMatrixItem.id, values);
          message.success("Строка матрицы обновлена");
          setMatrixEditOpen(false);
          await reloadProjectData();
        }}
      >
        <Form form={matrixEditForm} layout="vertical">
          <Form.Item name="level" label="Уровень" rules={[{ required: true }]}>
            <Select options={[{ value: 1, label: "1" }, { value: 2, label: "2" }]} />
          </Form.Item>
          <Form.Item name="state" label="Состояние" rules={[{ required: true }]}>
            <Select options={[{ value: "R", label: "R" }, { value: "LR", label: "LR" }]} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
