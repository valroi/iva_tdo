import { Button, Card, Col, Form, Input, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import {
  issueAcrs,
  issueCrs,
  listCrsItems,
  listRevisions,
  setCrsReviewCode,
} from "../api";
import type { CommentItem, DocumentItem, Revision, User } from "../types";

interface Props {
  documents: DocumentItem[];
  currentUser: User;
  onReloadAll: () => Promise<void>;
}

export default function ReviewCenterPage({ documents, currentUser, onReloadAll }: Props): JSX.Element {
  const canIssueCrs = currentUser.role === "admin" || currentUser.role === "owner_manager" || currentUser.role === "owner_reviewer";
  const canIssueAcrs =
    currentUser.role === "admin" || currentUser.role === "contractor_manager" || currentUser.role === "contractor_author";
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(documents[0]?.id ?? null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [crs, setCrs] = useState<CommentItem[]>([]);

  const [crsForm] = Form.useForm();
  const [acrsForm] = Form.useForm();
  const [codeForm] = Form.useForm();

  const loadRevisions = async (documentId: number | null): Promise<void> => {
    if (!documentId) {
      setRevisions([]);
      setSelectedRevisionId(null);
      setCrs([]);
      return;
    }
    const rows = await listRevisions(documentId);
    setRevisions(rows);
    const first = rows[0]?.id ?? null;
    setSelectedRevisionId(first);
    if (first) {
      setCrs(await listCrsItems(first));
    } else {
      setCrs([]);
    }
  };

  const loadCrs = async (revisionId: number | null): Promise<void> => {
    if (!revisionId) {
      setCrs([]);
      return;
    }
    setCrs(await listCrsItems(revisionId));
  };

  useEffect(() => {
    void loadRevisions(selectedDocumentId).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : "Ошибка загрузки ревизий");
    });
  }, [selectedDocumentId]);

  useEffect(() => {
    void loadCrs(selectedRevisionId).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : "Ошибка загрузки CRS");
    });
  }, [selectedRevisionId]);

  const columns: ColumnsType<CommentItem> = [
    { title: "ID", dataIndex: "id", key: "id", width: 80 },
    { title: "Комментарий", dataIndex: "text", key: "text" },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      width: 140,
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
    { title: "Лист", dataIndex: "page", key: "page", width: 80, render: (v: number | null) => v ?? "—" },
  ];

  const submitCrs = async (): Promise<void> => {
    if (!selectedRevisionId) {
      message.warning("Выберите ревизию");
      return;
    }
    const values = await crsForm.validateFields();
    await issueCrs({ ...values, revision_id: selectedRevisionId });
    crsForm.resetFields();
    await loadCrs(selectedRevisionId);
    await onReloadAll();
    message.success("CRS добавлен");
  };

  const submitReviewCode = async (): Promise<void> => {
    const values = await codeForm.validateFields();
    await setCrsReviewCode(values.comment_id, {
      review_code: values.review_code,
      status: values.status,
    });
    codeForm.resetFields();
    await loadCrs(selectedRevisionId);
    await onReloadAll();
    message.success("Код рассмотрения обновлен");
  };

  const submitAcrs = async (): Promise<void> => {
    const values = await acrsForm.validateFields();
    await issueAcrs(values.comment_id, {
      revision_id: selectedRevisionId ?? 0,
      text: values.text,
      status: values.status,
    });
    acrsForm.resetFields();
    await loadCrs(selectedRevisionId);
    await onReloadAll();
    message.success("ACRS отправлен");
  };

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        Review Center (CRS / ACRS)
      </Typography.Title>

      <Card>
        <Space wrap>
          <Select
            style={{ minWidth: 320 }}
            placeholder="Документ"
            value={selectedDocumentId ?? undefined}
            onChange={(value) => setSelectedDocumentId(value)}
            options={documents.map((doc) => ({
              value: doc.id,
              label: `${doc.document_num} — ${doc.title}`,
            }))}
          />
          <Select
            style={{ minWidth: 220 }}
            placeholder="Ревизия"
            value={selectedRevisionId ?? undefined}
            onChange={(value) => setSelectedRevisionId(value)}
            options={revisions.map((rev) => ({
              value: rev.id,
              label: `${rev.revision_code} (${rev.issue_purpose})`,
            }))}
          />
        </Space>
      </Card>

      <Row gutter={12}>
        <Col span={12}>
          <Card title="CRS список">
            <Table rowKey="id" size="small" dataSource={crs} columns={columns} pagination={{ pageSize: 8 }} />
          </Card>
        </Col>
        <Col span={12}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Card title="Выдать CRS">
              <Form form={crsForm} layout="vertical">
                <Form.Item name="text" label="Комментарий" rules={[{ required: true }]}>
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item name="page" label="Лист">
                  <Input type="number" />
                </Form.Item>
                <Button type="primary" onClick={() => void submitCrs()} disabled={!canIssueCrs}>
                  Добавить CRS
                </Button>
              </Form>
            </Card>

            <Card title="Присвоить review code">
              <Form form={codeForm} layout="vertical">
                <Form.Item name="comment_id" label="ID комментария" rules={[{ required: true }]}>
                  <Input type="number" />
                </Form.Item>
                <Form.Item name="review_code" label="Review code" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: "AP", label: "AP" },
                      { value: "AN", label: "AN" },
                      { value: "CO", label: "CO" },
                      { value: "RJ", label: "RJ" },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="status" label="Статус комментария" initialValue="OPEN">
                  <Select
                    options={[
                      { value: "OPEN", label: "OPEN" },
                      { value: "IN_PROGRESS", label: "IN_PROGRESS" },
                      { value: "RESOLVED", label: "RESOLVED" },
                      { value: "REJECTED", label: "REJECTED" },
                    ]}
                  />
                </Form.Item>
                <Button onClick={() => void submitReviewCode()} disabled={!canIssueCrs}>
                  Обновить review code
                </Button>
              </Form>
            </Card>

            <Card title="Выдать ACRS (ответ на CRS)">
              <Form form={acrsForm} layout="vertical">
                <Form.Item name="comment_id" label="ID CRS комментария" rules={[{ required: true }]}>
                  <Input type="number" />
                </Form.Item>
                <Form.Item name="text" label="Ответ" rules={[{ required: true }]}>
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item name="status" label="Статус" initialValue="IN_PROGRESS">
                  <Select
                    options={[
                      { value: "IN_PROGRESS", label: "IN_PROGRESS" },
                      { value: "RESOLVED", label: "RESOLVED" },
                      { value: "REJECTED", label: "REJECTED" },
                    ]}
                  />
                </Form.Item>
                <Button onClick={() => void submitAcrs()} disabled={!canIssueAcrs}>
                  Отправить ACRS
                </Button>
              </Form>
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
