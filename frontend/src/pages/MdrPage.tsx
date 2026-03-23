import { Button, Form, Input, Modal, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";

import { createMdr } from "../api";
import type { MDRRecord } from "../types";

interface Props {
  mdr: MDRRecord[];
  onCreated: () => Promise<void>;
}

export default function MdrPage({ mdr, onCreated }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const columns: ColumnsType<MDRRecord> = [
    { title: "Doc Number", dataIndex: "doc_number", key: "doc_number" },
    { title: "Name", dataIndex: "doc_name", key: "doc_name" },
    { title: "Discipline", dataIndex: "discipline_code", key: "discipline_code" },
    {
      title: "Review",
      dataIndex: "review_code",
      key: "review_code",
      render: (value: MDRRecord["review_code"]) => (value ? <Tag>{value}</Tag> : <Tag>n/a</Tag>),
    },
    { title: "Status", dataIndex: "status", key: "status" },
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

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Реестр MDR
        </Typography.Title>
        <Button type="primary" onClick={() => setOpen(true)}>
          + Add MDR
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
          <Form.Item name="document_key" label="Document key" rules={[{ required: true }]}>
            <Input placeholder="DOC-001" />
          </Form.Item>
          <Form.Item name="project_code" label="Project code" rules={[{ required: true }]}>
            <Input placeholder="IVA" />
          </Form.Item>
          <Form.Item name="originator_code" label="Originator code" rules={[{ required: true }]}>
            <Input placeholder="CTR" />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Input placeholder="PIPING" />
          </Form.Item>
          <Form.Item name="title_object" label="Title object" rules={[{ required: true }]}>
            <Input placeholder="Unit-1" />
          </Form.Item>
          <Form.Item name="discipline_code" label="Discipline" rules={[{ required: true }]}>
            <Input placeholder="PD" />
          </Form.Item>
          <Form.Item name="doc_type" label="Doc type" rules={[{ required: true }]}>
            <Input placeholder="DRAWING" />
          </Form.Item>
          <Form.Item name="serial_number" label="Serial" rules={[{ required: true }]}>
            <Input placeholder="0001" />
          </Form.Item>
          <Form.Item name="doc_number" label="Doc number" rules={[{ required: true }]}>
            <Input placeholder="IVA-PD-0001" />
          </Form.Item>
          <Form.Item name="doc_name" label="Doc name" rules={[{ required: true }]}>
            <Input placeholder="Piping layout" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
