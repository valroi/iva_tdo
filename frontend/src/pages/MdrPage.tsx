import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";

import { checkMdrCipher, composeMdrCipher, createDocument, createMdr } from "../api";
import type { MDRRecord, ProjectItem, ProjectReference, User } from "../types";

interface Props {
  mdr: MDRRecord[];
  projects: ProjectItem[];
  currentUser: User;
  projectReferences: ProjectReference[];
  onCreated: () => Promise<void>;
}

export default function MdrPage({ mdr, projects, currentUser, projectReferences, onCreated }: Props): JSX.Element {
  const canManageMdr = currentUser.role === "admin" || currentUser.permissions.can_create_mdr;
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serialAutoMode, setSerialAutoMode] = useState(true);
  const [docNumberExists, setDocNumberExists] = useState<boolean | null>(null);
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
  const isSingleProject = projects.length === 1;
  const defaultProjectCode = projects[0]?.code;
  const defaultOriginator = (currentUser.company_code || (currentUser.company_type === "contractor" ? "CTR" : currentUser.company_type === "owner" ? "OWN" : "ADM"))
    .toUpperCase()
    .slice(0, 3);

  const categoryOptions = useMemo(
    () =>
      projectReferences
        .filter((ref) => ref.ref_type === "document_category" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [projectReferences],
  );
  const disciplineOptions = useMemo(
    () =>
      projectReferences
        .filter((ref) => ref.ref_type === "discipline" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} - ${ref.value}` })),
    [projectReferences],
  );
  const documentTypeOptions = useMemo(
    () =>
      projectReferences
        .filter((ref) => ref.ref_type === "document_type" && ref.is_active)
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

  const categoryWeight = useMemo(() => {
    if (!currentProjectCode || !currentCategory) return 0;
    return mdr
      .filter((row) => row.project_code === currentProjectCode && row.category === currentCategory)
      .reduce((acc, row) => acc + (row.doc_weight ?? 0), 0);
  }, [currentCategory, currentProjectCode, mdr]);

  const columns: ColumnsType<MDRRecord> = [
    { title: "ID", dataIndex: "document_key", key: "document_key", width: 130 },
    { title: "Шифр", dataIndex: "doc_number", key: "doc_number" },
    { title: "Проект", dataIndex: "project_code", key: "project_code" },
    { title: "Название", dataIndex: "doc_name", key: "doc_name" },
    { title: "Дисциплина", dataIndex: "discipline_code", key: "discipline_code" },
    {
      title: "Рассмотрение",
      dataIndex: "review_code",
      key: "review_code",
      render: (value: MDRRecord["review_code"]) => (value ? <Tag>{value}</Tag> : <Tag>n/a</Tag>),
    },
    { title: "Вес", dataIndex: "doc_weight", key: "doc_weight" },
    { title: "Статус", dataIndex: "status", key: "status" },
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
    if (docNumberExists) {
      message.error("Нельзя сохранить: шифр уже существует в проекте");
      return;
    }
    if ((values.doc_weight ?? 0) + categoryWeight > 1000) {
      message.error(`Превышен лимит веса для категории: ${(values.doc_weight ?? 0) + categoryWeight} / 1000`);
      return;
    }

    setSubmitting(true);
    try {
      const created = await createMdr({
        ...values,
        originator_code: (values.originator_code as string).toUpperCase().slice(0, 3),
        progress_percent: 0,
        dates: {},
        status: "DRAFT",
        is_confidential: false,
      });
      await createDocument({
        mdr_id: created.id,
        document_num: values.doc_number,
        title: values.doc_name,
        discipline: values.discipline_code,
        weight: values.doc_weight ?? 0,
      });
      form.resetFields();
      setOpen(false);
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
    const required = [
      values.project_code,
      values.originator_code,
      values.category,
      values.title_object,
      values.discipline_code,
      values.doc_type,
      values.serial_number,
    ];
    if (required.some((item) => !item)) return null;
    setComposing(true);
    try {
      const composed = await composeMdrCipher(values);
      form.setFieldValue("doc_number", composed.cipher);
      return composed.cipher;
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
    if (!currentProjectCode || !currentDisciplineCode || !currentDocType || !serialAutoMode) return;
    const maxIdx = mdr.reduce((max, item) => {
      if (
        item.project_code !== currentProjectCode ||
        item.discipline_code !== currentDisciplineCode ||
        item.doc_type !== currentDocType
      ) {
        return max;
      }
      const match = /^(\d+)$/.exec(item.serial_number ?? "");
      const value = match ? Number(match[1]) : 0;
      return Math.max(max, value);
    }, 0);
    form.setFieldValue("serial_number", String(maxIdx + 1).padStart(4, "0"));
  }, [currentProjectCode, currentDisciplineCode, currentDocType, serialAutoMode, mdr, form]);

  useEffect(() => {
    const canCompose =
      currentProjectCode &&
      currentOriginatorCode &&
      currentCategory &&
      currentTitleObject &&
      currentDisciplineCode &&
      currentDocType &&
      currentSerialNumber;

    if (!canCompose) {
      setDocNumberExists(null);
      return;
    }

    const requestId = latestComposeRequestRef.current + 1;
    latestComposeRequestRef.current = requestId;

    const timer = setTimeout(async () => {
      try {
        const cipher = await composeCipher();
        if (!cipher || latestComposeRequestRef.current !== requestId) return;
        await checkCipher();
      } catch {
        setDocNumberExists(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [
    currentProjectCode,
    currentOriginatorCode,
    currentCategory,
    currentTitleObject,
    currentDisciplineCode,
    currentDocType,
    currentSerialNumber,
  ]);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Реестр документов
        </Typography.Title>
        {canManageMdr && (
          <Button
            type="primary"
            onClick={() => {
              form.setFieldsValue({
                document_key: nextDocumentKey,
                project_code: defaultProjectCode,
                originator_code: defaultOriginator,
              });
              setOpen(true);
            }}
          >
            + Добавить документ
          </Button>
        )}
      </Space>
      <Table rowKey="id" columns={columns} dataSource={mdr} size="small" />

      <Modal
        open={open}
        title="Создать документ в реестре"
        onCancel={() => setOpen(false)}
        onOk={submit}
        okButtonProps={{ loading: submitting }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="document_key" label="Уникальный ID документа" rules={[{ required: true }]}>
            <Input readOnly />
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
          <Form.Item name="category" label="Категория" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={categoryOptions}
              placeholder="Выберите категорию из справочника"
            />
          </Form.Item>
          <Form.Item name="title_object" label="Титульный объект" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={titleObjectOptions} placeholder="Из справочника проекта" />
          </Form.Item>
          <Form.Item name="discipline_code" label="Дисциплина" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={disciplineOptions} placeholder="Из справочника дисциплин" />
          </Form.Item>
          <Form.Item name="doc_type" label="Тип документа" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={documentTypeOptions} placeholder="Из справочника типов документов" />
          </Form.Item>
          <Form.Item name="serial_number" label="Порядковый номер" rules={[{ required: true }]}>
            <Input
              placeholder="0001"
              maxLength={4}
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, "").slice(0, 4);
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
          {docNumberExists === true && <Typography.Text type="danger">Шифр уже существует в этом проекте</Typography.Text>}
          {docNumberExists === false && <Typography.Text type="success">Шифр уникален</Typography.Text>}
          <Form.Item name="doc_name" label="Наименование" rules={[{ required: true }]}>
            <Input placeholder="Piping layout" />
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
    </>
  );
}
