import {
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  createComment,
  createDocument,
  createRevision,
  listComments,
  listRevisions,
  respondToComment,
} from "../api";
import type { CommentItem, DocumentItem, MDRRecord, Revision } from "../types";

interface Props {
  documents: DocumentItem[];
  mdr: MDRRecord[];
  onReloadDocuments: () => Promise<void>;
}

export default function DocumentsPage({ documents, mdr, onReloadDocuments }: Props): JSX.Element {
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(
    documents[0]?.id ?? null,
  );
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);

  const [docModalOpen, setDocModalOpen] = useState(false);
  const [revModalOpen, setRevModalOpen] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);

  const [docForm] = Form.useForm();
  const [revForm] = Form.useForm();
  const [commentForm] = Form.useForm();
  const [responseForm] = Form.useForm();

  const documentRows = useMemo(
    () => documents.map((d) => ({ ...d, key: d.id })),
    [documents],
  );

  useEffect(() => {
    if (!selectedDocumentId) {
      setRevisions([]);
      setSelectedRevisionId(null);
      return;
    }

    listRevisions(selectedDocumentId)
      .then((items) => {
        setRevisions(items);
        setSelectedRevisionId(items[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "Failed to load revisions";
        message.error(text);
      });
  }, [selectedDocumentId]);

  useEffect(() => {
    if (!selectedRevisionId) {
      setComments([]);
      return;
    }

    listComments(selectedRevisionId)
      .then(setComments)
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "Failed to load comments";
        message.error(text);
      });
  }, [selectedRevisionId]);

  const documentColumns: ColumnsType<DocumentItem> = [
    { title: "Doc #", dataIndex: "document_num", key: "document_num" },
    { title: "Title", dataIndex: "title", key: "title" },
    { title: "Discipline", dataIndex: "discipline", key: "discipline" },
    {
      title: "Action",
      key: "action",
      render: (_, row) => (
        <Button size="small" onClick={() => setSelectedDocumentId(row.id)}>
          Open
        </Button>
      ),
    },
  ];

  const revisionColumns: ColumnsType<Revision> = [
    { title: "Rev", dataIndex: "revision_code", key: "revision_code" },
    { title: "Purpose", dataIndex: "issue_purpose", key: "issue_purpose" },
    { title: "Status", dataIndex: "status", key: "status" },
    {
      title: "TRM",
      dataIndex: "trm_number",
      key: "trm_number",
      render: (value: string | null) => value ?? "-",
    },
    {
      title: "Action",
      key: "action",
      render: (_, row) => (
        <Button size="small" onClick={() => setSelectedRevisionId(row.id)}>
          Comments
        </Button>
      ),
    },
  ];

  const commentColumns: ColumnsType<CommentItem> = [
    { title: "ID", dataIndex: "id", key: "id" },
    { title: "Text", dataIndex: "text", key: "text" },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (value: CommentItem["status"]) => {
        const colorMap: Record<CommentItem["status"], string> = {
          OPEN: "default",
          IN_PROGRESS: "processing",
          RESOLVED: "success",
          REJECTED: "error",
        };
        return <Tag color={colorMap[value]}>{value}</Tag>;
      },
    },
    { title: "Page", dataIndex: "page", key: "page", render: (value: number | null) => value ?? "-" },
    {
      title: "Action",
      key: "action",
      render: (_, row) => (
        <Button
          size="small"
          onClick={() => {
            setSelectedCommentId(row.id);
            setResponseModalOpen(true);
          }}
        >
          Respond
        </Button>
      ),
    },
  ];

  const submitNewDocument = async () => {
    const values = await docForm.validateFields();
    await createDocument(values);
    setDocModalOpen(false);
    docForm.resetFields();
    await onReloadDocuments();
  };

  const submitNewRevision = async () => {
    if (!selectedDocumentId) {
      message.warning("Select document first");
      return;
    }
    const values = await revForm.validateFields();
    await createRevision({ ...values, document_id: selectedDocumentId });
    setRevModalOpen(false);
    revForm.resetFields();
    const items = await listRevisions(selectedDocumentId);
    setRevisions(items);
  };

  const submitComment = async () => {
    if (!selectedRevisionId) {
      message.warning("Select revision first");
      return;
    }
    const values = await commentForm.validateFields();
    await createComment({ ...values, revision_id: selectedRevisionId, status: "OPEN" });
    setCommentModalOpen(false);
    commentForm.resetFields();
    const items = await listComments(selectedRevisionId);
    setComments(items);
  };

  const submitResponse = async () => {
    if (!selectedCommentId || !selectedRevisionId) {
      message.warning("Select comment first");
      return;
    }
    const values = await responseForm.validateFields();
    await respondToComment(selectedCommentId, values);
    setResponseModalOpen(false);
    responseForm.resetFields();
    const items = await listComments(selectedRevisionId);
    setComments(items);
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Documents, Revisions, Comments
        </Typography.Title>
        <Button type="primary" onClick={() => setDocModalOpen(true)}>
          + Document
        </Button>
        <Button onClick={() => setRevModalOpen(true)} disabled={!selectedDocumentId}>
          + Revision
        </Button>
        <Button onClick={() => setCommentModalOpen(true)} disabled={!selectedRevisionId}>
          + Comment
        </Button>
      </Space>

      <Row gutter={16}>
        <Col span={8}>
          <Card title="Documents">
            <Table rowKey="id" size="small" columns={documentColumns} dataSource={documentRows} pagination={false} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title={`Revisions (Doc: ${selectedDocumentId ?? "-"})`}>
            <Table rowKey="id" size="small" columns={revisionColumns} dataSource={revisions} pagination={false} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title={`Comments (Rev: ${selectedRevisionId ?? "-"})`}>
            <Table rowKey="id" size="small" columns={commentColumns} dataSource={comments} pagination={false} />
          </Card>
        </Col>
      </Row>

      <Modal open={docModalOpen} onCancel={() => setDocModalOpen(false)} onOk={submitNewDocument} title="Create Document">
        <Form form={docForm} layout="vertical">
          <Form.Item name="mdr_id" label="MDR" rules={[{ required: true }]}> 
            <Select
              options={mdr.map((item) => ({
                value: item.id,
                label: `${item.doc_number} - ${item.doc_name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="document_num" label="Document number" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="discipline" label="Discipline" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="weight" label="Weight" initialValue={1}>
            <Input type="number" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={revModalOpen} onCancel={() => setRevModalOpen(false)} onOk={submitNewRevision} title="Create Revision">
        <Form form={revForm} layout="vertical">
          <Form.Item name="revision_code" label="Revision code" rules={[{ required: true }]}>
            <Input placeholder="A" />
          </Form.Item>
          <Form.Item name="issue_purpose" label="Issue purpose" rules={[{ required: true }]}>
            <Input placeholder="IFR" />
          </Form.Item>
          <Form.Item name="status" label="Status" initialValue="SUBMITTED" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="trm_number" label="TRM number">
            <Input placeholder="TRM-001" />
          </Form.Item>
          <Form.Item name="file_path" label="File path (S3/local)">
            <Input placeholder="IVA/IVA-PD-0001/A/drawing.pdf" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={commentModalOpen} onCancel={() => setCommentModalOpen(false)} onOk={submitComment} title="Add Comment">
        <Form form={commentForm} layout="vertical">
          <Form.Item name="text" label="Comment text" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="page" label="Page">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="area_x" label="Area X">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="area_y" label="Area Y">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="area_w" label="Area Width">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="area_h" label="Area Height">
            <Input type="number" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={responseModalOpen} onCancel={() => setResponseModalOpen(false)} onOk={submitResponse} title="Respond to Comment">
        <Form form={responseForm} layout="vertical" initialValues={{ status: "IN_PROGRESS" }}>
          <Form.Item name="text" label="Response" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="status" label="New status" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "IN_PROGRESS", label: "IN_PROGRESS" },
                { value: "RESOLVED", label: "RESOLVED" },
                { value: "REJECTED", label: "REJECTED" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
