import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";

import { checkMdrCipher, composeMdrCipher, createMdr } from "../api";
import type { MDRRecord, ProjectItem } from "../types";

interface Props {
  mdr: MDRRecord[];
  projects: ProjectItem[];
  onCreated: () => Promise<void>;
}

export default function MdrPage({ mdr, projects, onCreated }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [form] = Form.useForm();

  const currentProjectCode = Form.useWatch("project_code", form);
  const currentDocType = Form.useWatch("doc_type", form);

  const typeWeight = useMemo(() => {
    if (!currentProjectCode || !currentDocType) return 0;
    return mdr
      .filter((row) => row.project_code === currentProjectCode && row.doc_type === currentDocType)
      .reduce((acc, row) => acc + (row.doc_weight ?? 0), 0);
  }, [currentDocType, currentProjectCode, mdr]);

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
    { title: "Вес", dataIndex: "doc_weight", key: "doc_weight" },
    { title: "Статус", dataIndex: "status", key: "status" },
  ];

  const submit = async () => {
    const values = await form.validateFields();
    if ((values.doc_weight ?? 0) + typeWeight > 1000) {
      message.error(`Превышен лимит веса для типа: ${(values.doc_weight ?? 0) + typeWeight} / 1000`);
      return;
    }

    setSubmitting(true);
    try {
      await createMdr({
        ...values,
        progress_percent: 0,
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

  const composeCipher = async () => {
    const values = await form.validateFields([
      "project_code",
      "originator_code",
      "category",
      "title_object",
      "discipline_code",
      "doc_type",
      "serial_number",
    ]);
    setComposing(true);
    try {
      const composed = await composeMdrCipher(values);
      form.setFieldValue("doc_number", composed.cipher);
      message.success(`Шифр собран по правилу ${composed.rule}`);
    } finally {
      setComposing(false);
    }
  };

  const checkCipher = async () => {
    const values = await form.validateFields(["project_code", "doc_number"]);
    setChecking(true);
    try {
      const result = await checkMdrCipher(values.project_code, values.doc_number);
      if (result.exists) {
        message.error("Шифр уже существует в этом проекте");
      } else {
        message.success("Шифр уникален");
      }
    } finally {
      setChecking(false);
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
            <Input placeholder="PIPING" />
          </Form.Item>
          <Form.Item name="title_object" label="Титульный объект" rules={[{ required: true }]}>
            <Input placeholder="Unit-1" />
          </Form.Item>
          <Form.Item name="discipline_code" label="Дисциплина" rules={[{ required: true }]}>
            <Input placeholder="PD" />
          </Form.Item>
          <Form.Item name="doc_type" label="Тип документа" rules={[{ required: true }]}>
            <Input placeholder="DRAWING" />
          </Form.Item>
          <Form.Item name="serial_number" label="Порядковый номер" rules={[{ required: true }]}>
            <Input placeholder="0001" />
          </Form.Item>
          <Space style={{ marginBottom: 12 }}>
            <Button onClick={() => void composeCipher()} loading={composing}>
              Собрать шифр
            </Button>
            <Button onClick={() => void checkCipher()} loading={checking}>
              Проверить уникальность
            </Button>
          </Space>
          <Form.Item name="doc_number" label="Шифр документа" rules={[{ required: true }]}>
            <Input placeholder="IVA-PD-0001" />
          </Form.Item>
          <Form.Item name="doc_name" label="Наименование" rules={[{ required: true }]}>
            <Input placeholder="Piping layout" />
          </Form.Item>
          <Form.Item name="doc_weight" label={`Вес документа (текущий суммарный вес типа: ${typeWeight}/1000)`} rules={[{ required: true }]}>
            <InputNumber min={0} max={1000} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
