import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tree,
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
import DocumentsPage from "./DocumentsPage";
import MdrPage from "./MdrPage";
import type {
  DocumentItem,
  MDRRecord,
  ProjectItem,
  ProjectMember,
  ProjectMemberRole,
  ProjectReference,
  ReviewMatrixMember,
  User,
} from "../types";

interface Props {
  currentUser: User;
  projects: ProjectItem[];
  mdr: MDRRecord[];
  documents: DocumentItem[];
  notificationTarget?: { project_code?: string | null; document_num?: string | null; revision_id?: number | null } | null;
  onNotificationTargetHandled?: () => void;
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
  { key: "title_object", label: "Титульные объекты" },
  { key: "discipline", label: "Дисциплины" },
  { key: "document_type", label: "Типы документов" },
  { key: "identifier_pattern", label: "Шаблоны шифрования" },
  { key: "numbering_attribute", label: "Атрибуты нумерации" },
  { key: "se_reporting_type", label: "SE отчеты" },
  { key: "procurement_request_type", label: "Типы запросов закупки" },
  { key: "equipment_type", label: "Типы оборудования" },
  { key: "review_sla_days", label: "SLA обсуждения ревизий" },
  { key: "other", label: "Прочее" },
];

export default function ProjectsPage({
  currentUser,
  projects,
  mdr,
  documents,
  notificationTarget,
  onNotificationTargetHandled,
  onReload,
}: Props): JSX.Element {
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
  const isAdmin = currentUser.role === "admin";
  const canManageMatrix = isAdmin || currentUser.permissions.can_manage_review_matrix;
  const canEditReferences = isAdmin || currentUser.permissions.can_edit_project_references;
  const canManageMembers =
    isAdmin || currentUser.permissions.can_manage_projects || canManageMatrix || currentUser.permissions.can_manage_users;

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!notificationTarget?.project_code) return;
    const targetProject = projects.find((item) => item.code === notificationTarget.project_code);
    if (targetProject && targetProject.id !== selectedProjectId) {
      setSelectedProjectId(targetProject.id);
    }
  }, [notificationTarget?.project_code, projects, selectedProjectId]);

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
  const selectableMemberUsers = useMemo(() => {
    if (isAdmin) return users;
    const isContractorLead = currentUser.company_type === "contractor";
    if (!isContractorLead) return users;
    const ownCode = (currentUser.company_code ?? "").toUpperCase();
    return users.filter(
      (user) =>
        user.company_type === "contractor" &&
        user.role === "user" &&
        (user.company_code ?? "").toUpperCase() === ownCode,
    );
  }, [currentUser.company_code, currentUser.company_type, isAdmin, users]);
  const selectableMemberRoles = useMemo(() => {
    if (isAdmin || currentUser.company_type !== "contractor") {
      return projectMemberRoleOptions;
    }
    return projectMemberRoleOptions.filter((item) =>
      item.value === "contractor_member" || item.value === "contractor_tdo_lead",
    );
  }, [currentUser.company_type, isAdmin]);
  const ownerProjectMemberOptions = useMemo(() => {
    const ownerMemberUserIds = new Set(
      members
        .filter((member) => member.member_role === "owner_member" || member.member_role === "observer")
        .map((member) => member.user_id),
    );
    return users
      .filter((user) => user.company_type === "owner" && ownerMemberUserIds.has(user.id))
      .map((user) => ({ value: user.id, label: `${user.full_name} (${user.email})` }));
  }, [members, users]);

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
            description="Проект и все связанные данные будут удалены без восстановления"
            onConfirm={async () => {
              try {
                await deleteProject(row.id, { purge: true, confirmCode: row.code });
                message.success("Проект удален");
                if (selectedProjectId === row.id) {
                  setSelectedProjectId(null);
                  setMembers([]);
                  setReferences([]);
                }
                await onReload();
              } catch (error) {
                const text = error instanceof Error ? error.message : "Не удалось удалить проект";
                message.error(text);
              }
            }}
            disabled={!isAdmin && !currentUser.permissions.can_manage_projects}
          >
            <Button
              size="small"
              danger
              disabled={!isAdmin && !currentUser.permissions.can_manage_projects}
            >
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
        if (row.user_full_name || row.user_email) {
          return `${row.user_full_name ?? "—"} (${row.user_email ?? "—"})`;
        }
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
          disabled={!canManageMembers}
          onConfirm={async () => {
            if (!selectedProjectId) return;
            await deleteProjectMember(selectedProjectId, row.id);
            message.success("Участник удален");
            await reloadProjectData();
          }}
        >
          <Button size="small" danger disabled={!canManageMembers}>
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
          disabled={!canEditReferences}
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
    {
      title: "Пользователь",
      key: "user_id",
      render: (_, row) =>
        row.user_full_name
          ? `${row.user_full_name} (${row.user_email ?? "—"})`
          : userById.get(row.user_id)?.full_name ?? row.user_id,
    },
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

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const projectMdr = useMemo(
    () => (selectedProject ? mdr.filter((row) => row.project_code === selectedProject.code) : []),
    [mdr, selectedProject],
  );
  const projectMdrIds = useMemo(() => new Set(projectMdr.map((row) => row.id)), [projectMdr]);
  const projectDocuments = useMemo(() => documents.filter((item) => projectMdrIds.has(item.mdr_id)), [documents, projectMdrIds]);
  const disciplineOptions = useMemo(
    () =>
      references
        .filter((ref) => ref.ref_type === "discipline" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [references],
  );
  const documentTypeOptions = useMemo(
    () =>
      references
        .filter((ref) => ref.ref_type === "document_type" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [references],
  );
  const hierarchyTree = useMemo(
    () => [
      {
        key: `project-${selectedProject?.id ?? "none"}`,
        title: selectedProject ? `${selectedProject.code} - ${selectedProject.name}` : "Проект не выбран",
        children: [
          {
            key: "mdr-root",
            title: `Реестр документов (${projectMdr.length})`,
            children: Object.entries(
              projectMdr.reduce<Record<string, typeof projectMdr>>((acc, item) => {
                const key = item.category || "UNSPECIFIED";
                acc[key] = acc[key] ?? [];
                acc[key].push(item);
                return acc;
              }, {}),
            ).map(([category, items]) => {
              const usedWeight = items.reduce((sum, item) => sum + Number(item.doc_weight || 0), 0);
              return {
                key: `category-${category}`,
                title: `${category} (вес: ${usedWeight.toFixed(1)} / 1000)`,
                children: items.map((item) => ({
                  key: `mdr-${item.id}`,
                  title: `${item.doc_number} - ${item.doc_name}`,
                })),
              };
            }),
          },
        ],
      },
    ],
    [projectMdr, selectedProject],
  );

  return (
    <div className="projects-module">
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Проекты
        </Typography.Title>
        <Button type="primary" onClick={() => setProjectOpen(true)} disabled={!isAdmin && !currentUser.permissions.can_manage_projects}>
          + Создать проект
        </Button>
      </Space>

      <Card style={{ marginBottom: 16 }} className="hrp-card">
        <Table rowKey="id" columns={projectColumns} dataSource={projects} pagination={false} />
      </Card>

      <Card title={`Карточка проекта: ${selectedProjectId ?? "—"}`} className="hrp-card">
        <Typography.Text type="secondary">
          Иерархия проекта: проект -&gt; реестр документов -&gt; ревизии и комментарии.
        </Typography.Text>
        <Divider style={{ margin: "12px 0" }} />
        <Tree defaultExpandAll treeData={hierarchyTree} style={{ marginBottom: 16 }} />
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
                      disabled={!selectedProjectId || !canManageMembers}
                    >
                      + Добавить участника
                    </Button>
                  </Space>
                  <Table rowKey="id" columns={memberColumns} dataSource={members} pagination={false} />
                </>
              ),
            },
            ...(canManageMatrix
              ? [
                  {
              key: "matrix",
              label: "Матрица назначений",
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      onClick={() => setMatrixOpen(true)}
                      disabled={!selectedProjectId || !canManageMatrix}
                    >
                      + Добавить строку матрицы
                    </Button>
                  </Space>
                  <Table rowKey="id" columns={matrixColumns} dataSource={reviewMatrix} pagination={false} />
                </>
              ),
                  },
                ]
              : []),
            {
              key: "mdr",
              label: "Реестр документов",
              children: (
                <MdrPage
                  mdr={projectMdr}
                  projects={selectedProject ? [selectedProject] : []}
                  currentUser={currentUser}
                  projectReferences={references}
                  onCreated={onReload}
                />
              ),
            },
            {
              key: "documents",
              label: "Ревизии и комментарии",
              children: (
                <DocumentsPage
                  documents={projectDocuments}
                  mdr={projectMdr}
                  currentUser={currentUser}
                  projectMembers={members}
                  notificationTarget={notificationTarget}
                  onNotificationTargetHandled={onNotificationTargetHandled}
                />
              ),
            },
            ...(canEditReferences
              ? [{
              key: "references",
              label: "Справочники проекта",
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      onClick={() => setReferenceOpen(true)}
                      disabled={!selectedProjectId || !canEditReferences}
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
                        <>
                          {tab.key === "review_sla_days" && (
                            <Typography.Text type="secondary">
                              Формат кода: <b>CATEGORY:ISSUE_PURPOSE:INITIAL|NEXT</b>, значение - число дней.
                              Примеры: <b>PD:IFR:INITIAL = 20</b>, <b>*:*:NEXT = 7</b>.
                            </Typography.Text>
                          )}
                          <Table
                            rowKey="id"
                            columns={referenceColumns}
                            dataSource={references.filter((ref) => ref.ref_type === tab.key)}
                            pagination={false}
                          />
                        </>
                      ),
                    }))}
                  />
                </>
              ),
            }]
              : []),
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
          <Form.Item
            name="code"
            label="Код проекта"
            normalize={(value: string) => (value ?? "").toUpperCase().slice(0, 3)}
            rules={[{ required: true }, { len: 3, message: "Ровно 3 символа" }, { pattern: /^[A-Z]{3}$/, message: "Только A-Z" }]}
          >
            <Input placeholder="IVA" maxLength={3} />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Город столиц" />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={3} />
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
              options={selectableMemberUsers.map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }))}
            />
          </Form.Item>
          <Form.Item name="member_role" label="Роль в проекте" rules={[{ required: true }]}>
            <Select options={selectableMemberRoles} />
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
                { value: "title_object", label: "title_object" },
                { value: "numbering_attribute", label: "numbering_attribute" },
                { value: "discipline", label: "discipline" },
                { value: "document_type", label: "document_type" },
                { value: "se_reporting_type", label: "se_reporting_type" },
                { value: "procurement_request_type", label: "procurement_request_type" },
                { value: "equipment_type", label: "equipment_type" },
                { value: "identifier_pattern", label: "identifier_pattern" },
                { value: "review_sla_days", label: "review_sla_days" },
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
        title="Добавить строку в матрицу назначений"
        onCancel={() => setMatrixOpen(false)}
        onOk={async () => {
          try {
            if (!selectedProjectId) return;
            const values = await matrixForm.validateFields();
            await createReviewMatrixItem(selectedProjectId, { ...values, level: 1 });
            message.success("Строка матрицы добавлена");
            setMatrixOpen(false);
            matrixForm.resetFields();
            await reloadProjectData();
          } catch (error) {
            const text = error instanceof Error ? error.message : "Ошибка создания строки матрицы";
            message.error(text);
          }
        }}
      >
        <Form form={matrixForm} layout="vertical" initialValues={{ level: 1, state: "R" }}>
          <Form.Item name="discipline_code" label="Дисциплина" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={disciplineOptions}
              placeholder="Выберите из справочника дисциплин"
            />
          </Form.Item>
          <Form.Item name="doc_type" label="Тип документа" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={documentTypeOptions}
              placeholder="Выберите из справочника типов документов"
            />
          </Form.Item>
          <Form.Item name="user_id" label="Сотрудник" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={ownerProjectMemberOptions}
              placeholder="Только owner-участники проекта"
            />
          </Form.Item>
          <Form.Item name="state" label="Состояние" rules={[{ required: true }]}>
            <Select options={[{ value: "R", label: "R" }, { value: "LR", label: "LR" }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={matrixEditOpen}
        title="Изменить строку матрицы назначений"
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
          <Form.Item name="state" label="Состояние" rules={[{ required: true }]}>
            <Select options={[{ value: "R", label: "R" }, { value: "LR", label: "LR" }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
