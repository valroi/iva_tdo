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
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { UploadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";

import {
  createComment,
  createDocument,
  createRevision,
  listComments,
  listRevisions,
  respondToComment,
  uploadRevisionPdf,
} from "../api";
import type { CommentItem, DocumentItem, MDRRecord, Revision } from "../types";

interface Props {
  documents: DocumentItem[];
  mdr: MDRRecord[];
  onReloadDocuments: () => Promise<void>;
}

export default function DocumentsPage({ documents, mdr, onReloadDocuments }: Props): JSX.Element {
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(documents[0]?.id ?? null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);

  const [docModalOpen, setDocModalOpen] = useState(false);
  const [revModalOpen, setRevModalOpen] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const [docForm] = Form.useForm();
  const selectedMdrId = Form.useWatch("mdr_id", docForm);
  const selectedMdr = useMemo(
    () => mdr.find((item) => item.id === selectedMdrId) ?? null,
    [mdr, selectedMdrId],
  );

  useEffect(() => {
    if (!selectedMdr) {
      return;
    }
    docForm.setFieldsValue({
      document_num: selectedMdr.doc_number,
      discipline: selectedMdr.discipline_code,
      title: selectedMdr.doc_name,
    });
  }, [docForm, selectedMdr]);

  const [revForm] = Form.useForm();
  const [commentForm] = Form.useForm();
  const [responseForm] = Form.useForm();

  const documentRows = useMemo(() => documents.map((d) => ({ ...d, key: d.id })), [documents]);

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
        const text = error instanceof Error ? error.message : "Ошибка загрузки ревизий";
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
        const text = error instanceof Error ? error.message : "Ошибка загрузки комментариев";
        message.error(text);
      });
  }, [selectedRevisionId]);

  const documentColumns: ColumnsType<DocumentItem> = [
    { title: "Шифр", dataIndex: "document_num", key: "document_num" },
    { title: "Название", dataIndex: "title", key: "title" },
    { title: "Дисциплина", dataIndex: "discipline", key: "discipline" },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Button size="small" onClick={() => setSelectedDocumentId(row.id)}>
          Открыть
        </Button>
      ),
    },
  ];

  const revisionColumns: ColumnsType<Revision> = [
    { title: "Рев", dataIndex: "revision_code", key: "revision_code" },
    { title: "Цель", dataIndex: "issue_purpose", key: "issue_purpose" },
    { title: "Статус", dataIndex: "status", key: "status" },
    {
      title: "Файл",
      dataIndex: "file_path",
      key: "file_path",
      render: (value: string | null) => (value ? value.split("/").slice(-1)[0] : "—"),
    },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setSelectedRevisionId(row.id)}>
            Комментарии
          </Button>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={() => {
              setSelectedRevisionId(row.id);
              setUploadFile(null);
              setUploadModalOpen(true);
            }}
          >
            PDF
          </Button>
        </Space>
      ),
    },
  ];

  const commentColumns: ColumnsType<CommentItem> = [
    { title: "ID", dataIndex: "id", key: "id" },
    { title: "Текст", dataIndex: "text", key: "text" },
    {
      title: "Статус",
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
    { title: "Лист", dataIndex: "page", key: "page", render: (value: number | null) => value ?? "—" },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Button
          size="small"
          onClick={() => {
            setSelectedCommentId(row.id);
            setResponseModalOpen(true);
          }}
        >
          Ответить
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
      message.warning("Сначала выберите документ");
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
      message.warning("Сначала выберите ревизию");
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
      message.warning("Сначала выберите комментарий");
      return;
    }
    const values = await responseForm.validateFields();
    await respondToComment(selectedCommentId, values);
    setResponseModalOpen(false);
    responseForm.resetFields();
    const items = await listComments(selectedRevisionId);
    setComments(items);
  };

  const submitUpload = async () => {
    if (!selectedRevisionId || !uploadFile) {
      message.warning("Выберите ревизию и PDF файл");
      return;
    }

    const result = await uploadRevisionPdf(selectedRevisionId, uploadFile);
    message.success(`Файл загружен: ${result.file_name}`);
    setUploadModalOpen(false);

    if (selectedDocumentId) {
      const items = await listRevisions(selectedDocumentId);
      setRevisions(items);
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Документы, ревизии, комментарии
        </Typography.Title>
        <Button type="primary" onClick={() => setDocModalOpen(true)}>
          + Документ
        </Button>
        <Button onClick={() => setRevModalOpen(true)} disabled={!selectedDocumentId}>
          + Ревизия
        </Button>
        <Button onClick={() => setCommentModalOpen(true)} disabled={!selectedRevisionId}>
          + Комментарий
        </Button>
      </Space>

      <Row gutter={16}>
        <Col span={8}>
          <Card title="Документы">
            <Table rowKey="id" size="small" columns={documentColumns} dataSource={documentRows} pagination={false} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title={`Ревизии (документ: ${selectedDocumentId ?? "—"})`}>
            <Table rowKey="id" size="small" columns={revisionColumns} dataSource={revisions} pagination={false} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title={`Комментарии (ревизия: ${selectedRevisionId ?? "—"})`}>
            <Table rowKey="id" size="small" columns={commentColumns} dataSource={comments} pagination={false} />
          </Card>
        </Col>
      </Row>

      <Modal open={docModalOpen} onCancel={() => setDocModalOpen(false)} onOk={submitNewDocument} title="Создать документ">
        <Form form={docForm} layout="vertical">
          <Form.Item name="mdr_id" label="MDR" rules={[{ required: true }]}>
            <Select
              options={mdr.map((item) => ({
                value: item.id,
                label: `${item.doc_number} - ${item.doc_name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="document_num" label="Шифр документа" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="title" label="Название" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="discipline" label="Дисциплина" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="weight" label="Вес" initialValue={1}>
            <Input type="number" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={revModalOpen} onCancel={() => setRevModalOpen(false)} onOk={submitNewRevision} title="Создать ревизию">
        <Form form={revForm} layout="vertical">
          <Form.Item name="revision_code" label="Код ревизии" rules={[{ required: true }]}>
            <Input placeholder="A" />
          </Form.Item>
          <Form.Item name="issue_purpose" label="Цель выпуска" rules={[{ required: true }]}>
            <Input placeholder="IFR" />
          </Form.Item>
          <Form.Item name="status" label="Статус" initialValue="SUBMITTED" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="trm_number" label="Номер TRM">
            <Input placeholder="TRM-001" />
          </Form.Item>
          <Form.Item name="file_path" label="Путь к файлу (если уже есть)">
            <Input placeholder="DEMO/DOC/A/file.pdf" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={commentModalOpen} onCancel={() => setCommentModalOpen(false)} onOk={submitComment} title="Добавить комментарий">
        <Form form={commentForm} layout="vertical">
          <Form.Item name="text" label="Комментарий" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="page" label="Лист">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="area_x" label="Координата X">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="area_y" label="Координата Y">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="area_w" label="Ширина области">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="area_h" label="Высота области">
            <Input type="number" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={responseModalOpen} onCancel={() => setResponseModalOpen(false)} onOk={submitResponse} title="Ответ на комментарий">
        <Form form={responseForm} layout="vertical" initialValues={{ status: "IN_PROGRESS" }}>
          <Form.Item name="text" label="Ответ" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="status" label="Новый статус" rules={[{ required: true }]}>
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

      <Modal open={uploadModalOpen} onCancel={() => setUploadModalOpen(false)} onOk={submitUpload} title="Загрузить PDF в ревизию">
        <Typography.Paragraph>
          Выбранная ревизия: {selectedRevisionId ?? "—"}. Поддерживается только PDF.
        </Typography.Paragraph>
        <Upload
          beforeUpload={(file) => {
            if (file.type !== "application/pdf") {
              message.error("Можно загружать только PDF");
              return Upload.LIST_IGNORE;
            }
            setUploadFile(file as File);
            return false;
          }}
          maxCount={1}
          onRemove={() => setUploadFile(null)}
        >
          <Button icon={<UploadOutlined />}>Выбрать PDF</Button>
        </Upload>
      </Modal>
    </>
  );
}
