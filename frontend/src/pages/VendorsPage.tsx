import { App, Button, Card, DatePicker, Form, Input, Modal, Progress, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import {
  createMr,
  createMrInvitation,
  createMrOwnerItem,
  createMrTag,
  createMrVendorItem,
  deleteMr,
  deleteMrOwnerFile,
  deleteMrOwnerItem,
  deleteMrTag,
  deleteMrVendorItem,
  downloadMrReportXlsx,
  getMrReport,
  importReq,
  listMr,
  listMrInvitations,
  listMrOwnerItems,
  listMrTags,
  listMrVendorItems,
  listProjects,
  revokeMrInvitation,
  updateMr,
  uploadMrOwnerFile,
} from "../api";
import ProcessHint from "../components/ProcessHint";
import type {
  MrItem,
  MrOwnerItem,
  MrStatus,
  MrTagItem,
  MrVendorItem,
  ProjectItem,
  User,
  VendorInvitationItem,
  VendorReport,
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
const MR_STATUS_COLOR: Record<MrStatus, string> = { DRAFT: "default", OPEN: "processing", CLOSED: "warning", AWARDED: "success" };
const SECTION_LABEL: Record<string, string> = {
  BID_INCLUSION: "Bid Check List — включить в КП",
  BID_NOTES: "Bid Check List — учесть Requisition Notes",
  RFD: "RFD — документы к предоставлению",
};

export default function VendorsPage({ currentUser }: Props): JSX.Element {
  const { message, modal } = App.useApp();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [mrList, setMrList] = useState<MrItem[]>([]);
  const [selectedMrId, setSelectedMrId] = useState<number | null>(null);
  const [tags, setTags] = useState<MrTagItem[]>([]);
  const [ownerItems, setOwnerItems] = useState<MrOwnerItem[]>([]);
  const [vendorItems, setVendorItems] = useState<MrVendorItem[]>([]);
  const [invitations, setInvitations] = useState<VendorInvitationItem[]>([]);
  const [report, setReport] = useState<VendorReport | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [createForm] = Form.useForm();
  const [importForm] = Form.useForm();
  const [inviteForm] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const isContractor = currentUser.company_type === "contractor";
  const selectedMr = useMemo(() => mrList.find((m) => m.id === selectedMrId) ?? null, [mrList, selectedMrId]);

  const loadMr = async () => {
    try {
      const items = await listMr();
      setMrList(items);
      if (selectedMrId === null && items.length > 0) setSelectedMrId(items[0].id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось загрузить MR");
    }
  };

  useEffect(() => {
    void loadMr();
    listProjects().then(setProjects).catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetails = async (mrId: number) => {
    const [t, o, v, inv, rep] = await Promise.all([
      listMrTags(mrId),
      listMrOwnerItems(mrId),
      listMrVendorItems(mrId),
      listMrInvitations(mrId),
      getMrReport(mrId).catch(() => null),
    ]);
    setTags(t);
    setOwnerItems(o);
    setVendorItems(v);
    setInvitations(inv);
    setReport(rep);
  };

  useEffect(() => {
    if (selectedMrId === null) {
      setTags([]); setOwnerItems([]); setVendorItems([]); setInvitations([]); setReport(null);
      return;
    }
    void loadDetails(selectedMrId).catch(() => undefined);
  }, [selectedMrId]);

  const reload = async () => {
    if (selectedMrId !== null) await loadDetails(selectedMrId);
    await loadMr();
  };

  if (isContractor) {
    return (
      <Card>
        <Typography.Text type="secondary">
          Раздел «Вендоры» доступен только сотрудникам заказчика. Подрядчики работают с MR по персональной ссылке-приглашению.
        </Typography.Text>
      </Card>
    );
  }

  const mrColumns: ColumnsType<MrItem> = [
    { title: "Код MR", dataIndex: "code", key: "code", width: 220, ellipsis: true },
    { title: "Оборудование", dataIndex: "equipment_type", key: "equipment_type", ellipsis: true, render: (v) => v ?? "—" },
    { title: "Дисц.", dataIndex: "discipline_code", key: "disc", width: 70, render: (v) => v ?? "—" },
    { title: "Статус", dataIndex: "status", key: "status", width: 160, render: (s: MrStatus) => <Tag color={MR_STATUS_COLOR[s]}>{MR_STATUS_LABEL[s]}</Tag> },
    { title: "Теги", dataIndex: "tags_count", key: "tags", width: 60 },
    { title: "Заказчик", key: "owner", width: 90, render: (_, r) => `${r.owner_items_filled}/${r.owner_items_count}` },
    { title: "Подрядчик", dataIndex: "vendor_items_count", key: "vi", width: 90 },
    { title: "Подр-ков", dataIndex: "invitations_count", key: "inv", width: 80 },
  ];

  const ownerColumns: ColumnsType<MrOwnerItem> = [
    { title: "№", dataIndex: "att_no", key: "att_no", width: 70, render: (v) => v ?? "—" },
    {
      title: "Документ",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (v, row) => (row.is_group ? <Typography.Text strong>{v}</Typography.Text> : v),
    },
    { title: "Doc No", dataIndex: "doc_number", key: "doc", width: 150, ellipsis: true, render: (v, row) => (row.is_group ? "" : v ?? "—") },
    { title: "Рев", dataIndex: "rev", key: "rev", width: 60, render: (v, row) => (row.is_group ? "" : v ?? "—") },
    {
      title: "Файлы",
      key: "files",
      width: 220,
      render: (_, row) => {
        // Группа-заголовок (Technical Documents / Specifications / Drawings) —
        // это раздел, на него файл не грузится. Загрузка только на листья.
        if (row.is_group) return <Typography.Text type="secondary" italic>раздел</Typography.Text>;
        return (
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            {row.files.map((f) => (
              <Space key={f.id} size={4}>
                <Tag color="green" style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>{f.file_name}</Tag>
                <Button size="small" type="link" danger onClick={async () => {
                  if (selectedMrId === null) return;
                  await deleteMrOwnerFile(selectedMrId, f.id); await reload();
                }}>✕</Button>
              </Space>
            ))}
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                if (selectedMrId === null) return false;
                void uploadMrOwnerFile(selectedMrId, row.id, file).then(reload).catch((e) => message.error(e.message));
                return false;
              }}
            >
              <Button size="small" icon={<UploadOutlined />}>Загрузить</Button>
            </Upload>
          </Space>
        );
      },
    },
    {
      title: "",
      key: "del",
      width: 50,
      render: (_, row) => (
        <Button size="small" type="link" danger onClick={async () => {
          if (selectedMrId === null) return;
          await deleteMrOwnerItem(selectedMrId, row.id); await reload();
        }}>✕</Button>
      ),
    },
  ];

  const vendorColumns: ColumnsType<MrVendorItem> = [
    { title: "Код", dataIndex: "code", key: "code", width: 80, render: (v) => v ?? "—" },
    { title: "Требование", dataIndex: "title", key: "title", ellipsis: true },
    { title: "Цель", dataIndex: "purpose", key: "purpose", width: 60, render: (v) => v ?? "—" },
    { title: "С КП", dataIndex: "with_bid", key: "with_bid", width: 60, render: (v) => (v ? "Да" : "—") },
    {
      title: "",
      key: "del",
      width: 50,
      render: (_, row) => (
        <Button size="small" type="link" danger onClick={async () => {
          if (selectedMrId === null) return;
          await deleteMrVendorItem(selectedMrId, row.id); await reload();
        }}>✕</Button>
      ),
    },
  ];

  const vendorBySection = useMemo(() => {
    const groups: Record<string, MrVendorItem[]> = {};
    for (const v of vendorItems) (groups[v.section] ??= []).push(v);
    return groups;
  }, [vendorItems]);

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Вендоры — заявки на поставку (MR)</Typography.Title>
        <Space>
          <Button onClick={() => { importForm.resetFields(); setImportFile(null); setImportOpen(true); }}>Импорт REQ (.docx)</Button>
          <Button type="primary" onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>+ Создать MR</Button>
        </Space>
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать с модулем Вендоры"
        steps={[
          "Импортируйте REQ (.docx) — структура MR (теги, чек-листы) создастся автоматически.",
          "Догрузите документы заказчика по чек-листу, при необходимости поправьте пункты.",
          "Пригласите подрядчиков (до 5) — каждому уйдёт персональная ссылка.",
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
          locale={{ emptyText: "Нет MR. Импортируйте REQ или создайте вручную." }}
          scroll={{ x: "max-content" }}
        />
      </Card>

      {selectedMr && (
        <Card
          title={`MR: ${selectedMr.code}`}
          extra={
            <Space>
              <Select<MrStatus>
                size="small"
                value={selectedMr.status}
                style={{ width: 200 }}
                options={(Object.keys(MR_STATUS_LABEL) as MrStatus[]).map((s) => ({ value: s, label: MR_STATUS_LABEL[s] }))}
                onChange={async (status) => { await updateMr(selectedMr.id, { status }); await loadMr(); message.success("Статус обновлён"); }}
              />
              {selectedMr.status === "DRAFT" && selectedMr.invitations_count === 0 && (
                <Button size="small" danger onClick={() => modal.confirm({
                  title: "Удалить MR?", okText: "Удалить", okButtonProps: { danger: true }, cancelText: "Отмена",
                  onOk: async () => { await deleteMr(selectedMr.id); setSelectedMrId(null); await loadMr(); message.success("Удалено"); },
                })}>Удалить MR</Button>
              )}
            </Space>
          }
        >
          <Space direction="vertical" size={4} style={{ width: "100%", marginBottom: 16 }}>
            <Typography.Text strong style={{ fontSize: 15 }}>{selectedMr.equipment_type ?? selectedMr.title}</Typography.Text>
            <Typography.Text type="secondary">
              Проект: {projects.find((p) => p.id === selectedMr.project_id)?.code ?? selectedMr.project_id}
              {" · "}Дисциплина: {selectedMr.discipline_code ?? "—"}
              {" · "}Валюта: {selectedMr.currency}
              {" · "}Дедлайн: {formatDeadlineRu(selectedMr.deadline_at)}
            </Typography.Text>
          </Space>

          {/* Material Summary */}
          <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
            <Typography.Text strong>Material Summary — позиции ({tags.length})</Typography.Text>
            <Button size="small" onClick={() => addTag()}>+ Тег</Button>
          </Space>
          <Table rowKey="id" size="small" pagination={false} dataSource={tags} style={{ marginBottom: 20 }}
            locale={{ emptyText: "Нет позиций" }}
            columns={[
              { title: "Sr", dataIndex: "sr_no", key: "sr", width: 60, render: (v) => v ?? "—" },
              { title: "Item No", dataIndex: "item_no", key: "item", width: 140, render: (v) => v ?? "—" },
              { title: "Наименование", dataIndex: "name", key: "name", ellipsis: true },
              { title: "Кол-во", dataIndex: "quantity", key: "qty", width: 80, render: (v) => v ?? "—" },
              { title: "Ед.", dataIndex: "unit", key: "unit", width: 70, render: (v) => v ?? "—" },
              { title: "", key: "del", width: 50, render: (_, row) => (
                <Button size="small" type="link" danger onClick={async () => { if (selectedMrId===null) return; await deleteMrTag(selectedMrId, row.id); await reload(); }}>✕</Button>
              ) },
            ]}
          />

          {/* Owner checklist */}
          <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
            <Space>
              <Typography.Text strong>Чек-лист заказчика — что загрузить</Typography.Text>
              <Progress
                type="circle" size={28}
                percent={selectedMr.owner_items_count ? Math.round((selectedMr.owner_items_filled / selectedMr.owner_items_count) * 100) : 0}
              />
              <Typography.Text type="secondary">{selectedMr.owner_items_filled}/{selectedMr.owner_items_count}</Typography.Text>
            </Space>
            <Button size="small" onClick={() => addOwnerItem()}>+ Пункт</Button>
          </Space>
          <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} dataSource={ownerItems} columns={ownerColumns}
            style={{ marginBottom: 20 }} locale={{ emptyText: "Нет пунктов" }} scroll={{ x: "max-content" }} />

          {/* Vendor checklist */}
          <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
            <Typography.Text strong>Чек-лист подрядчика — что предоставить ({vendorItems.length})</Typography.Text>
            <Button size="small" onClick={() => addVendorItem()}>+ Пункт</Button>
          </Space>
          {Object.keys(vendorBySection).length === 0 && <Typography.Text type="secondary">Нет пунктов</Typography.Text>}
          {(["BID_INCLUSION", "BID_NOTES", "RFD"] as const).map((sec) =>
            vendorBySection[sec]?.length ? (
              <div key={sec} style={{ marginBottom: 16 }}>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>{SECTION_LABEL[sec]}</Typography.Text>
                <Table rowKey="id" size="small" pagination={false} dataSource={vendorBySection[sec]} columns={vendorColumns} scroll={{ x: "max-content" }} />
              </div>
            ) : null,
          )}

          {/* Invitations */}
          <Space style={{ width: "100%", justifyContent: "space-between", marginTop: 12, marginBottom: 8 }}>
            <Typography.Text strong>Приглашённые подрядчики ({invitations.filter((i) => !i.revoked_at).length}/5)</Typography.Text>
            <Button size="small" type="primary" disabled={invitations.filter((i) => !i.revoked_at).length >= 5}
              onClick={() => { inviteForm.resetFields(); setInviteOpen(true); }}>+ Пригласить</Button>
          </Space>
          <Table rowKey="id" size="small" pagination={false} dataSource={invitations} locale={{ emptyText: "Никто не приглашён" }}
            columns={[
              { title: "Компания", dataIndex: "vendor_company_name", key: "c", ellipsis: true },
              { title: "Email", dataIndex: "vendor_contact_email", key: "e", ellipsis: true },
              { title: "Статус", key: "s", width: 140, render: (_, r: VendorInvitationItem) => r.revoked_at ? <Tag color="error">Отозвано</Tag> : r.email_verified_at ? <Tag color="success">Вошёл</Tag> : <Tag color="processing">Приглашён</Tag> },
              { title: "", key: "a", width: 100, render: (_, r: VendorInvitationItem) => r.revoked_at ? null : (
                <Button size="small" danger onClick={async () => { if (selectedMrId===null) return; await revokeMrInvitation(selectedMrId, r.id); await reload(); message.success("Отозвано"); }}>Отозвать</Button>
              ) },
            ]}
          />

          {/* Сводный отчёт теги × подрядчики × цены */}
          {report && report.vendors.length > 0 && tags.length > 0 && (
            <>
              <Space style={{ width: "100%", justifyContent: "space-between", marginTop: 20, marginBottom: 8 }}>
                <Typography.Text strong>Сводное сравнение цен ({selectedMr.currency})</Typography.Text>
                <Button size="small" onClick={() => void downloadMrReportXlsx(selectedMr.id, selectedMr.code)}>
                  Экспорт в Excel
                </Button>
              </Space>
              <Table
                rowKey="tag_id"
                size="small"
                pagination={false}
                dataSource={report.rows}
                scroll={{ x: "max-content" }}
                columns={[
                  { title: "Item No", dataIndex: "item_no", key: "item", width: 130, render: (v) => v ?? "—" },
                  { title: "Наименование", dataIndex: "name", key: "name", ellipsis: true },
                  ...report.vendors.map((v) => ({
                    title: v.company_name,
                    key: `v_${v.invitation_id}`,
                    width: 140,
                    render: (_: unknown, row: VendorReport["rows"][number]) => {
                      const cell = row.cells.find((c) => c.invitation_id === v.invitation_id);
                      const isMin = row.min_invitation_id === v.invitation_id;
                      if (cell?.price == null) return <Typography.Text type="secondary">—</Typography.Text>;
                      return (
                        <Typography.Text strong={isMin} style={isMin ? { color: "#389e0d" } : undefined}>
                          {cell.price.toLocaleString("ru-RU")}
                        </Typography.Text>
                      );
                    },
                  })),
                ]}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2}>
                        <Typography.Text strong>ИТОГО</Typography.Text>
                      </Table.Summary.Cell>
                      {report.vendors.map((v, i) => (
                        <Table.Summary.Cell index={i + 2} key={v.invitation_id}>
                          <Typography.Text strong>
                            {v.total_price != null ? v.total_price.toLocaleString("ru-RU") : "—"}
                          </Typography.Text>
                        </Table.Summary.Cell>
                      ))}
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
              <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
                Зелёным выделена минимальная цена по позиции.
              </Typography.Text>
            </>
          )}
        </Card>
      )}

      {/* Import REQ modal */}
      <Modal open={importOpen} title="Импорт REQ (.docx)" confirmLoading={busy} okText="Импортировать" cancelText="Отмена"
        onCancel={() => setImportOpen(false)}
        onOk={async () => {
          const values = await importForm.validateFields();
          if (!importFile) { message.error("Выберите файл .docx"); return; }
          setBusy(true);
          try {
            const res = await importReq(values.project_id, importFile);
            message.success(`Импортировано: тегов ${res.tags_created}, чек-лист заказчика ${res.owner_items_created}, подрядчика ${res.vendor_items_created}`);
            setImportOpen(false); setImportFile(null);
            await loadMr(); setSelectedMrId(res.mr_id);
          } catch (e) { message.error(e instanceof Error ? e.message : "Ошибка импорта"); }
          finally { setBusy(false); }
        }}>
        <Form form={importForm} layout="vertical">
          <Form.Item name="project_id" label="Проект" rules={[{ required: true, message: "Выберите проект" }]}>
            <Select options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Upload beforeUpload={(f) => { setImportFile(f); return false; }} maxCount={1}
            fileList={importFile ? [{ uid: "1", name: importFile.name } as never] : []} onRemove={() => setImportFile(null)}>
            <Button icon={<UploadOutlined />}>Выбрать REQ .docx</Button>
          </Upload>
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            Структура (теги, чек-листы) создастся автоматически. Всё можно поправить после импорта.
          </Typography.Text>
        </Form>
      </Modal>

      {/* Create MR modal */}
      <Modal open={createOpen} title="Создать MR" okText="Создать" cancelText="Отмена"
        onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()}>
        <Form form={createForm} layout="vertical" onFinish={async (values) => {
          try {
            const created = await createMr({
              project_id: values.project_id, code: values.code, title: values.title,
              deadline_at: values.deadline_at ? dayjs(values.deadline_at).hour(12).minute(0).second(0).toISOString() : null,
              currency: values.currency || "RUB",
            });
            setCreateOpen(false); setSelectedMrId(created.id); await loadMr(); message.success("MR создана");
          } catch (e) { message.error(e instanceof Error ? e.message : "Ошибка"); }
        }}>
          <Form.Item name="project_id" label="Проект" rules={[{ required: true }]}>
            <Select options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="code" label="Код MR" rules={[{ required: true }]}><Input placeholder="IMP-FD-00-00-XX-REQ-001" /></Form.Item>
          <Form.Item name="title" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
          <Space size={12}>
            <Form.Item name="deadline_at" label="Дедлайн"><DatePicker format="DD.MM.YYYY" /></Form.Item>
            <Form.Item name="currency" label="Валюта" initialValue="RUB">
              <Select style={{ width: 100 }} options={["RUB", "USD", "EUR", "CNY"].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Invite modal */}
      <Modal open={inviteOpen} title="Пригласить подрядчика" okText="Создать приглашение" cancelText="Отмена"
        onCancel={() => setInviteOpen(false)} onOk={() => inviteForm.submit()}>
        <Form form={inviteForm} layout="vertical" onFinish={async (values) => {
          if (selectedMrId === null) return;
          try {
            const created = await createMrInvitation(selectedMrId, { vendor_company_name: values.company, vendor_contact_email: values.email });
            setInviteOpen(false); setCreatedLink(created.invitation_link); await reload(); message.success("Приглашение создано");
          } catch (e) { message.error(e instanceof Error ? e.message : "Ошибка"); }
        }}>
          <Form.Item name="company" label="Компания" rules={[{ required: true }]}><Input placeholder="ООО Поставщик" /></Form.Item>
          <Form.Item name="email" label="Email для входа" rules={[{ required: true, type: "email" }]}><Input placeholder="vendor@example.com" /></Form.Item>
        </Form>
      </Modal>

      {/* Link modal */}
      <Modal open={createdLink !== null} title="Ссылка-приглашение создана" onCancel={() => setCreatedLink(null)}
        footer={[
          <Button key="copy" type="primary" onClick={() => { if (createdLink) { void navigator.clipboard.writeText(createdLink); message.success("Скопировано"); } }}>Скопировать</Button>,
          <Button key="c" onClick={() => setCreatedLink(null)}>Закрыть</Button>,
        ]}>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text>Ссылка отправлена подрядчику на email. Можно скопировать вручную (показывается один раз):</Typography.Text>
          <Input.TextArea value={createdLink ?? ""} readOnly autoSize={{ minRows: 2, maxRows: 4 }} />
        </Space>
      </Modal>
    </div>
  );

  function addTag() {
    let code = ""; let name = "";
    modal.confirm({
      title: "Новый тег",
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input placeholder="Item No / код" onChange={(e) => (code = e.target.value)} />
          <Input placeholder="Наименование" onChange={(e) => (name = e.target.value)} />
        </Space>
      ),
      okText: "Добавить", cancelText: "Отмена",
      onOk: async () => {
        if (selectedMrId === null || !name.trim()) return;
        await createMrTag(selectedMrId, { tag_code: code.trim() || name.trim(), name: name.trim(), order_index: tags.length });
        await reload();
      },
    });
  }

  function addOwnerItem() {
    let title = "";
    modal.confirm({
      title: "Новый пункт чек-листа заказчика",
      content: <Input placeholder="Название документа" onChange={(e) => (title = e.target.value)} />,
      okText: "Добавить", cancelText: "Отмена",
      onOk: async () => {
        if (selectedMrId === null || !title.trim()) return;
        await createMrOwnerItem(selectedMrId, { title: title.trim(), category: "OTHER", order_index: ownerItems.length });
        await reload();
      },
    });
  }

  function addVendorItem() {
    let title = ""; let section = "RFD";
    modal.confirm({
      title: "Новый пункт чек-листа подрядчика",
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select defaultValue="RFD" style={{ width: "100%" }} onChange={(v) => (section = v)}
            options={Object.entries(SECTION_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          <Input placeholder="Требование / документ" onChange={(e) => (title = e.target.value)} />
        </Space>
      ),
      okText: "Добавить", cancelText: "Отмена",
      onOk: async () => {
        if (selectedMrId === null || !title.trim()) return;
        await createMrVendorItem(selectedMrId, { section, title: title.trim(), order_index: vendorItems.length });
        await reload();
      },
    });
  }
}
