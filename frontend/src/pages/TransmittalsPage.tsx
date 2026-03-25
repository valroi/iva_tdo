import { Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { createTransmittal, listRevisions, listTransmittals, me } from "../api";
import type { DocumentItem, Revision, Transmittal, User } from "../types";

interface Props {
  documents: DocumentItem[];
  onReloadAll: () => Promise<void>;
}

export default function TransmittalsPage({ documents, onReloadAll: _onReloadAll }: Props): JSX.Element {
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(documents[0]?.id ?? null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [transmittals, setTransmittals] = useState<Transmittal[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [form] = Form.useForm();

  const revisionOptions = useMemo(
    () =>
      revisions.map((r) => ({
        value: r.id,
        label: `${r.revision_code} / ${r.issue_purpose} / ${r.status}`,
      })),
    [revisions],
  );

  const refreshTransmittals = async () => {
    const items = await listTransmittals();
    setTransmittals(items);
  };

  useEffect(() => {
    me()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => {
    void refreshTransmittals().catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : "Не удалось загрузить TRM");
    });
  }, []);

  useEffect(() => {
    if (!selectedDocumentId) {
      setRevisions([]);
      return;
    }
    listRevisions(selectedDocumentId)
      .then(setRevisions)
      .catch((error: unknown) => {
        message.error(error instanceof Error ? error.message : "Не удалось загрузить ревизии");
      });
  }, [selectedDocumentId]);

  const columns: ColumnsType<Transmittal> = [
    { title: "TRM №", dataIndex: "trm_number", key: "trm_number" },
    { title: "Цель выпуска", dataIndex: "issue_purpose", key: "issue_purpose" },
    { title: "Канал", dataIndex: "channel", key: "channel" },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      render: (value: string) => <Tag>{value}</Tag>,
    },
    { title: "Создан", dataIndex: "created_at", key: "created_at" },
  ];

  const canCreateTransmittal = useMemo(() => {
    if (!currentUser) return false;
    return currentUser.role === "admin" || currentUser.role === "contractor_manager" || currentUser.role === "contractor_author";
  }, [currentUser]);

  const submit = async () => {
    const values = await form.validateFields();
    await createTransmittal({
      trm_number: values.trm_number,
      issue_purpose: values.issue_purpose,
      channel: values.channel,
      note: values.note ?? null,
      revision_ids: values.revision_ids,
    });
    message.success("TRM отправлен");
    setModalOpen(false);
    form.resetFields();
    await Promise.all([refreshTransmittals(), onReloadAll()]);
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          TRM центр
        </Typography.Title>
        <Button type="primary" onClick={() => setModalOpen(true)} disabled={!canCreateTransmittal}>
          + Создать TRM
        </Button>
      </Space>
      {!canCreateTransmittal && (
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Создание TRM доступно ролям: admin, contractor_manager, contractor_author.
        </Typography.Text>
      )}

      <Card style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            style={{ minWidth: 320 }}
            placeholder="Выберите документ"
            value={selectedDocumentId ?? undefined}
            onChange={(value) => setSelectedDocumentId(value)}
            options={documents.map((doc) => ({
              value: doc.id,
              label: `${doc.document_num} — ${doc.title}`,
            }))}
          />
          <Typography.Text type="secondary">Выберите документ, чтобы добавить его ревизии в TRM</Typography.Text>
        </Space>
      </Card>

      <Card>
        <Table rowKey="id" size="small" columns={columns} dataSource={transmittals} />
      </Card>

      <Modal open={modalOpen} title="Создать TRM" onCancel={() => setModalOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item name="trm_number" label="Номер TRM" rules={[{ required: true }]}>
            <Input placeholder="IVA-TRM-0001" />
          </Form.Item>
          <Form.Item name="issue_purpose" label="Цель выпуска" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "IFR", label: "IFR" },
                { value: "IFD", label: "IFD" },
                { value: "IFC", label: "IFC" },
                { value: "IFU", label: "IFU" },
                { value: "AFP", label: "AFP" },
                { value: "IFI", label: "IFI" },
              ]}
            />
          </Form.Item>
          <Form.Item name="channel" label="Канал" initialValue="tdms">
            <Select
              options={[
                { value: "tdms", label: "TDMS" },
                { value: "portal", label: "Portal" },
                { value: "email", label: "Email" },
              ]}
            />
          </Form.Item>
          <Form.Item name="revision_ids" label="Ревизии" rules={[{ required: true }]}>
            <Select mode="multiple" options={revisionOptions} />
          </Form.Item>
          <Form.Item name="note" label="Примечание">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
