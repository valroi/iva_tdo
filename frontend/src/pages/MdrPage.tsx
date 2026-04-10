import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  checkMdrCipher,
  composeMdrCipher,
  createDocument,
  createMdr,
  downloadMdrTemplate,
  exportMdr,
  deleteMdr,
  importMdr,
  updateMdr,
} from "../api";
import type { CipherTemplateField, MDRRecord, ProjectItem, ProjectReference, User } from "../types";
import { formatDateRu } from "../utils/datetime";

interface Props {
  mdr: MDRRecord[];
  projects: ProjectItem[];
  currentUser: User;
  projectReferences: ProjectReference[];
  onCreated: () => Promise<void>;
  onOpenDocument?: (documentNum: string) => void;
}

export default function MdrPage({ mdr, projects, currentUser, projectReferences, onCreated, onOpenDocument }: Props): JSX.Element {
  const canManageMdr = currentUser.role === "admin" || currentUser.permissions.can_create_mdr;
  const isAdmin = currentUser.role === "admin";
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serialAutoMode, setSerialAutoMode] = useState(true);
  const [docNumberExists, setDocNumberExists] = useState<boolean | null>(null);
  const [cipherTemplateFields, setCipherTemplateFields] = useState<CipherTemplateField[]>([]);
  const [importingMdr, setImportingMdr] = useState(false);
  const [editingMdrId, setEditingMdrId] = useState<number | null>(null);
  const [editingOriginalDocNumber, setEditingOriginalDocNumber] = useState<string | null>(null);
  const [editingHistoryLines, setEditingHistoryLines] = useState<string[]>([]);
  const [deletingMdrId, setDeletingMdrId] = useState<number | null>(null);
  const [deletingMdrLoading, setDeletingMdrLoading] = useState(false);
  const normalizePdCipher = (value: string): string => {
    const raw = String(value || "").trim().toUpperCase();
    const rx = /^([A-Z]{3})-([A-Z]{3})-PD-(\d{4})-([A-Z0-9]{2,5})-(\d{1,2})(?:-)?([0-9.]{1,5})?$/;
    const match = rx.exec(raw);
    if (!match) return raw;
    const [, projectCode, originatorCode, title, section, part, book] = match;
    return `${projectCode}-${originatorCode}-PD-${title}-${section}${part}${book ? `.${book}` : ""}`;
  };

  const [form] = Form.useForm();
  const latestComposeRequestRef = useRef(0);

  const currentProjectCode = Form.useWatch("project_code", form);
  const currentDocType = Form.useWatch("doc_type", form);
  const currentCategory = Form.useWatch("category", form);
  const currentDisciplineCode = Form.useWatch("discipline_code", form);
  const currentOriginatorCode = Form.useWatch("originator_code", form);
  const currentTitleObject = Form.useWatch("title_object", form);
  const currentSerialNumber = Form.useWatch("serial_number", form);
  const currentDocNumber = Form.useWatch("doc_number", form);
  const allFormValues = Form.useWatch([], form) as Record<string, unknown> | undefined;
  const isSingleProject = projects.length === 1;
  const defaultProjectCode = projects[0]?.code;
  const selectedProject = useMemo(
    () => projects.find((project) => project.code === currentProjectCode) ?? null,
    [projects, currentProjectCode],
  );
  const defaultOriginator = (currentUser.company_code || (currentUser.company_type === "contractor" ? "CTR" : currentUser.company_type === "owner" ? "OWN" : "ADM"))
    .toUpperCase()
    .slice(0, 3);

  const categoryOptions = useMemo(() => {
    if (selectedProject?.document_category) {
      const byCode = projectReferences.find(
        (ref) => ref.ref_type === "document_category" && ref.code === selectedProject.document_category,
      );
      return [
        {
          value: selectedProject.document_category,
          label: byCode
            ? `${selectedProject.document_category} - ${byCode.value}`
            : selectedProject.document_category,
        },
      ];
    }
    return projectReferences
      .filter((ref) => ref.ref_type === "document_category" && ref.is_active)
      .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` }));
  }, [projectReferences, selectedProject?.document_category]);
  const disciplineOptions = useMemo(
    () =>
      projectReferences
        .filter((ref) => (ref.ref_type === "pd_section" || ref.ref_type === "discipline") && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [projectReferences],
  );
  const titleObjectOptions = useMemo(
    () =>
      projectReferences
        .filter((ref) => ref.ref_type === "title_object" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [projectReferences],
  );
  const pdSectionNumberByCode = useMemo(() => {
    return new Map<string, string>([
      ["PZ", "1"],
      ["PZU", "2"],
      ["AR", "3"],
      ["KR", "4"],
      ["IOS", "5"],
      ["TR", "6"],
      ["POS", "7"],
      ["OOS", "8"],
      ["PB", "9"],
      ["TBE", "10"],
      ["ODI", "11"],
      ["SM", "12"],
    ]);
  }, []);
  const currentSectionNumber = (pdSectionNumberByCode.get(String(currentDisciplineCode || "").toUpperCase()) ?? "—");
  const referenceOptionsByType = useMemo(() => {
    const map = new Map<string, { value: string; label: string }[]>();
    projectReferences.forEach((ref) => {
      if (!ref.is_active) return;
      const list = map.get(ref.ref_type) ?? [];
      list.push({ value: ref.code, label: `${ref.code} - ${ref.value}` });
      map.set(ref.ref_type, list);
    });
    return map;
  }, [projectReferences]);

  const categoryWeight = useMemo(() => {
    if (!currentProjectCode || !currentCategory) return 0;
    return mdr
      .filter((row) => row.project_code === currentProjectCode && row.category === currentCategory)
      .reduce((acc, row) => acc + (row.doc_weight ?? 0), 0);
  }, [currentCategory, currentProjectCode, mdr]);

  const columns: ColumnsType<MDRRecord> = [
    { title: "ID", dataIndex: "document_key", key: "document_key", width: 130 },
    {
      title: "Шифр",
      dataIndex: "doc_number",
      key: "doc_number",
      width: 280,
      render: (value: string) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => onOpenDocument?.(normalizePdCipher(value))}
        >
          <Typography.Text
            ellipsis={{ tooltip: normalizePdCipher(value) }}
            style={{ whiteSpace: "nowrap", display: "inline-block", maxWidth: 260 }}
          >
            {normalizePdCipher(value)}
          </Typography.Text>
        </Button>
      ),
    },
    { title: "Проект", dataIndex: "project_code", key: "project_code" },
    {
      title: "Название",
      dataIndex: "doc_name",
      key: "doc_name",
      width: 300,
      ellipsis: true,
      render: (value: string) => (
        <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 280, whiteSpace: "nowrap", display: "inline-block" }}>
          {value}
        </Typography.Text>
      ),
    },
    { title: "Дисциплина", dataIndex: "discipline_code", key: "discipline_code" },
    {
      title: "План выпуска ревизии A",
      dataIndex: "planned_dev_start",
      key: "planned_dev_start",
      render: (value: string | null | undefined) => formatDateRu(value),
    },
    {
      title: "Код замечаний",
      dataIndex: "review_code",
      key: "review_code",
      render: (value: MDRRecord["review_code"]) => (value ? <Tag>{value}</Tag> : "—"),
    },
    { title: "Вес", dataIndex: "doc_weight", key: "doc_weight" },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      render: (value: string) => (value === "DRAFT" ? "Черновик" : value),
    },
    ...(canManageMdr
      ? [
          {
            title: "Действие",
            key: "action",
            width: 210,
            render: (_: unknown, row: MDRRecord) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    form.setFieldsValue({
                      ...row,
                      category: row.category,
                    });
                    setEditingMdrId(row.id);
                    setEditingOriginalDocNumber(row.doc_number);
                    const historyRaw = Array.isArray((row.dates as { update_history?: unknown[] } | undefined)?.update_history)
                      ? ((row.dates as { update_history?: unknown[] }).update_history as unknown[])
                      : [];
                    const lines = historyRaw
                      .slice(-5)
                      .map((item) => {
                        const entry = item as { updated_at?: string; updated_by?: string; changed_fields?: Record<string, unknown> };
                        const fields = Object.keys(entry.changed_fields ?? {});
                        return `${entry.updated_at ?? "n/a"} · ${entry.updated_by ?? "unknown"} · ${fields.join(", ") || "no fields"}`;
                      })
                      .reverse();
                    setEditingHistoryLines(lines);
                    setOpen(true);
                  }}
                >
                  Открыть / Ред.
                </Button>
                {isAdmin && (
                  <Button
                    size="small"
                    danger
                    onClick={() => setDeletingMdrId(row.id)}
                  >
                    Удалить
                  </Button>
                )}
              </Space>
            ),
          } as ColumnsType<MDRRecord>[number],
        ]
      : []),
  ];

  const nextDocumentKey = useMemo(() => {
    const maxIdx = mdr.reduce((max, item) => {
      const match = /^DOC-(\d+)$/i.exec(item.document_key ?? "");
      const value = match ? Number(match[1]) : 0;
      return Math.max(max, value);
    }, 0);
    return `DOC-${String(maxIdx + 1).padStart(4, "0")}`;
  }, [mdr]);

  const submit = async () => {
    if (!canManageMdr) {
      message.error("Недостаточно прав для создания документа");
      return;
    }
    const values = await form.validateFields();
    const unchangedCipherInEdit =
      Boolean(editingMdrId) && normalizePdCipher(values.doc_number) === normalizePdCipher(editingOriginalDocNumber ?? "");
    if (docNumberExists && !unchangedCipherInEdit) {
      message.error("Нельзя сохранить: шифр уже существует в проекте");
      return;
    }
    if ((values.doc_weight ?? 0) + categoryWeight > 1000) {
      message.error(`Превышен лимит веса для категории: ${(values.doc_weight ?? 0) + categoryWeight} / 1000`);
      return;
    }

    setSubmitting(true);
    try {
      const normalizedDocNumber = normalizePdCipher(values.doc_number);
      if (editingMdrId) {
        await updateMdr(editingMdrId, {
          ...values,
          doc_number: normalizedDocNumber,
          originator_code: (values.originator_code as string).toUpperCase().slice(0, 3),
        });
      } else {
        const created = await createMdr({
          ...values,
          doc_number: normalizedDocNumber,
          originator_code: (values.originator_code as string).toUpperCase().slice(0, 3),
          progress_percent: 0,
          dates: {},
          status: "DRAFT",
          is_confidential: false,
        });
        await createDocument({
          mdr_id: created.id,
          document_num: normalizedDocNumber,
          title: values.doc_name,
          discipline: values.discipline_code,
          weight: values.doc_weight ?? 0,
        });
      }
      form.resetFields();
      setOpen(false);
      setEditingMdrId(null);
      setEditingOriginalDocNumber(null);
      setEditingHistoryLines([]);
      await onCreated();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка создания документа";
      message.error(text);
    } finally {
      setSubmitting(false);
    }
  };

  const composeCipher = async () => {
    const values = form.getFieldsValue([
      "project_code",
      "originator_code",
      "category",
      "title_object",
      "discipline_code",
      "doc_type",
      "serial_number",
    ]);
    const allValues = form.getFieldsValue(true) as Record<string, string | number | undefined>;
    const valuesMap: Record<string, string> = {};
    Object.entries(allValues).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      valuesMap[key] = String(value);
    });

    const hasTemplate = cipherTemplateFields.length > 0;
    if (hasTemplate) {
      const missingTemplateRequired = cipherTemplateFields.some(
        (field) =>
          field.required &&
          field.source_type !== "STATIC" &&
          field.source_type !== "AUTO_SERIAL" &&
          !String(valuesMap[field.field_key] ?? "").trim(),
      );
      if (!values.project_code || !values.category || missingTemplateRequired) {
        return null;
      }
    } else {
      const required = [values.project_code, values.originator_code, values.category, values.title_object, values.discipline_code];
      if (required.some((item) => !item)) return null;
    }

    setComposing(true);
    try {
      const composed = await composeMdrCipher({
        ...values,
        category: values.category,
        values: valuesMap,
      });
      const normalizedCipher = normalizePdCipher(composed.cipher);
      form.setFieldValue("doc_number", normalizedCipher);
      return normalizedCipher;
    } catch (error) {
      form.setFieldValue("doc_number", undefined);
      message.error(error instanceof Error ? error.message : "Не удалось сформировать шифр");
      return null;
    } finally {
      setComposing(false);
    }
  };

  const checkCipher = async () => {
    const values = form.getFieldsValue(["project_code", "doc_number"]);
    if (!values.project_code || !values.doc_number) {
      setDocNumberExists(null);
      return;
    }
    setChecking(true);
    try {
      const result = await checkMdrCipher(values.project_code, values.doc_number);
      if (result.exists) {
        setDocNumberExists(true);
      } else {
        setDocNumberExists(false);
      }
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!currentProjectCode || !currentDisciplineCode || !serialAutoMode) return;
    const maxIdx = mdr.reduce((max, item) => {
      if (
        item.project_code !== currentProjectCode ||
        item.discipline_code !== currentDisciplineCode
      ) {
        return max;
      }
      const match = /^(\d+)$/.exec(item.serial_number ?? "");
      const value = match ? Number(match[1]) : 0;
      return Math.max(max, value);
    }, 0);
    form.setFieldValue("serial_number", String(maxIdx + 1).padStart(4, "0"));
  }, [currentProjectCode, currentDisciplineCode, serialAutoMode, mdr, form]);

  useEffect(() => {
    if (!selectedProject?.document_category) return;
    form.setFieldValue("category", selectedProject.document_category);
  }, [form, selectedProject?.document_category]);

  useEffect(() => {
    setCipherTemplateFields([]);
  }, [selectedProject?.code, selectedProject?.document_category]);

  useEffect(() => {
    const hasTemplate = cipherTemplateFields.length > 0;
    const values = (allFormValues ?? {}) as Record<string, unknown>;
    const templateReady =
      currentProjectCode &&
      currentCategory &&
      cipherTemplateFields.every(
        (field) =>
          !field.required ||
          field.source_type === "STATIC" ||
          field.source_type === "AUTO_SERIAL" ||
          String(values[field.field_key] ?? "").trim().length > 0,
      );

    const legacyReady =
      currentProjectCode &&
      currentOriginatorCode &&
      currentCategory &&
      currentTitleObject &&
      currentDisciplineCode;

    if (!(hasTemplate ? templateReady : legacyReady)) {
      setDocNumberExists(null);
      return;
    }

    const requestId = latestComposeRequestRef.current + 1;
    latestComposeRequestRef.current = requestId;

    const timer = setTimeout(async () => {
      const cipher = await composeCipher();
      if (!cipher || latestComposeRequestRef.current !== requestId) return;
      await checkCipher();
    }, 300);

    return () => clearTimeout(timer);
  }, [
    allFormValues,
    cipherTemplateFields,
    currentProjectCode,
    currentOriginatorCode,
    currentCategory,
    currentTitleObject,
    currentDisciplineCode,
  ]);

  const handleImportFile = async (file: File, dryRun: boolean): Promise<void> => {
    if (!selectedProject?.code) return;
    setImportingMdr(true);
    try {
      const result = await importMdr(selectedProject.code, file, dryRun);
      if (result.errors?.length) {
        Modal.error({
          title: dryRun ? "Проверка завершена с ошибками" : "Импорт завершен с ошибками",
          width: 720,
          content: (
            <div style={{ maxHeight: 320, overflow: "auto" }}>
              {result.errors.map((item) => (
                <div key={`${item.row}-${item.message}`}>
                  Строка {item.row}: {item.message}
                </div>
              ))}
            </div>
          ),
        });
      } else {
        message.success(
          dryRun
            ? `Проверка успешна: готово к импорту ${result.imported}, пропущено ${result.skipped}`
            : `Импорт MDR: добавлено ${result.imported}, пропущено ${result.skipped}`,
        );
      }
      if (!dryRun) {
        await onCreated();
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : dryRun ? "Ошибка проверки MDR" : "Ошибка импорта MDR");
    } finally {
      setImportingMdr(false);
    }
  };

  return (
    <>
      <Space wrap style={{ marginBottom: 12, alignItems: "center" }}>
        <Typography.Title level={4} style={{ margin: 0, whiteSpace: "nowrap", flexShrink: 0 }}>
          Реестр документов
        </Typography.Title>
        {selectedProject?.code && (
          <>
            <Button
              onClick={async () => {
                try {
                  await downloadMdrTemplate(selectedProject.code);
                } catch (error) {
                  message.error(error instanceof Error ? error.message : "Не удалось скачать шаблон");
                }
              }}
            >
              Шаблон Excel
            </Button>
            <Button
              onClick={async () => {
                try {
                  await exportMdr(selectedProject.code);
                } catch (error) {
                  message.error(error instanceof Error ? error.message : "Не удалось выгрузить Excel");
                }
              }}
            >
              Экспорт Excel
            </Button>
            <Button loading={importingMdr}>
              <label style={{ cursor: "pointer" }}>
                Проверить Excel
                <input
                  type="file"
                  accept=".xlsx"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    await handleImportFile(file, true);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </Button>
            <Button loading={importingMdr} type="primary">
              <label style={{ cursor: "pointer" }}>
                Импорт Excel
                <input
                  type="file"
                  accept=".xlsx"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    await handleImportFile(file, false);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </Button>
          </>
        )}
        {canManageMdr && (
          <Button
            type="primary"
            onClick={() => {
              setEditingMdrId(null);
              setEditingOriginalDocNumber(null);
              setEditingHistoryLines([]);
              form.setFieldsValue({
                document_key: nextDocumentKey,
                project_code: defaultProjectCode,
                originator_code: defaultOriginator,
                category: projects[0]?.document_category ?? undefined,
              });
              setOpen(true);
            }}
          >
            + Добавить документ
          </Button>
        )}
      </Space>
      <Table rowKey="id" columns={columns} dataSource={mdr} size="small" scroll={{ x: 1280 }} />

      <Modal
        open={open}
        title={editingMdrId ? "Карточка документа (редактирование)" : "Создать документ в реестре"}
        onCancel={() => {
          setOpen(false);
          setEditingMdrId(null);
          setEditingOriginalDocNumber(null);
          setEditingHistoryLines([]);
        }}
        onOk={submit}
        okButtonProps={{ loading: submitting }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="category" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="document_key" label="Уникальный ID документа" rules={[{ required: true }]}>
            <Input readOnly={Boolean(editingMdrId)} />
          </Form.Item>
          <Form.Item name="project_code" label="Код проекта" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={isSingleProject}
              options={projects.map((project) => ({
                value: project.code,
                label: `${project.code} — ${project.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="originator_code"
            label="Код разработчика (3 символа)"
            normalize={(value: string) => (value ?? "").toUpperCase().slice(0, 3)}
            rules={[{ required: true }, { len: 3, message: "Ровно 3 символа" }, { pattern: /^[A-Z]{3}$/, message: "Только A-Z" }]}
          >
            <Input placeholder="CTR" maxLength={3} />
          </Form.Item>
          <Form.Item name="title_object" label="Титульный объект" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={titleObjectOptions} placeholder="Из справочника проекта" />
          </Form.Item>
          <Form.Item name="discipline_code" label="Раздел ПД" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={disciplineOptions} placeholder="Из справочника разделов ПД" />
          </Form.Item>
          <Form.Item label="Номер раздела (инфо)">
            <Input value={currentSectionNumber} readOnly />
          </Form.Item>
          <Form.Item
            name="doc_type"
            label="Часть (необязательно, 1-2 цифры)"
            normalize={(value: string) => (value ?? "").replace(/\D/g, "").slice(0, 2)}
          >
            <Input placeholder="1" maxLength={2} />
          </Form.Item>
          {[]
            .filter(
              (field) =>
                !["project_code", "originator_code", "category", "title_object", "discipline_code", "doc_type", "serial_number"].includes(
                  field.field_key,
                ) && field.source_type !== "STATIC" && field.source_type !== "AUTO_SERIAL",
            )
            .sort((a, b) => a.order_index - b.order_index)
            .map((field) => (
              <Form.Item
                key={field.field_key}
                name={field.field_key}
                label={field.label}
                rules={field.required ? [{ required: true }] : undefined}
              >
                {field.source_type === "REFERENCE" ? (
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={referenceOptionsByType.get(field.source_ref_type ?? "") ?? []}
                    placeholder={`Из справочника ${field.source_ref_type ?? ""}`}
                  />
                ) : (
                  <Input maxLength={field.length ?? 100} placeholder={field.field_key} />
                )}
              </Form.Item>
            ))}
          <Form.Item
            name="serial_number"
            label="Книга (необязательно, 1-5 символов: цифры и точка)"
            normalize={(value: string) => (value ?? "").replace(/[^0-9.]/g, "").slice(0, 5)}
          >
            <Input
              placeholder="1.1"
              maxLength={5}
              onChange={(event) => {
                const next = event.target.value.replace(/[^0-9.]/g, "").slice(0, 5);
                form.setFieldValue("serial_number", next);
                setSerialAutoMode(false);
              }}
              addonAfter={
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setSerialAutoMode(true);
                  }}
                >
                  авто
                </Button>
              }
            />
          </Form.Item>
          <Form.Item name="doc_number" label="Шифр документа (авто)" rules={[{ required: true }]}>
            <Input placeholder="IVA-PD-0001" readOnly />
          </Form.Item>
          {editingMdrId && editingHistoryLines.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Typography.Text type="secondary">История изменений (последние 5):</Typography.Text>
              {editingHistoryLines.map((line) => (
                <div key={line}>
                  <Typography.Text type="secondary">{line}</Typography.Text>
                </div>
              ))}
            </div>
          )}
          {docNumberExists === true && <Typography.Text type="danger">Шифр уже существует в этом проекте</Typography.Text>}
          {docNumberExists === false && <Typography.Text type="success">Шифр уникален</Typography.Text>}
          <Form.Item name="doc_name" label="Наименование" rules={[{ required: true }]}>
            <Input placeholder="Piping layout" />
          </Form.Item>
          <Form.Item name="planned_dev_start" label="Плановая дата начала разработки">
            <Input type="date" />
          </Form.Item>
          <Form.Item
            name="doc_weight"
            label={`Вес документа (текущий суммарный вес категории: ${categoryWeight}/1000)`}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={1000} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={deletingMdrId !== null}
        title="Удалить документ из реестра?"
        okText="Удалить"
        cancelText="Отмена"
        okButtonProps={{ danger: true, loading: deletingMdrLoading }}
        onCancel={() => setDeletingMdrId(null)}
        onOk={async () => {
          if (deletingMdrId === null) return;
          setDeletingMdrLoading(true);
          try {
            await deleteMdr(deletingMdrId);
            message.success("Документ удален");
            setDeletingMdrId(null);
            await onCreated();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "Не удалось удалить документ");
          } finally {
            setDeletingMdrLoading(false);
          }
        }}
      >
        Будут удалены связанные документы/ревизии/комментарии.
      </Modal>
    </>
  );
}
