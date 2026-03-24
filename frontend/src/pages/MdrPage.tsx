import { Button, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { createMdr, listProjectReferences, previewMdrDocNumber } from "../api";
import type { MDRRecord, ProjectItem, ProjectReference } from "../types";

interface Props {
  mdr: MDRRecord[];
  projects: ProjectItem[];
  onCreated: () => Promise<void>;
}

export default function MdrPage({ mdr, projects, onCreated }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [loadingReferences, setLoadingReferences] = useState(false);
  const [previewingDocNumber, setPreviewingDocNumber] = useState(false);
  const [form] = Form.useForm();
  const selectedProjectCode = Form.useWatch("project_code", form);

  useEffect(() => {
    if (!open || !selectedProjectCode) {
      setReferences([]);
      return;
    }
    const project = projects.find((item) => item.code === selectedProjectCode);
    if (!project) {
      setReferences([]);
      return;
    }
    setLoadingReferences(true);
    void listProjectReferences(project.id)
      .then(setReferences)
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "Не удалось загрузить справочники проекта";
        message.error(text);
      })
      .finally(() => setLoadingReferences(false));
  }, [open, projects, selectedProjectCode]);

  const categoryOptions = useMemo(
    () =>
      references
        .filter((ref) => ref.ref_type === "document_category" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} — ${ref.value}` })),
    [references],
  );
  const disciplineOptions = useMemo(
    () =>
      references
        .filter((ref) => ref.ref_type === "discipline" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} — ${ref.value}` })),
    [references],
  );
  const docTypeOptions = useMemo(
    () =>
      references
        .filter((ref) => ref.ref_type === "document_type" && ref.is_active)
        .map((ref) => ({ value: ref.code, label: `${ref.code} — ${ref.value}` })),
    [references],
  );

  const columns: ColumnsType<MDRRecord> = [
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
    { title: "Статус", dataIndex: "status", key: "status" },
  ];

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await createMdr({
        ...values,
        progress_percent: 0,
        doc_weight: 1,
        dates: {},
        status: "DRAFT",
        is_confidential: false,
      });
      form.resetFields();
      setOpen(false);
      await onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  const generateDocNumber = async () => {
    const values = await form.validateFields([
      "project_code",
      "originator_code",
      "category",
      "title_object",
      "discipline_code",
      "doc_type",
      "serial_number",
    ]);
    setPreviewingDocNumber(true);
    try {
      const resp = await previewMdrDocNumber(values);
      form.setFieldValue("doc_number", resp.doc_number);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Ошибка генерации шифра";
      message.error(text);
    } finally {
      setPreviewingDocNumber(false);
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Реестр MDR
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          + Добавить MDR
        </Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={mdr} />

      <Modal
        open={open}
        title="Создать MDR запись"
        onCancel={() => setOpen(false)}
        onOk={submit}
        okButtonProps={{ loading: submitting }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="document_key" label="Ключ документа" rules={[{ required: true }]}>
            <Input placeholder="DOC-001" />
          </Form.Item>
          <Form.Item name="project_code" label="Код проекта" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={projects.map((project) => ({
                value: project.code,
                label: `${project.code} — ${project.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="originator_code" label="Код разработчика" rules={[{ required: true }]}>
            <Input placeholder="CTR" />
          </Form.Item>
          <Form.Item name="category" label="Категория" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={loadingReferences}
              options={categoryOptions}
              placeholder="Выберите категорию"
            />
          </Form.Item>
          <Form.Item name="title_object" label="Титульный объект" rules={[{ required: true }]}>
            <Input placeholder="Unit-1" />
          </Form.Item>
          <Form.Item name="discipline_code" label="Дисциплина" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={loadingReferences}
              options={disciplineOptions}
              placeholder="Выберите дисциплину"
            />
          </Form.Item>
          <Form.Item name="doc_type" label="Тип документа" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={loadingReferences}
              options={docTypeOptions}
              placeholder="Выберите тип документа"
            />
          </Form.Item>
          <Form.Item name="serial_number" label="Порядковый номер" rules={[{ required: true }]}>
            <Input placeholder="0001" />
          </Form.Item>
          <Form.Item name="doc_number" label="Шифр документа" rules={[{ required: true }]}>
            <Input placeholder="Будет сгенерирован автоматически" />
          </Form.Item>
          <Button onClick={() => void generateDocNumber()} loading={previewingDocNumber}>
            Сгенерировать шифр
          </Button>
          <Form.Item name="doc_name" label="Наименование" rules={[{ required: true }]}>
            <Input placeholder="Piping layout" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
