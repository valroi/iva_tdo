import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import {
  createMr,
  createMrInvitation,
  createMrTag,
  deleteMr,
  deleteMrDocument,
  deleteMrTag,
  listMr,
  listMrDocuments,
  listMrInvitations,
  listMrTags,
  listProjects,
  revokeMrInvitation,
  updateMr,
  uploadMrDocument,
} from "../api";
import ProcessHint from "../components/ProcessHint";
import type {
  MrDocumentItem,
  MrItem,
  MrStatus,
  MrTagItem,
  ProjectItem,
  User,
  VendorInvitationItem,
} from "../types";
import { formatDeadlineRu } from "../utils/datetime";

interface Props {
  currentUser: User;
}

const MR_STATUS_LABEL: Record<MrStatus, string> = {
  DRAFT: "Черновик",
  OPEN: "Приём заявок открыт",
  CLOSED: "Приём закрыт",
  AWARDED: "Победитель выбран",
};

const MR_STATUS_COLOR: Record<MrStatus, string> = {
  DRAFT: "default",
  OPEN: "processing",
  CLOSED: "warning",
  AWARDED: "success",
};

export default function VendorsPage({ currentUser }: Props): JSX.Element {
  const { message, modal } = App.useApp();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [mrList, setMrList] = useState<MrItem[]>([]);
  const [selectedMrId, setSelectedMrId] = useState<number | null>(null);
  const [tags, setTags] = useState<MrTagItem[]>([]);
  const [documents, setDocuments] = useState<MrDocumentItem[]>([]);
  const [invitations, setInvitations] = useState<VendorInvitationItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [createForm] = Form.useForm();
  const [tagForm] = Form.useForm();
  const [inviteForm] = Form.useForm();
  const [docFile, setDocFile] = useState<File | null>(null);

  const isContractor = currentUser.company_type === "contractor";

  const selectedMr = useMemo(() => mrList.find((m) => m.id === selectedMrId) ?? null, [mrList, selectedMrId]);

  const loadMr = async () => {
    try {
      const items = await listMr();
      setMrList(items);
      if (selectedMrId === null && items.length > 0) {
        setSelectedMrId(items[0].id);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось загрузить список MR");
    }
  };

  useEffect(() => {
    void loadMr();
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedMrId === null) {
      setTags([]);
      setDocuments([]);
      return;
    }
    void (async () => {
      try {
        const [t, d, inv] = await Promise.all([
          listMrTags(selectedMrId),
          listMrDocuments(selectedMrId),
          listMrInvitations(selectedMrId),
        ]);
        setTags(t);
        setDocuments(d);
        setInvitations(inv);
      } catch {
        setTags([]);
        setDocuments([]);
        setInvitations([]);
      }
    })();
  }, [selectedMrId]);

  const reloadDetails = async () => {
    if (selectedMrId === null) return;
    const [t, d, inv] = await Promise.all([
      listMrTags(selectedMrId),
      listMrDocuments(selectedMrId),
      listMrInvitations(selectedMrId),
    ]);
    setTags(t);
    setDocuments(d);
    setInvitations(inv);
    await loadMr();
  };

  const mrColumns: ColumnsType<MrItem> = [
    { title: "Код MR", dataIndex: "code", key: "code", width: 160 },
    { title: "Название", dataIndex: "title", key: "title", ellipsis: true },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      width: 180,
      render: (s: MrStatus) => <Tag color={MR_STATUS_COLOR[s]}>{MR_STATUS_LABEL[s]}</Tag>,
    },
    { title: "Тегов", dataIndex: "tags_count", key: "tags_count", width: 80 },
    { title: "Подрядчиков", dataIndex: "invitations_count", key: "invitations_count", width: 110 },
    { title: "Дедлайн", dataIndex: "deadline_at", key: "deadline_at", width: 140, render: (v) => formatDeadlineRu(v) },
  ];

  const tagColumns: ColumnsType<MrTagItem> = [
    { title: "Тег", dataIndex: "tag_code", key: "tag_code", width: 160 },
    { title: "Наименование", dataIndex: "name", key: "name", ellipsis: true },
    { title: "Кол-во", dataIndex: "quantity", key: "quantity", width: 90, render: (v) => v ?? "—" },
    { title: "Ед.", dataIndex: "unit", key: "unit", width: 80, render: (v) => v ?? "—" },
    {
      title: "Действие",
      key: "action",
      width: 110,
      render: (_, row) => (
        <Button
          size="small"
          danger
          onClick={async () => {
            if (selectedMrId === null) return;
            try {
              await deleteMrTag(selectedMrId, row.id);
              message.success("Тег удалён");
              await reloadDetails();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Не удалось удалить тег");
            }
          }}
        >
          Удалить
        </Button>
      ),
    },
  ];

  const docColumns: ColumnsType<MrDocumentItem> = [
    { title: "Название", dataIndex: "title", key: "title", ellipsis: true },
    { title: "Файл", dataIndex: "file_name", key: "file_name", ellipsis: true },
    {
      title: "Размер",
      dataIndex: "size_bytes",
      key: "size_bytes",
      width: 110,
      render: (v: number | null) => (v ? `${(v / 1024).toFixed(0)} КБ` : "—"),
    },
    {
      title: "Действие",
      key: "action",
      width: 110,
      render: (_, row) => (
        <Button
          size="small"
          danger
          onClick={async () => {
            if (selectedMrId === null) return;
            try {
              await deleteMrDocument(selectedMrId, row.id);
              message.success("Документ удалён");
              await reloadDetails();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Не удалось удалить документ");
            }
          }}
        >
          Удалить
        </Button>
      ),
    },
  ];

  if (isContractor) {
    return (
      <Card>
        <Typography.Text type="secondary">
          Раздел «Вендоры» доступен только сотрудникам заказчика. Подрядчики работают с MR по
          персональной ссылке-приглашению.
        </Typography.Text>
      </Card>
    );
  }

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Вендоры — заявки на поставку (MR)
        </Typography.Title>
        <Button type="primary" onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>
          + Создать MR
        </Button>
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать с модулем Вендоры"
        steps={[
          "Создайте MR (Material Requisition) — заявку на поставку, привяжите к проекту.",
          "Добавьте теги (позиции оборудования) и документы заказчика.",
          "Приглашения подрядчиков, цены и вопросы появятся в следующих обновлениях.",
        ]}
      />

      <Card style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          columns={mrColumns}
          dataSource={mrList}
          pagination={{ pageSize: 8 }}
          rowClassName={(row) => (row.id === selectedMrId ? "ant-table-row-selected" : "")}
          onRow={(row) => ({ onClick: () => setSelectedMrId(row.id), style: { cursor: "pointer" } })}
          locale={{ emptyText: "Пока нет ни одной MR. Создайте первую." }}
        />
      </Card>

      {selectedMr && (
        <Card
          title={`Карточка MR: ${selectedMr.code} — ${selectedMr.title}`}
          extra={
            <Space>
              <Select<MrStatus>
                size="small"
                value={selectedMr.status}
                style={{ width: 200 }}
                options={(Object.keys(MR_STATUS_LABEL) as MrStatus[]).map((s) => ({ value: s, label: MR_STATUS_LABEL[s] }))}
                onChange={async (status) => {
                  try {
                    await updateMr(selectedMr.id, { status });
                    message.success("Статус MR обновлён");
                    await loadMr();
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : "Не удалось обновить статус");
                  }
                }}
              />
              {selectedMr.status === "DRAFT" && selectedMr.invitations_count === 0 && (
                <Button
                  size="small"
                  danger
                  onClick={() =>
                    modal.confirm({
                      title: "Удалить MR?",
                      content: `MR ${selectedMr.code} будет удалена со всеми тегами и документами.`,
                      okText: "Удалить",
                      okButtonProps: { danger: true },
                      cancelText: "Отмена",
                      onOk: async () => {
                        try {
                          await deleteMr(selectedMr.id);
                          message.success("MR удалена");
                          setSelectedMrId(null);
                          await loadMr();
                        } catch (error) {
                          message.error(error instanceof Error ? error.message : "Не удалось удалить MR");
                        }
                      },
                    })
                  }
                >
                  Удалить MR
                </Button>
              )}
            </Space>
          }
        >
          <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 12 }}>
            <Typography.Text type="secondary">
              Проект: {projects.find((p) => p.id === selectedMr.project_id)?.code ?? selectedMr.project_id} · Валюта:{" "}
              {selectedMr.currency} · Дедлайн: {formatDeadlineRu(selectedMr.deadline_at)} · Ответственный (LR):{" "}
              {selectedMr.lr_user_name ?? "не назначен"}
            </Typography.Text>
            {selectedMr.description && <Typography.Text>{selectedMr.description}</Typography.Text>}
          </Space>

          <Space style={{ width: "100%", justifyContent: "space-between", marginTop: 8, marginBottom: 8 }}>
            <Typography.Text strong>Теги (позиции спецификации)</Typography.Text>
            <Button size="small" onClick={() => { tagForm.resetFields(); setTagOpen(true); }}>
              + Добавить тег
            </Button>
          </Space>
          <Table
            rowKey="id"
            size="small"
            columns={tagColumns}
            dataSource={tags}
            pagination={false}
            locale={{ emptyText: "Нет тегов" }}
            style={{ marginBottom: 20 }}
          />

          <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
            <Typography.Text strong>Документы заказчика</Typography.Text>
            <Space>
              <Upload
                beforeUpload={(file) => {
                  setDocFile(file);
                  return false;
                }}
                maxCount={1}
                fileList={docFile ? [{ uid: "1", name: docFile.name } as never] : []}
                onRemove={() => setDocFile(null)}
              >
                <Button size="small" icon={<UploadOutlined />}>
                  Выбрать файл
                </Button>
              </Upload>
              <Button
                size="small"
                type="primary"
                disabled={!docFile}
                onClick={async () => {
                  if (selectedMrId === null || !docFile) return;
                  try {
                    await uploadMrDocument(selectedMrId, docFile);
                    message.success("Документ загружен");
                    setDocFile(null);
                    await reloadDetails();
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : "Не удалось загрузить документ");
                  }
                }}
              >
                Загрузить
              </Button>
            </Space>
          </Space>
          <Table
            rowKey="id"
            size="small"
            columns={docColumns}
            dataSource={documents}
            pagination={false}
            locale={{ emptyText: "Нет документов" }}
          />

          <Space style={{ width: "100%", justifyContent: "space-between", marginTop: 20, marginBottom: 8 }}>
            <Typography.Text strong>Приглашённые подрядчики ({invitations.filter((i) => !i.revoked_at).length}/5)</Typography.Text>
            <Button
              size="small"
              type="primary"
              disabled={invitations.filter((i) => !i.revoked_at).length >= 5}
              onClick={() => {
                inviteForm.resetFields();
                setInviteOpen(true);
              }}
            >
              + Пригласить подрядчика
            </Button>
          </Space>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={invitations}
            locale={{ emptyText: "Пока никто не приглашён" }}
            columns={[
              { title: "Компания", dataIndex: "vendor_company_name", key: "company", ellipsis: true },
              { title: "Email", dataIndex: "vendor_contact_email", key: "email", ellipsis: true },
              {
                title: "Статус",
                key: "status",
                width: 160,
                render: (_, row: VendorInvitationItem) =>
                  row.revoked_at ? (
                    <Tag color="error">Отозвано</Tag>
                  ) : row.email_verified_at ? (
                    <Tag color="success">Вошёл</Tag>
                  ) : (
                    <Tag color="processing">Приглашён</Tag>
                  ),
              },
              {
                title: "Действие",
                key: "action",
                width: 110,
                render: (_, row: VendorInvitationItem) =>
                  row.revoked_at ? null : (
                    <Button
                      size="small"
                      danger
                      onClick={async () => {
                        if (selectedMrId === null) return;
                        try {
                          await revokeMrInvitation(selectedMrId, row.id);
                          message.success("Приглашение отозвано");
                          await reloadDetails();
                        } catch (error) {
                          message.error(error instanceof Error ? error.message : "Не удалось отозвать");
                        }
                      }}
                    >
                      Отозвать
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        open={inviteOpen}
        title="Пригласить подрядчика"
        onCancel={() => setInviteOpen(false)}
        onOk={() => inviteForm.submit()}
        okText="Создать приглашение"
        cancelText="Отмена"
      >
        <Form
          form={inviteForm}
          layout="vertical"
          onFinish={async (values) => {
            if (selectedMrId === null) return;
            try {
              const created = await createMrInvitation(selectedMrId, {
                vendor_company_name: values.company,
                vendor_contact_email: values.email,
              });
              setInviteOpen(false);
              setCreatedLink(created.invitation_link);
              message.success("Приглашение создано, ссылка отправлена на email");
              await reloadDetails();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Не удалось создать приглашение");
            }
          }}
        >
          <Form.Item name="company" label="Название компании" rules={[{ required: true, message: "Введите название" }]}>
            <Input placeholder="ООО Поставщик" />
          </Form.Item>
          <Form.Item name="email" label="Email для входа" rules={[{ required: true, type: "email", message: "Введите корректный email" }]}>
            <Input placeholder="vendor@example.com" />
          </Form.Item>
          <Typography.Text type="secondary">
            На указанный email уйдёт персональная ссылка. При входе подрядчик подтвердит её кодом из письма.
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        open={createdLink !== null}
        title="Ссылка-приглашение создана"
        onCancel={() => setCreatedLink(null)}
        footer={[
          <Button key="copy" type="primary" onClick={() => { if (createdLink) { void navigator.clipboard.writeText(createdLink); message.success("Скопировано"); } }}>
            Скопировать ссылку
          </Button>,
          <Button key="close" onClick={() => setCreatedLink(null)}>
            Закрыть
          </Button>,
        ]}
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text>
            Ссылка отправлена подрядчику на email. Можете также скопировать её вручную (показывается один раз):
          </Typography.Text>
          <Input.TextArea value={createdLink ?? ""} readOnly autoSize={{ minRows: 2, maxRows: 4 }} />
          <Typography.Text type="warning">
            Ссылка персональная и даёт доступ только к этой MR. Не публикуйте её.
          </Typography.Text>
        </Space>
      </Modal>

      <Modal
        open={createOpen}
        title="Создать MR"
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        okText="Создать"
        cancelText="Отмена"
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={async (values) => {
            try {
              const created = await createMr({
                project_id: values.project_id,
                code: values.code,
                title: values.title,
                description: values.description ?? null,
                deadline_at: values.deadline_at ? dayjs(values.deadline_at).hour(12).minute(0).second(0).toISOString() : null,
                currency: values.currency || "RUB",
              });
              message.success("MR создана");
              setCreateOpen(false);
              setSelectedMrId(created.id);
              await loadMr();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Не удалось создать MR");
            }
          }}
        >
          <Form.Item name="project_id" label="Проект" rules={[{ required: true, message: "Выберите проект" }]}>
            <Select options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="code" label="Код MR" rules={[{ required: true, message: "Введите код" }]}>
            <Input placeholder="MR-IMP-001" />
          </Form.Item>
          <Form.Item name="title" label="Название" rules={[{ required: true, message: "Введите название" }]}>
            <Input placeholder="Насосное оборудование" />
          </Form.Item>
          <Form.Item name="description" label="Описание">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space style={{ width: "100%" }} size={12}>
            <Form.Item name="deadline_at" label="Дедлайн (12:00 МСК)">
              <DatePicker format="DD.MM.YYYY" />
            </Form.Item>
            <Form.Item name="currency" label="Валюта" initialValue="RUB">
              <Select
                style={{ width: 100 }}
                options={[
                  { value: "RUB", label: "RUB" },
                  { value: "USD", label: "USD" },
                  { value: "EUR", label: "EUR" },
                  { value: "CNY", label: "CNY" },
                ]}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        open={tagOpen}
        title="Добавить тег"
        onCancel={() => setTagOpen(false)}
        onOk={() => tagForm.submit()}
        okText="Добавить"
        cancelText="Отмена"
      >
        <Form
          form={tagForm}
          layout="vertical"
          onFinish={async (values) => {
            if (selectedMrId === null) return;
            try {
              await createMrTag(selectedMrId, {
                tag_code: values.tag_code,
                name: values.name,
                quantity: values.quantity ?? null,
                unit: values.unit ?? null,
                note: values.note ?? null,
                order_index: tags.length,
              });
              message.success("Тег добавлен");
              setTagOpen(false);
              await reloadDetails();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Не удалось добавить тег");
            }
          }}
        >
          <Form.Item name="tag_code" label="Код тега" rules={[{ required: true, message: "Введите код" }]}>
            <Input placeholder="PMP-01" />
          </Form.Item>
          <Form.Item name="name" label="Наименование" rules={[{ required: true, message: "Введите наименование" }]}>
            <Input placeholder="Насос ЦНС 38-176" />
          </Form.Item>
          <Space size={12}>
            <Form.Item name="quantity" label="Количество">
              <Input type="number" placeholder="2" />
            </Form.Item>
            <Form.Item name="unit" label="Ед. изм.">
              <Input placeholder="шт" />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="Примечание">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
