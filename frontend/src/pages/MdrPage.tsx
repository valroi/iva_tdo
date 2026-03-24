import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { createMdr, deleteMdr, listProjectReferences, previewMdrDocNumber, updateMdr } from "../api";
import type { MDRRecord, ProjectItem, ProjectReference } from "../types";

interface Props {
  mdr: MDRRecord[];
  projects: ProjectItem[];
  onCreated: () => Promise<void>;
}

export default function MdrPage({ mdr, projects, onCreated }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingRow, setEditingRow] = useState<MDRRecord | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [references, setReferences] = useState<ProjectReference[]>([]);
  const [loadingReferences, setLoadingReferences] = useState(false);
  const [previewingDocNumber, setPreviewingDocNumber] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const selectedProjectCode = Form.useWatch("project_code", form);
  const editProjectCode = Form.useWatch("project_code", editForm);

  const selectedCodeForRefs = open ? selectedProjectCode : editOpen ? editProjectCode : undefined;

  useEffect(() => {
    if ((!open && !editOpen) || !selectedCodeForRefs) {
      setReferences([]);
      return;
    }
    const project = projects.find((item) => item.code === selectedCodeForRefs);
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
  }, [editOpen, open, projects, selectedCodeForRefs]);

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
    { title: "Категория", dataIndex: "category", key: "category" },
    { title: "Название", dataIndex: "doc_name", key: "doc_name" },
    { title: "Дисциплина", dataIndex: "discipline_code", key: "discipline_code" },
    {
      title: "Рассмотрение",
      dataIndex: "review_code",
      key: "review_code",
      render: (value: MDRRecord["review_code"]) => (value ? <Tag>{value}</Tag> : <Tag>n/a</Tag>),
    },
    { title: "Статус", dataIndex: "status", key: "status" },
    {
      title: "Действия",
      key: "actions",
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditingRow(row);
              editForm.setFieldsValue({
                project_code: row.project_code,
                category: row.category,
                title_object: row.title_object,
                discipline_code: row.discipline_code,
                doc_type: row.doc_type,
                doc_name: row.doc_name,
                doc_weight: row.doc_weight ?? 0,
              });
              setEditOpen(true);
            }}
          >
            Изменить
          </Button>
          <Popconfirm
            title="Удалить запись MDR?"
            description="Удаление необратимо"
            onConfirm={async () => {
              await deleteMdr(row.id);
              message.success("Запись MDR удалена");
              await onCreated();
            }}
          >
            <Button danger size="small">
              Удалить
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
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
      "category",
      "title_object",
      "discipline_code",
      "doc_type",
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
            <Select
              showSearch
              optionFilterProp="label"
              loading={loadingReferences}
              options={references
                .filter((ref) => ref.ref_type === "facility_title" && ref.is_active)
                .map((ref) => ({ value: ref.code, label: `${ref.code} — ${ref.value}` }))}
              placeholder="Выберите титул"
            />
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
          <Form.Item name="doc_number" label="Шифр документа" rules={[{ required: true }]}>
            <Input placeholder="Будет сгенерирован автоматически" readOnly />
          </Form.Item>
          <Button onClick={() => void generateDocNumber()} loading={previewingDocNumber}>
            Сгенерировать шифр
          </Button>
          <Form.Item name="doc_name" label="Наименование" rules={[{ required: true }]}>
            <Input placeholder="Piping layout" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={editOpen}
        title={`Изменить MDR #${editingRow?.id ?? ""}`}
        onCancel={() => setEditOpen(false)}
        onOk={async () => {
          if (!editingRow) return;
          const values = await editForm.validateFields();
          await updateMdr(editingRow.id, values);
          message.success("MDR обновлен");
          setEditOpen(false);
          setEditingRow(null);
          await onCreated();
        }}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="project_code" label="Код проекта">
            <Input disabled />
          </Form.Item>
          <Form.Item name="category" label="Категория" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={loadingReferences}
              options={categoryOptions}
            />
          </Form.Item>
          <Form.Item name="title_object" label="Титульный объект" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              loading={loadingReferences}
              options={references
                .filter((ref) => ref.ref_type === "facility_title" && ref.is_active)
                .map((ref) => ({ value: ref.code, label: `${ref.code} — ${ref.value}` }))}
            />
          </Form.Item>
          <Form.Item name="discipline_code" label="Код дисциплины" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" loading={loadingReferences} options={disciplineOptions} />
          </Form.Item>
          <Form.Item name="doc_type" label="Тип документа" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" loading={loadingReferences} options={docTypeOptions} />
          </Form.Item>
          <Form.Item name="doc_name" label="Наименование" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="doc_weight" label="Вес документа, %" rules={[{ required: true }]}>
            <Input type="number" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
