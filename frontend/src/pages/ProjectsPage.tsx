import {
  Button,
  Card,
  Divider,
  Form,
  Input,
  Modal,
  Spin,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { formatDateTimeRu } from "../utils/datetime";

import {
  addProjectMember,
  createReviewMatrixItem,
  createProject,
  createProjectReference,
  downloadProjectReferencesTemplate,
  deleteReviewMatrixItem,
  deleteProject,
  deleteProjectMember,
  exportProjectReferences,
  importProjectReferences,
  listProjectMembers,
  listProjectReferences,
  listReviewMatrix,
  listUsers,
  getCipherTemplate,
  composeMdrCipher,
  upsertCipherTemplate,
  updateProject,
  updateProjectReference,
  updateReviewMatrixItem,
} from "../api";
import DocumentsPage from "./DocumentsPage";
import MdrPage from "./MdrPage";
import type {
  CipherTemplateField,
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
  { value: "main_admin", label: "Главный администратор" },
  { value: "contractor_tdo_lead", label: "ТДО разработчика" },
  { value: "contractor_member", label: "Участник разработчика" },
  { value: "owner_member", label: "R/LR заказчика" },
  { value: "observer", label: "Наблюдатель" },
];

const referenceTabs: { key: string; label: string }[] = [
  { key: "document_category", label: "Категории документов" },
  { key: "title_object", label: "Титульные объекты" },
  { key: "pd_section", label: "Раздел ПД" },
  { key: "discipline", label: "Дисциплины" },
  { key: "mark", label: "Марки" },
  { key: "mark_discipline", label: "Связь марка-дисциплина" },
  { key: "document_type", label: "Типы документов" },
  { key: "identifier_pattern", label: "Шаблоны шифрования" },
  { key: "numbering_attribute", label: "Атрибуты нумерации" },
  { key: "se_reporting_type", label: "SE отчеты" },
  { key: "procurement_request_type", label: "Типы запросов закупки" },
  { key: "equipment_type", label: "Типы оборудования" },
  { key: "review_sla_days", label: "SLA обсуждения ревизий" },
  { key: "other", label: "Прочее" },
];

const documentCategoryOptions: { value: string; label: string }[] = [
  { value: "PF", label: "PF - Pre-FEED, предпроектные исследования" },
  { value: "BEP", label: "BEP - Базовый проект / Basic Engineering Package" },
  { value: "SE", label: "SE - Инженерные изыскания / Engineering Survey" },
  { value: "FD", label: "FD - FEED / Front End Engineering Design" },
  { value: "PD", label: "PD - Проектная документация / Design Documentation" },
  { value: "DD", label: "DD - Рабочая документация / Detailed Design Documentation" },
  { value: "PM", label: "PM - Документы управления проектом / Project Management Documents" },
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
  const [projectEditOpen, setProjectEditOpen] = useState(false);
  const [projectEditForm] = Form.useForm();
  const [selectedProjectForEdit, setSelectedProjectForEdit] = useState<ProjectItem | null>(null);

  const [memberOpen, setMemberOpen] = useState(false);
  const [memberForm] = Form.useForm();

  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceForm] = Form.useForm();
  const [refImporting, setRefImporting] = useState(false);

  const [referenceEditOpen, setReferenceEditOpen] = useState(false);
  const [referenceEditForm] = Form.useForm();
  const [selectedReference, setSelectedReference] = useState<ProjectReference | null>(null);
  const [activeReferenceType, setActiveReferenceType] = useState<string>(referenceTabs[0].key);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixEditOpen, setMatrixEditOpen] = useState(false);
  const [matrixForm] = Form.useForm();
  const [matrixEditForm] = Form.useForm();
  const [selectedMatrixItem, setSelectedMatrixItem] = useState<ReviewMatrixMember | null>(null);
  const [cipherOpen, setCipherOpen] = useState(false);
  const [cipherLoading, setCipherLoading] = useState(false);
  const [cipherFields, setCipherFields] = useState<CipherTemplateField[]>([]);
  const [cipherPreviewValues, setCipherPreviewValues] = useState<Record<string, string>>({});
  const [cipherPreviewResult, setCipherPreviewResult] = useState<string>("");
  const [activeTabKey, setActiveTabKey] = useState<string>("members");
  const [localNotificationTarget, setLocalNotificationTarget] = useState<{ project_code?: string | null; document_num?: string | null; revision_id?: number | null } | null>(null);
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

  const roleLabelByValue: Record<ProjectMemberRole, string> = useMemo(
    () =>
      projectMemberRoleOptions.reduce<Record<ProjectMemberRole, string>>((acc, item) => {
        acc[item.value] = item.label;
        return acc;
      }, {} as Record<ProjectMemberRole, string>),
    [],
  );
  const memberColumns: ColumnsType<ProjectMember> = [
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
      render: (value: ProjectMemberRole) => <Tag color="blue">{roleLabelByValue[value] ?? value}</Tag>,
    },
    ...(canManageMembers
      ? [
          { title: "ID", dataIndex: "id", key: "id", width: 80 },
          {
            title: "Приглашение подрядчика",
            dataIndex: "can_manage_contractor_users",
            key: "can_manage_contractor_users",
            render: (value: boolean) => (value ? <Tag color="green">Да</Tag> : <Tag>Нет</Tag>),
          },
          {
            title: "Действие",
            key: "action",
            render: (_: unknown, row: ProjectMember) => (
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
        ]
      : []),
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
    { title: "Раздел ПД", dataIndex: "discipline_code", key: "discipline_code" },
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
  const referenceTypeOptions = useMemo(
    () =>
      Array.from(new Set(references.map((ref) => ref.ref_type)))
        .sort()
        .map((value) => ({ value, label: value })),
    [references],
  );
  const referenceOptionsByType = useMemo(() => {
    const map = new Map<string, { value: string; label: string }[]>();
    references.forEach((ref) => {
      if (!ref.is_active) return;
      const list = map.get(ref.ref_type) ?? [];
      list.push({ value: ref.code, label: `${ref.code} - ${ref.value}` });
      map.set(ref.ref_type, list);
    });
    return map;
  }, [references]);
  const openCipherEditor = async () => {
    setCipherOpen(true);
    if (!selectedProject || !selectedProject.document_category) {
      setCipherFields([]);
      setCipherPreviewValues({});
      setCipherPreviewResult("");
      return;
    }
    setCipherLoading(true);
    try {
      const template = await getCipherTemplate(selectedProject.code, selectedProject.document_category);
      setCipherFields(
        template?.fields ?? [
          { order_index: 1, field_key: "project_code", label: "Код проекта", source_type: "STATIC", static_value: selectedProject.code, required: true, uppercase: true, separator: "-" },
          { order_index: 2, field_key: "originator_code", label: "Код разработчика", source_type: "CUSTOM_TEXT", required: true, uppercase: true, length: 3, separator: "-" },
          { order_index: 3, field_key: "category", label: "Категория", source_type: "STATIC", static_value: selectedProject.document_category, required: true, uppercase: true, separator: "-" },
          { order_index: 4, field_key: "title_object", label: "Титул", source_type: "REFERENCE", source_ref_type: "title_object", required: true, uppercase: true, separator: "-" },
          { order_index: 5, field_key: "discipline_code", label: "Дисциплина", source_type: "REFERENCE", source_ref_type: "discipline", required: true, uppercase: true, separator: "-" },
          { order_index: 6, field_key: "doc_type", label: "Тип документа", source_type: "REFERENCE", source_ref_type: "document_type", required: true, uppercase: true, separator: "-" },
          { order_index: 7, field_key: "serial_number", label: "Серийный номер", source_type: "AUTO_SERIAL", required: true, uppercase: false, length: 4, separator: "" },
        ],
      );
      setCipherPreviewValues({});
      setCipherPreviewResult("");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось загрузить шаблон шифра");
    } finally {
      setCipherLoading(false);
    }
  };
  const projectMdr = useMemo(
    () => (selectedProject ? mdr.filter((row) => row.project_code === selectedProject.code) : []),
    [mdr, selectedProject],
  );
  const projectMdrIds = useMemo(() => new Set(projectMdr.map((row) => row.id)), [projectMdr]);
  const projectDocuments = useMemo(() => documents.filter((item) => projectMdrIds.has(item.mdr_id)), [documents, projectMdrIds]);
  const disciplineOptions = useMemo(
    () =>
      references
        .filter((ref) => ref.ref_type === "pd_section" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [references],
  );
  const hierarchyTree = useMemo(
    () => {
      const treeTitle = (value: string, maxWidth = 560) => (
        <Typography.Text ellipsis={{ tooltip: value }} style={{ display: "inline-block", maxWidth, whiteSpace: "nowrap" }}>
          {value}
        </Typography.Text>
      );
      return [
        {
          key: `project-${selectedProject?.id ?? "none"}`,
          title: treeTitle(selectedProject ? `${selectedProject.code} - ${selectedProject.name}` : "Проект не выбран", 420),
          children: [
            {
              key: "mdr-root",
              title: treeTitle(`Реестр документов (${projectMdr.length})`, 320),
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
                  title: treeTitle(`${category} (вес: ${usedWeight.toFixed(1)} / 1000)`, 300),
                  children: items.map((item) => ({
                    key: `mdr-${item.id}`,
                    title: treeTitle(`${item.doc_number} - ${item.doc_name}`),
                  })),
                };
              }),
            },
          ],
        },
      ];
    },
    [projectMdr, selectedProject],
  );

  return (
    <div className="projects-module">
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Проекты
        </Typography.Title>
        <Space>
          {canEditReferences && (
            <Button onClick={() => void openCipherEditor()} disabled={!selectedProject} loading={cipherLoading}>
              Матрица шифрования
            </Button>
          )}
          <Button type="primary" onClick={() => setProjectOpen(true)} disabled={!isAdmin}>
            + Создать проект
          </Button>
        </Space>
      </Space>

      <Card title={`Карточка проекта: ${selectedProjectId ?? "—"}`} className="hrp-card">
        <Space style={{ marginBottom: 12 }}>
          <Typography.Text strong>Текущий проект:</Typography.Text>
          <Select
            style={{ minWidth: 320 }}
            value={selectedProjectId ?? undefined}
            onChange={(value) => setSelectedProjectId(value)}
            options={projects.map((item) => ({
              value: item.id,
              label: `${item.code} - ${item.name}`,
            }))}
            placeholder="Выберите проект"
          />
        </Space>
        <Divider style={{ margin: "0 0 12px 0" }} />
        <Tree defaultExpandAll treeData={hierarchyTree} style={{ marginBottom: 16 }} />
        <Tabs
          activeKey={activeTabKey}
          onChange={setActiveTabKey}
          items={[
            {
              key: "members",
              label: "Участники проекта",
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    {canManageMembers && (
                      <Button onClick={() => setMemberOpen(true)} disabled={!selectedProjectId}>
                        + Добавить участника
                      </Button>
                    )}
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
                  onOpenDocument={(documentNum) => {
                    setLocalNotificationTarget({
                      project_code: selectedProject?.code ?? null,
                      document_num: documentNum,
                      revision_id: null,
                    });
                    setActiveTabKey("documents");
                  }}
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
                  notificationTarget={localNotificationTarget ?? notificationTarget}
                  onNotificationTargetHandled={() => {
                    setLocalNotificationTarget(null);
                    onNotificationTargetHandled?.();
                  }}
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
                    <Button
                      disabled={!selectedProjectId || !canEditReferences}
                      onClick={async () => {
                        if (!selectedProjectId) return;
                        await downloadProjectReferencesTemplate(selectedProjectId, activeReferenceType);
                      }}
                    >
                      Шаблон Excel
                    </Button>
                    <Button
                      disabled={!selectedProjectId}
                      onClick={async () => {
                        if (!selectedProjectId) return;
                        await exportProjectReferences(selectedProjectId, activeReferenceType);
                      }}
                    >
                      Экспорт Excel
                    </Button>
                    <Button loading={refImporting} disabled={!selectedProjectId || !canEditReferences}>
                      <label style={{ cursor: "pointer" }}>
                        Импорт Excel
                        <input
                          type="file"
                          accept=".xlsx"
                          style={{ display: "none" }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !selectedProjectId) return;
                            try {
                              setRefImporting(true);
                              const result = await importProjectReferences(selectedProjectId, activeReferenceType, file);
                              message.success(`Импорт завершен: добавлено ${result.imported}, обновлено ${result.updated}`);
                              await reloadProjectData();
                            } catch (error) {
                              message.error(error instanceof Error ? error.message : "Ошибка импорта справочника");
                            } finally {
                              setRefImporting(false);
                              e.currentTarget.value = "";
                            }
                          }}
                        />
                      </label>
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
        open={cipherOpen}
        title={`Матрица шифрования: ${selectedProject?.code ?? "—"} / ${selectedProject?.document_category ?? "—"}`}
        width={900}
        onCancel={() => setCipherOpen(false)}
        onOk={async () => {
          if (!selectedProject?.document_category) return;
          await upsertCipherTemplate(selectedProject.code, selectedProject.document_category, cipherFields);
          message.success("Шаблон шифра сохранен");
          setCipherOpen(false);
        }}
      >
        {cipherLoading ? (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <Spin />
          </div>
        ) : (
          <>
        {!selectedProject?.document_category ? (
          <Typography.Paragraph type="warning">
            Для настройки матрицы сначала откройте проект и укажите категорию документа в карточке проекта.
          </Typography.Paragraph>
        ) : null}
        <Space style={{ marginBottom: 12 }}>
          <Button
            onClick={() =>
              setCipherFields((prev) => [
                ...prev,
                {
                  order_index: prev.length + 1,
                  field_key: `field_${prev.length + 1}`,
                  label: `Поле ${prev.length + 1}`,
                  source_type: "CUSTOM_TEXT",
                  required: true,
                  uppercase: true,
                  separator: "-",
                },
              ])
            }
          >
            + Поле
          </Button>
        </Space>
        <Table
          rowKey={(_, idx) => `cipher-field-${idx}`}
          pagination={false}
          dataSource={cipherFields}
          columns={[
            {
              title: "Порядок",
              width: 120,
              render: (_, __, idx) => (
                <Space>
                  <Button
                    size="small"
                    disabled={idx === 0}
                    onClick={() =>
                      setCipherFields((prev) => {
                        const next = [...prev];
                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                        return next.map((item, i) => ({ ...item, order_index: i + 1 }));
                      })
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    size="small"
                    disabled={idx === cipherFields.length - 1}
                    onClick={() =>
                      setCipherFields((prev) => {
                        const next = [...prev];
                        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                        return next.map((item, i) => ({ ...item, order_index: i + 1 }));
                      })
                    }
                  >
                    ↓
                  </Button>
                </Space>
              ),
            },
            {
              title: "Ключ",
              width: 120,
              render: (_, __, idx) => (
                <Input
                  value={cipherFields[idx].field_key}
                  onChange={(e) =>
                    setCipherFields((prev) => prev.map((item, i) => (i === idx ? { ...item, field_key: e.target.value } : item)))
                  }
                />
              ),
            },
            {
              title: "Название",
              width: 150,
              render: (_, __, idx) => (
                <Input
                  value={cipherFields[idx].label}
                  onChange={(e) =>
                    setCipherFields((prev) => prev.map((item, i) => (i === idx ? { ...item, label: e.target.value } : item)))
                  }
                />
              ),
            },
            {
              title: "Источник",
              width: 160,
              render: (_, __, idx) => (
                <Select
                  value={cipherFields[idx].source_type}
                  options={[
                    { value: "REFERENCE", label: "Справочник" },
                    { value: "CUSTOM_TEXT", label: "Пользовательский ввод" },
                    { value: "AUTO_SERIAL", label: "Авто-нумерация" },
                    { value: "STATIC", label: "Фикс. значение" },
                  ]}
                  onChange={(value) =>
                    setCipherFields((prev) => prev.map((item, i) => (i === idx ? { ...item, source_type: value } : item)))
                  }
                />
              ),
            },
            {
              title: "Ref type / static",
              width: 220,
              render: (_, __, idx) => (
                cipherFields[idx].source_type === "STATIC" ? (
                  <Input
                    value={cipherFields[idx].static_value ?? ""}
                    onChange={(e) =>
                      setCipherFields((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, static_value: e.target.value } : item)),
                      )
                    }
                  />
                ) : (
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Выберите справочник"
                    value={cipherFields[idx].source_ref_type ?? undefined}
                    options={referenceTypeOptions}
                    onChange={(value) =>
                      setCipherFields((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, source_ref_type: value ?? null } : item)),
                      )
                    }
                  />
                )
              ),
            },
            {
              title: "Длина",
              width: 90,
              render: (_, __, idx) => (
                <Input
                  value={cipherFields[idx].length ? String(cipherFields[idx].length) : ""}
                  onChange={(e) =>
                    setCipherFields((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, length: e.target.value ? Number(e.target.value) : null } : item)),
                    )
                  }
                />
              ),
            },
            {
              title: "Разделитель",
              width: 100,
              render: (_, __, idx) => (
                <Input
                  value={cipherFields[idx].separator}
                  onChange={(e) =>
                    setCipherFields((prev) => prev.map((item, i) => (i === idx ? { ...item, separator: e.target.value } : item)))
                  }
                />
              ),
            },
            {
              title: "Обяз.",
              width: 80,
              render: (_, __, idx) => (
                <Switch
                  size="small"
                  checked={cipherFields[idx].required}
                  onChange={(checked) =>
                    setCipherFields((prev) => prev.map((item, i) => (i === idx ? { ...item, required: checked } : item)))
                  }
                />
              ),
            },
            {
              title: "UPPER",
              width: 80,
              render: (_, __, idx) => (
                <Switch
                  size="small"
                  checked={cipherFields[idx].uppercase}
                  onChange={(checked) =>
                    setCipherFields((prev) => prev.map((item, i) => (i === idx ? { ...item, uppercase: checked } : item)))
                  }
                />
              ),
            },
            {
              title: "",
              width: 70,
              render: (_, __, idx) => (
                <Button danger size="small" onClick={() => setCipherFields((prev) => prev.filter((_, i) => i !== idx))}>
                  Удал.
                </Button>
              ),
            },
          ]}
          scroll={{ x: 1340 }}
        />
        <Divider style={{ margin: "12px 0" }} />
        <Typography.Text strong>Предпросмотр шифра</Typography.Text>
        <Space wrap style={{ marginTop: 8, marginBottom: 8 }}>
          {cipherFields
            .filter((field) => field.source_type === "CUSTOM_TEXT" || field.source_type === "REFERENCE")
            .map((field) =>
              field.source_type === "REFERENCE" ? (
                <Select
                  key={`preview-${field.field_key}`}
                  showSearch
                  optionFilterProp="label"
                  placeholder={field.label}
                  style={{ width: 220 }}
                  options={referenceOptionsByType.get(field.source_ref_type ?? "") ?? []}
                  value={cipherPreviewValues[field.field_key]}
                  onChange={(value) => setCipherPreviewValues((prev) => ({ ...prev, [field.field_key]: value ?? "" }))}
                />
              ) : (
                <Input
                  key={`preview-${field.field_key}`}
                  placeholder={field.label}
                  style={{ width: 220 }}
                  value={cipherPreviewValues[field.field_key] ?? ""}
                  onChange={(e) => setCipherPreviewValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))}
                />
              ),
            )}
          <Button
            disabled={!selectedProject?.document_category}
            onClick={async () => {
              if (!selectedProject?.document_category) return;
              try {
                const result = await composeMdrCipher({
                  project_code: selectedProject.code,
                  category: selectedProject.document_category,
                  values: cipherPreviewValues,
                });
                setCipherPreviewResult(result.cipher);
              } catch (error) {
                message.error(error instanceof Error ? error.message : "Не удалось построить предпросмотр");
              }
            }}
          >
            Построить
          </Button>
        </Space>
        {cipherPreviewResult ? (
          <Typography.Paragraph copyable style={{ marginBottom: 0 }}>
            {cipherPreviewResult}
          </Typography.Paragraph>
        ) : null}
          </>
        )}
      </Modal>

      <Modal
        open={projectOpen}
        title="Создать карточку проекта"
        onCancel={() => {
          setProjectOpen(false);
          projectForm.setFieldsValue({ code: "IMP", document_category: "PD" });
        }}
        onOk={async () => {
          const values = await projectForm.validateFields();
          await createProject({ ...values, code: "IMP", document_category: "PD" });
          message.success("Проект создан");
          setProjectOpen(false);
          projectForm.resetFields();
          await onReload();
        }}
      >
        <Form form={projectForm} layout="vertical" initialValues={{ code: "IMP", document_category: "PD" }}>
          <Form.Item
            name="code"
            label="Код проекта"
            normalize={(value: string) => (value ?? "").toUpperCase().slice(0, 3)}
            rules={[{ required: true }, { len: 3, message: "Ровно 3 символа" }, { pattern: /^[A-Z]{3}$/, message: "Только A-Z" }]}
          >
            <Input placeholder="IMP" maxLength={3} disabled />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Город столиц" />
          </Form.Item>
          <Form.Item name="document_category" label="Категория документа проекта" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Выберите одну категорию для проекта"
              options={documentCategoryOptions}
              disabled
            />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={projectEditOpen}
        title={`Редактировать проект: ${selectedProjectForEdit?.code ?? ""}`}
        onCancel={() => {
          setProjectEditOpen(false);
          setSelectedProjectForEdit(null);
        }}
        onOk={async () => {
          if (!selectedProjectForEdit) return;
          const values = await projectEditForm.validateFields();
          await updateProject(selectedProjectForEdit.id, { ...values, document_category: "PD" });
          message.success("Проект обновлен");
          setProjectEditOpen(false);
          setSelectedProjectForEdit(null);
          projectEditForm.resetFields();
          await onReload();
        }}
      >
        <Form form={projectEditForm} layout="vertical">
          <Form.Item label="Код проекта">
            <Input value={selectedProjectForEdit?.code ?? ""} disabled />
          </Form.Item>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Название проекта" />
          </Form.Item>
          <Form.Item name="document_category" label="Категория документа проекта" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={documentCategoryOptions} disabled />
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
            await createReviewMatrixItem(selectedProjectId, {
              ...values,
              doc_type: values.discipline_code,
              level: 1,
            });
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
          <Form.Item name="discipline_code" label="Раздел ПД" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={disciplineOptions}
              placeholder="Выберите раздел ПД"
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
