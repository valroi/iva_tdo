import {
  Button,
  Card,
  Form,
  Input,
  Tooltip,
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
  createProject,
  deleteProject,
  deleteProjectMember,
  listProjectMembers,
  listProjectReferences,
  listUsers,
} from "../api";
import type { ProjectItem, ProjectMember, ProjectMemberRole, ProjectReference, User } from "../types";

interface Props {
  currentUser: User;
  projects: ProjectItem[];
  onReload: () => Promise<void>;
  onOpenMdr: (projectCode: string, category?: string) => void;
}

const projectMemberRoleLabels = {
  main_admin: "Главный админ проекта",
  participant: "Участник проекта",
  observer: "Наблюдатель (только просмотр)",
};

const projectMemberRoleDescriptions = {
  main_admin: "Системная роль создателя проекта. Назначается автоматически.",
  participant: "Рабочий участник проекта: основные действия в рамках прав пользователя.",
  observer: "Доступ только на просмотр в рамках проекта.",
};

export default function ProjectsPage({ currentUser, projects, onReload, onOpenMdr }: Props): JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [projectOpen, setProjectOpen] = useState(false);
  const [projectForm] = Form.useForm();

  const [memberOpen, setMemberOpen] = useState(false);
  const [memberForm] = Form.useForm();
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [selectedCategoryCode, setSelectedCategoryCode] = useState<string>();

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
        <Space>
          <Button
            size="small"
            onClick={() => {
              setSelectedProjectId(row.id);
              setSelectedCategoryCode(undefined);
            }}
          >
            Выбрать
          </Button>
          <Popconfirm
            title="Удалить проект?"
            description="Проект удалится только если в нем нет MDR"
            onConfirm={async () => {
              try {
                await deleteProject(row.id);
                message.success("Проект удален");
                if (selectedProjectId === row.id) {
                  setSelectedProjectId(null);
                  setSelectedCategoryCode(undefined);
                  setMembers([]);
                  setReferences([]);
                }
                await onReload();
              } catch (error: unknown) {
                const text = error instanceof Error ? error.message : "Не удалось удалить проект";
                message.error(text);
              }
            }}
            disabled={!canDeleteProjects}
          >
            <Button size="small" danger disabled={!canDeleteProjects}>
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
      render: (value: ProjectMemberRole) => (
        <Tooltip title={projectMemberRoleDescriptions[value]}>
          <Tag color="blue">{projectMemberRoleLabels[value]}</Tag>
        </Tooltip>
      ),
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

  const canManageProjects = currentUser.role === "admin";
  const canDeleteProjects = currentUser.role === "admin";
  const selectedProject = projects.find((item) => item.id === selectedProjectId) ?? null;
  const categoryRefs = references.filter((ref) => ref.ref_type === "document_category" && ref.is_active);
  const selectedProjectCategoryOptions = useMemo(
    () => categoryRefs.map((ref) => ({ value: ref.code, label: `${ref.code} — ${ref.value}` })),
    [categoryRefs],
  );

  useEffect(() => {
    if (!selectedCategoryCode) return;
    const categoryExists = selectedProjectCategoryOptions.some((item) => item.value === selectedCategoryCode);
    if (!categoryExists) {
      setSelectedCategoryCode(undefined);
    }
  }, [selectedCategoryCode, selectedProjectCategoryOptions]);

  return (
    <>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Проекты
        </Typography.Title>
        <Space>
          <Tooltip title="Кнопка «Выбрать» открывает выбранный проект в нижней вкладке участников.">
            <Typography.Text type="secondary">Что делает «Выбрать»?</Typography.Text>
          </Tooltip>
          <Button type="primary" onClick={() => setProjectOpen(true)} disabled={!canManageProjects}>
            + Создать проект
          </Button>
        </Space>
      </Space>

      <Card style={{ marginBottom: 16 }}>
        <Table rowKey="id" columns={projectColumns} dataSource={projects} pagination={false} />
      </Card>

      <Card title={`Карточка проекта / Project card: ${selectedProjectId ?? "—"}`}>
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title="Переход в MDR / Go to MDR"
          extra={
            <Typography.Text type="secondary">
              Шаги: Проект → Категория → MDR
            </Typography.Text>
          }
        >
          <Space wrap>
            <Typography.Text>
              Проект: <strong>{selectedProject ? `${selectedProject.code} — ${selectedProject.name}` : "не выбран"}</strong>
            </Typography.Text>
            <Select
              style={{ minWidth: 240 }}
              placeholder="Категория / Category"
              value={selectedCategoryCode}
              onChange={setSelectedCategoryCode}
              disabled={!selectedProject}
              options={selectedProjectCategoryOptions}
            />
            <Button
              type="primary"
              disabled={!selectedProject}
              onClick={() => {
                if (!selectedProject) return;
                onOpenMdr(selectedProject.code, selectedCategoryCode);
              }}
            >
              Перейти в MDR / Open MDR
            </Button>
          </Space>
        </Card>
        <Tabs
          items={[
            {
              key: "members",
              label: "Участники проекта",
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Tooltip title="Кнопка «Выбрать» в таблице сверху определяет активный проект для этой вкладки">
                      <Typography.Text type="secondary">Текущий проект: {selectedProjectId ?? "не выбран"}</Typography.Text>
                    </Tooltip>
                    <Button
                      onClick={() => setMemberOpen(true)}
                      disabled={!selectedProjectId || !canManageProjects}
                    >
                      + Добавить участников
                    </Button>
                  </Space>
                  <Table rowKey="id" columns={memberColumns} dataSource={members} pagination={false} />
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
          <Form.Item
            name="code"
            label="Код проекта (3 заглавные буквы / 3 uppercase letters)"
            rules={[
              { required: true },
              { pattern: /^[A-Z]{3}$/, message: "Только 3 заглавные буквы, например IVA" },
            ]}
          >
            <Input
              placeholder="IVA"
              maxLength={3}
              onChange={(event) => {
                const next = event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
                projectForm.setFieldValue("code", next);
              }}
            />
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
        title="Добавить участников в проект"
        onCancel={() => setMemberOpen(false)}
        okButtonProps={{ loading: isAddingMember }}
        onOk={async () => {
          setIsAddingMember(true);
          try {
            if (!selectedProjectId) {
              message.warning("Сначала выберите проект");
              return;
            }
            const values = (await memberForm.validateFields()) as { user_ids: number[] };
            const uniqueUserIds = Array.from(new Set(values.user_ids));
            const results = await Promise.allSettled(
              uniqueUserIds.map((userId) => addProjectMember(selectedProjectId, { user_id: userId })),
            );

            let successCount = 0;
            let skippedCount = 0;
            const failed: string[] = [];
            results.forEach((result, index) => {
              const userId = uniqueUserIds[index];
              const user = userById.get(userId);
              const userLabel = user ? `${user.full_name} (${user.email})` : `ID ${userId}`;
              if (result.status === "fulfilled") {
                successCount += 1;
                return;
              }

              const errorText =
                result.reason instanceof Error ? result.reason.message : "Неизвестная ошибка при добавлении";
              if (errorText.toLowerCase().includes("already in project")) {
                skippedCount += 1;
                return;
              }
              failed.push(`${userLabel}: ${errorText}`);
            });

            if (successCount > 0) {
              await reloadProjectData();
            }
            if (failed.length === 0) {
              setMemberOpen(false);
              memberForm.resetFields();
            }

            message.success(
              `Обработано пользователей: добавлено/обновлено ${successCount}, пропущено ${skippedCount}, ошибок ${failed.length}.`,
            );
            if (failed.length > 0) {
              const preview = failed.slice(0, 2).join("; ");
              message.error(`Не удалось добавить часть пользователей: ${preview}${failed.length > 2 ? "..." : ""}`);
            }
          } catch (error: unknown) {
            const text = error instanceof Error ? error.message : "Не удалось добавить участника";
            message.error(text);
          } finally {
            setIsAddingMember(false);
          }
        }}
      >
        <Form form={memberForm} layout="vertical">
          <Form.Item
            name="user_ids"
            label="Пользователи"
            rules={[{ required: true, type: "array", min: 1, message: "Выберите хотя бы одного пользователя" }]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              options={users.map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }))}
            />
          </Form.Item>
          <Typography.Text type="secondary">
            Все выбранные пользователи будут добавлены как: <strong>Участник проекта</strong>.
          </Typography.Text>
        </Form>
      </Modal>
    </>
  );
}
