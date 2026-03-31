import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { UploadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import {
  createRevision,
  listComments,
  listRevisions,
  ownerCommentDecision,
  publishComment,
  processRevisionTdoDecision,
  respondToComment,
  uploadRevisionPdf,
  getAuthHeaders,
  getRevisionPdfUrl,
} from "../api";
import RevisionPdfAnnotator from "../components/RevisionPdfAnnotator";
import type { CommentItem, DocumentItem, MDRRecord, ProjectMember, Revision, User } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface Props {
  documents: DocumentItem[];
  mdr: MDRRecord[];
  currentUser: User;
  projectMembers?: ProjectMember[];
  notificationTarget?: { project_code?: string | null; document_num?: string | null; revision_id?: number | null } | null;
  onNotificationTargetHandled?: () => void;
}

export default function DocumentsPage({
  documents,
  mdr,
  currentUser,
  projectMembers = [],
  notificationTarget,
  onNotificationTargetHandled,
}: Props): JSX.Element {
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(documents[0]?.id ?? null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);

  const [revModalOpen, setRevModalOpen] = useState(false);
  const [pdfAnnotatorOpen, setPdfAnnotatorOpen] = useState(false);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [tdoCancelOpen, setTdoCancelOpen] = useState(false);
  const [tdoTargetRevision, setTdoTargetRevision] = useState<Revision | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);
  const [selectedCommentForResponse, setSelectedCommentForResponse] = useState<CommentItem | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [responsePageNumber, setResponsePageNumber] = useState(1);
  const [responsePdfPages, setResponsePdfPages] = useState(1);
  const [responsePdfError, setResponsePdfError] = useState<string | null>(null);
  const [preferredRevisionId, setPreferredRevisionId] = useState<number | null>(null);

  const [revForm] = Form.useForm();
  const [responseForm] = Form.useForm();
  const [tdoCancelForm] = Form.useForm<{ note?: string }>();
  const responsePdfUrl = useMemo(
    () => (selectedRevisionId ? getRevisionPdfUrl(selectedRevisionId) : null),
    [selectedRevisionId],
  );
  const responsePdfOptions = useMemo(() => ({ httpHeaders: getAuthHeaders() }), [responseModalOpen]);

  const documentRows = useMemo(() => documents.map((d) => ({ ...d, key: d.id })), [documents]);
  const selectedDocument = useMemo(
    () => documents.find((item) => item.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );
  const selectedMdr = useMemo(
    () => mdr.find((item) => item.id === (selectedDocument?.mdr_id ?? -1)) ?? null,
    [mdr, selectedDocument],
  );
  const currentCategory = (selectedMdr?.category ?? "").toUpperCase();
  const selectedRevision = useMemo(
    () => revisions.find((item) => item.id === selectedRevisionId) ?? null,
    [revisions, selectedRevisionId],
  );
  const reviewCodeHelp: Record<string, string> = {
    AP: "Замечаний нет. Следующая ревизия с изменением цели выпуска.",
    AN: "Незначительные замечания. Следующая ревизия с той же целью выпуска.",
    CO: "Существенные замечания. Следующая ревизия с той же целью выпуска.",
    RJ: "Ревизия не засчитывается. Перевыпуск в той же ревизии и с той же целью.",
  };

  const issuePurposeOptions = useMemo(() => {
    if (currentCategory === "PD") {
      return ["IFR", "IFD"];
    }
    if (currentCategory === "DD") {
      return ["IFR", "IFC"];
    }
    if (["PR", "PROCUREMENT", "PURCHASE", "SUPPLY", "PO"].includes(currentCategory)) {
      return ["IFQ", "IFP", "AFP"];
    }
    if (["PM", "PROCEDURE", "MANAGEMENT"].includes(currentCategory)) {
      return ["IFR", "IFU"];
    }
    return ["IFR", "IFD", "IFC", "IFQ", "IFP", "AFP", "IFU"];
  }, [currentCategory]);

  const computeNextAlphabeticRevision = (): string => {
    const letters = revisions
      .map((item) => String(item.revision_code ?? "").toUpperCase())
      .filter((code) => /^[A-Z]$/.test(code))
      .sort();
    if (letters.length === 0) return "A";
    const last = letters[letters.length - 1];
    const nextCode = last.charCodeAt(0) + 1;
    if (nextCode > "Z".charCodeAt(0)) return "Z";
    return String.fromCharCode(nextCode);
  };

  const computeNextNumericRevision = (): string => {
    const values = revisions
      .map((item) => String(item.revision_code ?? ""))
      .filter((code) => /^\d{2}$/.test(code))
      .map((code) => Number(code));
    const next = (values.length ? Math.max(...values) : -1) + 1;
    return String(next).padStart(2, "0");
  };

  const applyAutoRevision = (issuePurpose: string | undefined) => {
    if (!issuePurpose) return;
    const normalized = issuePurpose.toUpperCase();
    if (normalized === "IFR") {
      revForm.setFieldValue("revision_code", computeNextAlphabeticRevision());
      return;
    }
    revForm.setFieldValue("revision_code", computeNextNumericRevision());
  };

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedDocumentId(null);
      setSelectedRevisionId(null);
      return;
    }
    if (!selectedDocumentId || !documents.some((item) => item.id === selectedDocumentId)) {
      setSelectedDocumentId(documents[0].id);
    }
  }, [documents, selectedDocumentId]);

  useEffect(() => {
    if (!notificationTarget?.document_num) return;
    const targetDoc = documents.find((item) => item.document_num === notificationTarget.document_num);
    if (!targetDoc) return;
    setSelectedDocumentId(targetDoc.id);
    if (notificationTarget.revision_id) {
      setPreferredRevisionId(notificationTarget.revision_id);
    }
    onNotificationTargetHandled?.();
  }, [documents, notificationTarget, onNotificationTargetHandled]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setRevisions([]);
      setSelectedRevisionId(null);
      return;
    }

    listRevisions(selectedDocumentId)
      .then((items) => {
        setRevisions(items);
        if (preferredRevisionId && items.some((item) => item.id === preferredRevisionId)) {
          setSelectedRevisionId(preferredRevisionId);
          setPreferredRevisionId(null);
        } else {
          setSelectedRevisionId(items[0]?.id ?? null);
        }
      })
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "Ошибка загрузки ревизий";
        message.error(text);
      });
  }, [preferredRevisionId, selectedDocumentId]);

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

  useEffect(() => {
    if (!revModalOpen) return;
    const defaultPurpose = issuePurposeOptions[0] ?? "IFR";
    revForm.setFieldValue("issue_purpose", defaultPurpose);
    applyAutoRevision(defaultPurpose);
  }, [revModalOpen, selectedDocumentId, issuePurposeOptions, revisions]);

  const documentColumns: ColumnsType<DocumentItem> = [
    {
      title: "Шифр",
      dataIndex: "document_num",
      key: "document_num",
      width: 320,
      render: (value: string, row) => (
        <Button type="link" size="small" onClick={() => setSelectedDocumentId(row.id)} style={{ padding: 0 }}>
          {value}
        </Button>
      ),
    },
    { title: "Название", dataIndex: "title", key: "title", width: 180 },
    { title: "Дисциплина", dataIndex: "discipline", key: "discipline", width: 120 },
    {
      title: "Последняя ревизия",
      key: "latest_revision",
      width: 130,
      render: (_, row) => row.latest_revision_code ?? "—",
    },
    {
      title: "Статус последней",
      key: "latest_status",
      width: 220,
      render: (_, row) => row.latest_revision_status ?? "—",
    },
    {
      title: "Review code",
      key: "latest_review",
      width: 110,
      render: (_, row) => row.latest_review_code ?? "—",
    },
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
      title: "Срок обсуждения",
      dataIndex: "review_deadline",
      key: "review_deadline",
      render: (value: string | null) => value ?? "—",
    },
    {
      title: "Файл",
      dataIndex: "file_path",
      key: "file_path",
      render: (_value: string | null, row) =>
        row.file_path ? `${selectedDocument?.document_num ?? "DOC"}_rev_${row.revision_code}.pdf` : "—",
    },
    {
      title: "Действие",
      key: "action",
      width: 360,
      render: (_, row) => (
        <Space wrap size={[8, 8]}>
          {currentUser.permissions.can_upload_files && (
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
          )}
          {currentUser.permissions.can_process_tdo_queue && (
            <>
              <Button
                size="small"
                type="primary"
                onClick={async () => {
                  await processRevisionTdoDecision(row.id, { action: "SEND_TO_OWNER" });
                  message.success("Ревизия отправлена заказчику");
                  if (selectedDocumentId) {
                    setRevisions(await listRevisions(selectedDocumentId));
                  }
                }}
              >
                В TRM
              </Button>
              <Button
                size="small"
                danger
                onClick={() => {
                  setTdoTargetRevision(row);
                  tdoCancelForm.resetFields();
                  setTdoCancelOpen(true);
                }}
              >
                Отменить
              </Button>
            </>
          )}
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
    {
      title: "Маршрут",
      key: "flow",
      render: (_, row) => {
        if (row.status === "REJECTED") return <Tag color="red">REJECTED</Tag>;
        if (row.is_published_to_contractor) return <Tag color="blue">PUBLISHED</Tag>;
        if (row.status === "OPEN") return <Tag color="gold">LR_REVIEW</Tag>;
        return <Tag color="default">IN_WORK</Tag>;
      },
    },
    { title: "Лист", dataIndex: "page", key: "page", render: (value: number | null) => value ?? "—" },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            disabled={!currentUser.permissions.can_respond_comments || row.author_id === currentUser.id}
            onClick={() => {
              setSelectedCommentId(row.id);
              setSelectedCommentForResponse(row);
              setResponsePageNumber(Math.max(1, row.page ?? 1));
              setResponsePdfError(null);
              setResponseModalOpen(true);
            }}
          >
            Ответить
          </Button>
          {currentUser.permissions.can_publish_comments && !row.is_published_to_contractor && (
            <Button
              size="small"
              onClick={async () => {
                if (!selectedRevisionId) return;
                await publishComment(row.id);
                message.success("Замечание передано подрядчику");
                setComments(await listComments(selectedRevisionId));
              }}
            >
              Передать подрядчику
            </Button>
          )}
          {currentUser.permissions.can_publish_comments && row.status !== "REJECTED" && (
            <Button
              size="small"
              danger
              onClick={async () => {
                if (!selectedRevisionId) return;
                await ownerCommentDecision(row.id, { action: "REJECT", note: "Отклонено LR" });
                message.success("Замечание отклонено LR");
                setComments(await listComments(selectedRevisionId));
              }}
            >
              Отклонить
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const submitNewRevision = async () => {
    if (!selectedDocumentId) {
      message.warning("Сначала выберите документ");
      return;
    }
    if (!currentUser.permissions.can_create_mdr) {
      message.error("Недостаточно прав для создания ревизии");
      return;
    }
    const values = await revForm.validateFields();
    await createRevision({ ...values, document_id: selectedDocumentId });
    setRevModalOpen(false);
    revForm.resetFields();
    const items = await listRevisions(selectedDocumentId);
    setRevisions(items);
  };

  const submitResponse = async () => {
    if (!selectedCommentId || !selectedRevisionId) {
      message.warning("Сначала выберите комментарий");
      return;
    }
    if (!currentUser.permissions.can_respond_comments) {
      message.error("Недостаточно прав для ответа на комментарий");
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
    if (!currentUser.permissions.can_upload_files) {
      message.error("Недостаточно прав для загрузки PDF");
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
          Ревизии и комментарии
        </Typography.Title>
        {currentUser.permissions.can_create_mdr && (
          <Button onClick={() => setRevModalOpen(true)} disabled={!selectedDocumentId}>
            + Ревизия
          </Button>
        )}
        {currentUser.permissions.can_raise_comments && (
          <Button
            onClick={() => setPdfAnnotatorOpen(true)}
            disabled={!selectedRevisionId}
          >
            + Вопрос/замечание
          </Button>
        )}
      </Space>

      <Row gutter={16}>
        <Col span={10}>
          <Card title="Документы">
            <Table
              rowKey="id"
              size="small"
              columns={documentColumns}
              dataSource={documentRows}
              pagination={false}
              scroll={{ x: 760 }}
            />
          </Card>
        </Col>
        <Col span={14}>
          <Card title={selectedDocument ? `Карточка документа: ${selectedDocument.document_num}` : "Карточка документа"}>
            {selectedDocument && selectedMdr ? (
              <>
                <Descriptions size="small" column={2} style={{ marginBottom: 10 }}>
                  <Descriptions.Item label="Наименование">{selectedDocument.title}</Descriptions.Item>
                  <Descriptions.Item label="Дисциплина">{selectedDocument.discipline}</Descriptions.Item>
                  <Descriptions.Item label="Категория">{selectedMdr.category}</Descriptions.Item>
                  <Descriptions.Item label="Титульный объект">{selectedMdr.title_object}</Descriptions.Item>
                  <Descriptions.Item label="Шифр">{selectedMdr.doc_number}</Descriptions.Item>
                  <Descriptions.Item label="ID">{selectedMdr.document_key}</Descriptions.Item>
                </Descriptions>
                <Typography.Text type="secondary">
                  PDF прикрепляется к ревизии через кнопку <b>PDF</b> в таблице ревизий.
                </Typography.Text>
                {selectedRevision && (
                  <div style={{ marginTop: 12 }}>
                    <Typography.Text type="secondary">Workflow ревизии:</Typography.Text>
                    <Steps
                      size="small"
                      current={
                        selectedRevision.status === "REVISION_CREATED"
                          ? 0
                          : selectedRevision.status === "UPLOADED_WAITING_TDO"
                            ? 1
                            : selectedRevision.status === "UNDER_REVIEW"
                              ? 2
                              : selectedRevision.status === "CANCELLED_BY_TDO"
                                ? 1
                                : 3
                      }
                      items={[
                        { title: "Создана ревизия" },
                        { title: "Загружена / решение ТДО" },
                        { title: "На рассмотрении заказчика" },
                        { title: "Завершено" },
                      ]}
                    />
                    {selectedRevision.review_code && (
                      <Alert
                        style={{ marginTop: 10 }}
                        type="info"
                        message={`Review Code: ${selectedRevision.review_code}`}
                        description={reviewCodeHelp[selectedRevision.review_code] ?? "—"}
                      />
                    )}
                  </div>
                )}
              </>
            ) : (
              <Typography.Text type="secondary">Выбери документ из списка слева.</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card title={`Ревизии (документ: ${selectedDocument?.document_num ?? "—"})`}>
            <Table
              rowKey="id"
              size="small"
              columns={revisionColumns}
              dataSource={revisions}
              pagination={false}
              scroll={{ x: 980 }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title={`Комментарии (ревизия: ${selectedRevisionId ?? "—"})`}>
            <Table
              rowKey="id"
              size="small"
              columns={commentColumns}
              dataSource={comments}
              pagination={false}
              scroll={{ x: "max-content", y: 260 }}
            />
          </Card>
        </Col>
      </Row>

      <Modal open={revModalOpen} onCancel={() => setRevModalOpen(false)} onOk={submitNewRevision} title="Создать ревизию">
        <Form form={revForm} layout="vertical">
          <Form.Item name="revision_code" label="Код ревизии" rules={[{ required: true }]}>
            <Input placeholder="A / 00" readOnly />
          </Form.Item>
          <Form.Item name="issue_purpose" label="Цель выпуска" rules={[{ required: true }]}>
            <Select
              options={issuePurposeOptions.map((value) => ({ value, label: value }))}
              onChange={(value) => {
                applyAutoRevision(value);
              }}
            />
          </Form.Item>
          <Form.Item name="author_id" label="Автор ревизии" initialValue={currentUser.id} rules={[{ required: true }]}>
            <Select
              options={projectMembers
                .map((member) => ({
                  value: member.user_id,
                  label: `${member.user_full_name ?? "Пользователь"} (${member.user_email ?? "—"})`,
                }))}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Статус и номер TRM назначаются автоматически. PDF прикрепляется после создания ревизии кнопкой <b>PDF</b>.
          </Typography.Paragraph>
        </Form>
      </Modal>

      <RevisionPdfAnnotator
        revisionId={selectedRevisionId}
        open={pdfAnnotatorOpen}
        onClose={() => setPdfAnnotatorOpen(false)}
        onCreated={async () => {
          if (selectedRevisionId) {
            const items = await listComments(selectedRevisionId);
            setComments(items);
          }
        }}
      />

      <Modal open={responseModalOpen} onCancel={() => setResponseModalOpen(false)} onOk={submitResponse} title="Ответ на комментарий">
        <Form form={responseForm} layout="vertical" initialValues={{ status: "IN_PROGRESS" }}>
          {selectedRevisionId ? (
            <Space direction="vertical" style={{ width: "100%", marginBottom: 12 }} size={8}>
              <Typography.Text type="secondary">
                Контекст замечания на PDF (страница {responsePageNumber}).
              </Typography.Text>
              <Space>
                <Button
                  onClick={() => setResponsePageNumber((page) => Math.max(1, page - 1))}
                  disabled={responsePageNumber <= 1}
                >
                  Предыдущая
                </Button>
                <Button
                  onClick={() => setResponsePageNumber((page) => Math.min(responsePdfPages, page + 1))}
                  disabled={responsePageNumber >= responsePdfPages}
                >
                  Следующая
                </Button>
                <Typography.Text>
                  Страница {responsePageNumber}/{responsePdfPages}
                </Typography.Text>
              </Space>
              <div style={{ border: "1px solid #d9e2f1", borderRadius: 8, padding: 8, maxHeight: 360, overflow: "auto" }}>
                <div style={{ position: "relative", width: "fit-content", margin: "0 auto" }}>
                  <Document
                    file={responsePdfUrl}
                    options={responsePdfOptions}
                    onLoadSuccess={({ numPages }) => {
                      setResponsePdfError(null);
                      setResponsePdfPages(numPages);
                    }}
                    onLoadError={(error) => {
                      setResponsePdfError(error instanceof Error ? error.message : "Failed to load PDF");
                    }}
                  >
                    <Page pageNumber={responsePageNumber} width={780} />
                  </Document>
                  {selectedCommentForResponse &&
                    selectedCommentForResponse.page === responsePageNumber &&
                    selectedCommentForResponse.area_x !== null &&
                    selectedCommentForResponse.area_y !== null &&
                    selectedCommentForResponse.area_w !== null &&
                    selectedCommentForResponse.area_h !== null && (
                      <div
                        style={{
                          position: "absolute",
                          left: selectedCommentForResponse.area_x,
                          top: selectedCommentForResponse.area_y,
                          width: selectedCommentForResponse.area_w,
                          height: selectedCommentForResponse.area_h,
                          border: "2px solid #f97316",
                          background: "rgba(249,115,22,0.15)",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                </div>
              </div>
              {responsePdfError && <Alert type="error" message={`Не удалось загрузить PDF: ${responsePdfError}`} />}
            </Space>
          ) : (
            <Alert type="warning" message="Выбери ревизию, чтобы увидеть область комментария на PDF." style={{ marginBottom: 12 }} />
          )}
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
          <Form.Item name="backlog_status" label="Бэклог (для отработанных замечаний)">
            <Select
              allowClear
              options={[
                { value: "IN_NEXT_REVISION", label: "Будет в новой ревизии" },
                { value: "REJECTED", label: "Отклонено" },
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

      <Modal
        open={tdoCancelOpen}
        onCancel={() => setTdoCancelOpen(false)}
        onOk={async () => {
          if (!tdoTargetRevision) return;
          const values = await tdoCancelForm.validateFields();
          await processRevisionTdoDecision(tdoTargetRevision.id, {
            action: "CANCELLED",
            note: values.note,
          });
          message.success("Ревизия отклонена руководителем ТДО");
          setTdoCancelOpen(false);
          setTdoTargetRevision(null);
          if (selectedDocumentId) {
            setRevisions(await listRevisions(selectedDocumentId));
          }
        }}
        title={`Отклонить ревизию ${tdoTargetRevision?.revision_code ?? ""}`}
      >
        <Form form={tdoCancelForm} layout="vertical">
          <Form.Item name="note" label="Сообщение разработчику" rules={[{ required: true, message: "Укажи причину" }]}>
            <Input.TextArea rows={3} placeholder="Причина отмены загрузки" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
