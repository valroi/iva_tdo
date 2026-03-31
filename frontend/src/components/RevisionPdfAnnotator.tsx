import { Alert, Button, Form, Input, Modal, Select, Space, Typography, message } from "antd";
import { useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { createComment, getAuthHeaders, getRevisionPdfUrl } from "../api";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface Props {
  revisionId: number | null;
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function RevisionPdfAnnotator({ revisionId, open, onClose, onCreated }: Props): JSX.Element {
  const [numPages, setNumPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form] = Form.useForm();
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const fileUrl = useMemo(() => (revisionId ? getRevisionPdfUrl(revisionId) : null), [revisionId]);
  const documentOptions = useMemo(() => ({ httpHeaders: getAuthHeaders() }), [open]);

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (event) => {
    const box = overlayRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    setDragStart({ x, y });
    setSelection({ x, y, w: 0, h: 0 });
  };

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!dragStart) return;
    const box = overlayRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    setSelection({
      x: Math.min(dragStart.x, x),
      y: Math.min(dragStart.y, y),
      w: Math.abs(x - dragStart.x),
      h: Math.abs(y - dragStart.y),
    });
  };

  const onMouseUp: React.MouseEventHandler<HTMLDivElement> = () => {
    setDragStart(null);
  };

  const submit = async () => {
    if (!revisionId) return;
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const prefix = values.kind === "question" ? "[QUESTION]" : "[REMARK]";
      await createComment({
        revision_id: revisionId,
        text: `${prefix} ${values.text}`.trim(),
        status: "OPEN",
        page: pageNumber,
        area_x: selection?.x ?? null,
        area_y: selection?.y ?? null,
        area_w: selection?.w ?? null,
        area_h: selection?.h ?? null,
      });
      message.success("Комментарий добавлен");
      form.resetFields();
      setSelection(null);
      await onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Просмотр PDF и аннотация"
      open={open}
      width={980}
      onCancel={onClose}
      onOk={submit}
      okButtonProps={{ loading: submitting }}
      okText="Сохранить комментарий"
    >
      {!revisionId ? (
        <Alert type="warning" message="Выбери ревизию для просмотра PDF" />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Typography.Text type="secondary">
            Выдели область мышкой (опционально), затем добавь вопрос или замечание.
          </Typography.Text>
          <Space>
            <Button onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={pageNumber <= 1}>
              Предыдущая страница
            </Button>
            <Button onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages}>
              Следующая страница
            </Button>
            <Typography.Text>
              Страница {pageNumber}/{numPages}
            </Typography.Text>
            <Button onClick={() => setSelection(null)}>Сбросить выделение</Button>
          </Space>
          <div style={{ border: "1px solid #d9e2f1", borderRadius: 8, padding: 8, maxHeight: 520, overflow: "auto" }}>
            <div
              ref={overlayRef}
              style={{ position: "relative", width: "fit-content", margin: "0 auto", cursor: "crosshair" }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            >
              <Document
                file={fileUrl}
                options={documentOptions}
                onLoadSuccess={({ numPages: totalPages }) => {
                  setLoadError(null);
                  setNumPages(totalPages);
                }}
                onLoadError={(error) => {
                  setLoadError(error instanceof Error ? error.message : "Failed to load PDF");
                }}
              >
                <Page pageNumber={pageNumber} width={780} />
              </Document>
              {selection && (
                <div
                  style={{
                    position: "absolute",
                    left: selection.x,
                    top: selection.y,
                    width: selection.w,
                    height: selection.h,
                    border: "2px solid #2563eb",
                    background: "rgba(37,99,235,0.12)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          </div>
          {loadError && <Alert type="error" message={`Не удалось загрузить PDF: ${loadError}`} />}
          <Form form={form} layout="vertical" initialValues={{ kind: "remark" }}>
            <Form.Item name="kind" label="Тип сообщения" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "question", label: "Вопрос" },
                  { value: "remark", label: "Замечание" },
                ]}
              />
            </Form.Item>
            <Form.Item name="text" label="Текст" rules={[{ required: true }]}>
              <Input.TextArea rows={3} placeholder="Опиши вопрос или замечание..." />
            </Form.Item>
          </Form>
        </Space>
      )}
    </Modal>
  );
}
