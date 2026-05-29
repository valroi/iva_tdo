import { Alert, Button, Form, Input, Modal, Select, Space, Tabs, Tag, Tooltip, Typography, App } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { addCommentToCrs, createComment, getAuthHeaders, getRevisionPdfUrl, ownerCommentDecision, respondToComment } from "../api";
import type { CommentItem } from "../types";

const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
pdfjs.GlobalWorkerOptions.workerSrc = `${workerSrc}?v=${pdfjs.version}`;

interface Props {
  revisionId: number | null;
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  mode?: "owner_create" | "contractor_review";
  comments?: CommentItem[];
  canCreateOwnerRemarks?: boolean;
  canCreateRemarks?: boolean;
  noAccessHint?: string;
  focusCommentId?: number | null;
  canManageOwnerRemarks?: boolean;
  carryOverRemarks?: CarryRemark[];
  carryClosedIds?: number[];
  carryDecidedIds?: number[];
  onCarryOpen?: (item: CarryRemark) => Promise<void>;
  onCarryClose?: (id: number) => void;
  onCarryReopen?: (id: number) => void;
  carryActionMode?: "final" | "recommendation";
  /** Latest R recommendation per source remark id (from carry-over decisions). */
  carryRHints?: Partial<Record<number, "R_OPEN" | "R_CLOSED">>;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PendingRemark {
  id: string;
  page: number;
  selection: Rect | null;
  review_code: string;
  text: string;
}
interface CarryRemark {
  id: number;
  text: string;
  review_code?: string | null;
  page?: number | null;
  area_x?: number | null;
  area_y?: number | null;
  area_w?: number | null;
  area_h?: number | null;
}

export default function RevisionPdfAnnotator({
  revisionId,
  open,
  onClose,
  onCreated,
  mode = "owner_create",
  comments = [],
  canCreateOwnerRemarks = true,
  canCreateRemarks = true,
  noAccessHint,
  focusCommentId = null,
  canManageOwnerRemarks = false,
  carryOverRemarks = [],
  carryClosedIds = [],
  carryDecidedIds = [],
  onCarryOpen,
  onCarryClose,
  onCarryReopen,
  carryActionMode = "final",
  carryRHints = {},
}: Props): JSX.Element {
  const { message } = App.useApp();
  const canCreateInOwnerMode = canCreateRemarks && canCreateOwnerRemarks;
  const [numPages, setNumPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [pendingRemarks, setPendingRemarks] = useState<PendingRemark[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<number | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<number | null>(null);
  const [contractorResponseOpen, setContractorResponseOpen] = useState(false);
  const [contractorResponseStatus, setContractorResponseStatus] = useState<"I" | "A">("I");
  const [contractorResponseText, setContractorResponseText] = useState("");
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // Контейнер с PDF (с overflow:auto) — к нему делаем scroll при переходе
  // к замечанию, чтобы область выделения сразу попала в видимую часть.
  const pdfScrollRef = useRef<HTMLDivElement | null>(null);

  // Polling замечаний пока модалка открыта: даже если параллельно
  // работает другая роль (LR добавил замечание, R должен увидеть в
  // реальном времени), новые комменты подтянутся через onCreated→
  // loadCard у родителя без необходимости закрывать/открывать модалку.
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void onCreated();
    };
    const id = window.setInterval(tick, 8_000);
    return () => window.clearInterval(id);
  }, [open, onCreated]);

  const fileUrl = useMemo(() => (revisionId ? getRevisionPdfUrl(revisionId) : null), [revisionId]);
  const documentOptions = useMemo(() => ({ httpHeaders: getAuthHeaders() }), [open]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const loadPdf = async () => {
      if (!open || !fileUrl) {
        setPdfBlobUrl(null);
        return;
      }
      try {
        setLoadError(null);
        const response = await fetch(fileUrl, { headers: getAuthHeaders() });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setPdfBlobUrl(objectUrl);
        }
      } catch (error) {
        if (!cancelled) {
          setPdfBlobUrl(null);
          setLoadError(error instanceof Error ? error.message : "Failed to fetch PDF");
        }
      }
    };
    void loadPdf();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileUrl, open]);

  useEffect(() => {
    if (open) {
      setPendingRemarks([]);
      form.resetFields();
      form.setFieldsValue({});
    }
  }, [open, form]);

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

  const normalizeRemarkText = (value: string | null | undefined): string =>
    String(value ?? "")
      .replace(/^\[(REMARK|QUESTION)\]\s*/i, "")
      .trim()
      .toLowerCase();

  const hasDuplicateRemark = (item: PendingRemark): boolean => {
    const normalized = normalizeRemarkText(item.text);
    const duplicateInPending = pendingRemarks.some(
      (pending) =>
        normalizeRemarkText(pending.text) === normalized &&
        pending.review_code === item.review_code &&
        pending.page === item.page,
    );
    if (duplicateInPending) return true;
    return comments.some(
      (existing) =>
        existing.parent_id === null &&
        normalizeRemarkText(existing.text) === normalized &&
        (existing.review_code ?? null) === item.review_code &&
        (existing.page ?? null) === item.page,
    );
  };

  const pushPendingFromForm = async (): Promise<PendingRemark | null> => {
    const values = await form.validateFields();
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      page: pageNumber,
      selection: selection ? { ...selection } : null,
      review_code: values.review_code as string,
      text: (values.text as string).trim(),
    };
  };

  const addToPendingList = async (): Promise<void> => {
    if (mode !== "owner_create" || !revisionId) return;
    try {
      const next = await pushPendingFromForm();
      if (!next) return;
      if (hasDuplicateRemark(next)) {
        message.warning("Такое замечание уже существует для этой ревизии");
        return;
      }
      setPendingRemarks((prev) => [...prev, next]);
      form.setFieldsValue({ text: "" });
      setSelection(null);
      message.success("Добавлено в список");
    } catch {
      // validation failed
    }
  };

  const removePending = (id: string): void => {
    setPendingRemarks((prev) => prev.filter((item) => item.id !== id));
  };

  const postOneRemark = async (item: PendingRemark): Promise<void> => {
    if (!revisionId) return;
    await createComment({
      revision_id: revisionId,
      text: `[REMARK] ${item.text}`.trim(),
      status: "OPEN",
      review_code: item.review_code,
      page: item.page,
      area_x: item.selection?.x ?? null,
      area_y: item.selection?.y ?? null,
      area_w: item.selection?.w ?? null,
      area_h: item.selection?.h ?? null,
    });
  };

  const submitAll = async () => {
    if (mode !== "owner_create") {
      onClose();
      return;
    }
    if (!revisionId) return;
    setSubmitting(true);
    try {
      const toSend: PendingRemark[] = [...pendingRemarks];
      if (toSend.length === 0) {
        message.warning("Сначала добавь замечание в список кнопкой «Добавить во временный список»");
        return;
      }
      for (const item of toSend) {
        await postOneRemark(item);
      }
      message.success(toSend.length === 1 ? "Комментарий добавлен" : `Добавлено замечаний: ${toSend.length}`);
      setPendingRemarks([]);
      form.resetFields();
      form.setFieldsValue({});
      setSelection(null);
      await onCreated();
      onClose();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось сохранить";
      message.error(text);
    } finally {
      setSubmitting(false);
    }
  };

  const jumpToComment = (item: CommentItem): void => {
    setActiveCommentId(item.id);
    setPageNumber(Math.min(Math.max(1, item.page ?? 1), Math.max(1, numPages)));
    const hasArea =
      item.area_x !== null &&
      item.area_y !== null &&
      item.area_w !== null &&
      item.area_h !== null;
    if (hasArea) {
      setSelection({ x: item.area_x!, y: item.area_y!, w: item.area_w!, h: item.area_h! });
    } else {
      setSelection(null);
    }
    // Auto-scroll к области замечания. Координаты area_x/area_y хранятся
    // в пикселях относительно overlay-страницы (см. как они рисуются
    // ниже в JSX). Задержка нужна, чтобы Page успел отрендериться
    // после смены номера страницы.
    if (hasArea) {
      const ay = item.area_y ?? 0;
      const tryScroll = () => {
        const scroller = pdfScrollRef.current;
        if (!scroller) return false;
        // Сдвигаем верхний край замечания на 1/4 высоты вьюпорта от
        // верха — замечание оказывается в верхней трети, контекст
        // сверху виден.
        const targetTop = Math.max(0, ay - scroller.clientHeight / 4);
        scroller.scrollTo({ top: targetTop, behavior: "smooth" });
        return true;
      };
      // Несколько попыток на случай, если страница рендерится дольше.
      setTimeout(tryScroll, 200);
      setTimeout(tryScroll, 600);
    }
  };

  useEffect(() => {
    if (!open || !focusCommentId) return;
    const target = comments.find((item) => item.id === focusCommentId);
    if (target) {
      jumpToComment(target);
    }
  }, [open, focusCommentId, comments]);

  const commentMarkersOnPage = useMemo(
    () =>
      comments.filter(
        (item) =>
          item.parent_id === null &&
          item.page === pageNumber &&
          item.area_x !== null &&
          item.area_y !== null &&
          item.area_w !== null &&
          item.area_h !== null,
      ),
    [comments, pageNumber],
  );

  const contractorSetStatus = async (status: "I" | "A", text?: string): Promise<void> => {
    if (!activeCommentId) {
      message.warning("Сначала выбери замечание из списка");
      return;
    }
    const active = comments.find((item) => item.id === activeCommentId) ?? null;
    if (!active) {
      message.warning("Замечание не найдено");
      return;
    }
    const canSetI = active.contractor_status === null;
    const canSetA = active.contractor_status === null || (active.contractor_status === "I" && active.backlog_status === "LR_FINAL_CONFIRM");
    if ((status === "I" && !canSetI) || (status === "A" && !canSetA)) {
      message.warning("Для этого замечания доступен только финальный ответ A");
      return;
    }
    await respondToComment(activeCommentId, {
      text: (text ?? "").trim() || (status === "I" ? "[CONTRACTOR] Требуется обсуждение" : "[CONTRACTOR] Принято"),
      status: status === "I" ? "IN_PROGRESS" : "RESOLVED",
      contractor_status: status,
    });
    message.success(`Статус подрядчика установлен: ${status}`);
    await onCreated();
  };
  const contractorPendingParentComments = useMemo(
    () =>
      comments.filter(
        (item) =>
          item.parent_id === null &&
          (item.contractor_status === null || (item.contractor_status === "I" && item.backlog_status === "LR_FINAL_CONFIRM")),
      ),
    [comments],
  );
  const carryOpenRemarks = useMemo(
    () => carryOverRemarks.filter((item) => !carryClosedIds.includes(item.id)),
    [carryOverRemarks, carryClosedIds],
  );
  const carryDoneRemarks = useMemo(
    () => carryOverRemarks.filter((item) => carryClosedIds.includes(item.id)),
    [carryOverRemarks, carryClosedIds],
  );

  return (
    <>
    <Modal
      title="Просмотр PDF и аннотация"
      open={open}
      width={980}
      onCancel={onClose}
      footer={
        mode === "owner_create" && canCreateInOwnerMode ? (
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={onClose}>Отмена</Button>
            <Button onClick={() => void addToPendingList()} disabled={!revisionId}>
              Добавить во временный список
            </Button>
            <Button type="primary" loading={submitting} onClick={() => void submitAll()} disabled={!revisionId}>
              {pendingRemarks.length > 0 ? `Сохранить и закрыть (${pendingRemarks.length})` : "Сохранить и закрыть"}
            </Button>
          </Space>
        ) : mode === "owner_create" ? (
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={onClose}>Закрыть</Button>
          </Space>
        ) : (
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={onClose}>Закрыть</Button>
          </Space>
        )
      }
    >
      {!revisionId ? (
        <Alert type="warning" message="Выбери ревизию для просмотра PDF" />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          {mode === "owner_create" && !canCreateInOwnerMode && (
            <Alert type="warning" showIcon message={noAccessHint ?? "Нет прав на создание замечаний"} />
          )}
          <Typography.Text type="secondary">
            {mode === "owner_create"
              ? "Выдели область (по желанию), заполни поля и нажми «Добавить во временный список». Когда список готов, нажми «Сохранить и закрыть»."
              : "Выбери замечание из списка ниже, чтобы перейти к области в PDF."}
          </Typography.Text>
          {comments.filter((item) => item.parent_id === null).length > 0 && (
            <Space direction="vertical" style={{ width: "100%" }} size={6}>
              <Typography.Text strong>Навигация по замечаниям</Typography.Text>
              {/* Группировка: активные замечания и отклонённые отдельно.
                  Активные — то, чем сейчас занимаются. Отклонённые —
                  для справки, не засоряют основной список. */}
              {(() => {
                const allParents = comments.filter((item) => item.parent_id === null);
                const activeOnes = allParents.filter((item) => item.status !== "REJECTED");
                const rejectedOnes = allParents.filter((item) => item.status === "REJECTED");
                const renderItem = (item: CommentItem): JSX.Element => (
                    <Tooltip
                      key={item.id}
                      title={(item.text ?? "").replace(/^\[(REMARK|QUESTION)\]\s*/i, "")}
                      placement="topLeft"
                      mouseEnterDelay={0.3}
                    >
                      <Button
                        size="small"
                        type={activeCommentId === item.id ? "primary" : "default"}
                        style={{ width: "100%", textAlign: "left", justifyContent: "flex-start", padding: "2px 8px" }}
                        onMouseEnter={() => setHoveredCommentId(item.id)}
                        onMouseLeave={() => setHoveredCommentId((prev) => (prev === item.id ? null : prev))}
                        onClick={() => jumpToComment(item)}
                      >
                        <Space size={6} wrap={false} style={{ width: "100%", overflow: "hidden" }}>
                          <Tag
                            color={
                              item.review_code === "AP" ? "green" :
                              item.review_code === "AN" ? "blue" :
                              item.review_code === "CO" ? "orange" :
                              item.review_code === "RJ" ? "red" : "default"
                            }
                            style={{ margin: 0, minWidth: 28, textAlign: "center", fontWeight: 600 }}
                          >
                            {item.review_code ?? "—"}
                          </Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                            стр. {item.page ?? "—"}
                          </Typography.Text>
                          <Tag
                            color={item.status === "REJECTED" ? "red" : item.status === "RESOLVED" ? "green" : "default"}
                            style={{ margin: 0, fontSize: 10, padding: "0 6px" }}
                          >
                            {item.status === "REJECTED" ? "Откл." : item.status === "RESOLVED" ? "Учт." : "В раб."}
                          </Tag>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {(item.text ?? "").replace(/^\[(REMARK|QUESTION)\]\s*/i, "")}
                          </span>
                        </Space>
                      </Button>
                    </Tooltip>
                );
                return (
                  <Tabs
                    size="small"
                    defaultActiveKey="active"
                    items={[
                      {
                        key: "active",
                        label: `Активные (${activeOnes.length})`,
                        children: (
                          <Space direction="vertical" style={{ width: "100%" }} size={6}>
                            {activeOnes.length === 0 ? (
                              <Typography.Text type="secondary">Активных замечаний нет.</Typography.Text>
                            ) : (
                              activeOnes.map(renderItem)
                            )}
                          </Space>
                        ),
                      },
                      {
                        key: "rejected",
                        label: `Отклонённые (${rejectedOnes.length})`,
                        children: (
                          <Space direction="vertical" style={{ width: "100%" }} size={6}>
                            {rejectedOnes.length === 0 ? (
                              <Typography.Text type="secondary">Нет отклонённых замечаний.</Typography.Text>
                            ) : (
                              rejectedOnes.map(renderItem)
                            )}
                          </Space>
                        ),
                      },
                    ]}
                  />
                );
              })()}
            </Space>
          )}
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
            {/* «Сбросить выделение» нужно только при создании замечаний
                заказчиком (он рисует прямоугольники на PDF). Подрядчику
                на этапе просмотра/ответа — нет, у него нет выделений. */}
            {mode === "owner_create" && <Button onClick={() => setSelection(null)}>Сбросить выделение</Button>}
          </Space>
          <div ref={pdfScrollRef} style={{ border: "1px solid #d9e2f1", borderRadius: 8, padding: 8, maxHeight: 520, overflow: "auto" }}>
            <div
              ref={overlayRef}
              style={{ position: "relative", width: "fit-content", margin: "0 auto", cursor: "crosshair" }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            >
              <Document
                file={pdfBlobUrl ?? fileUrl}
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
              {commentMarkersOnPage.map((item) => {
                const isActive = activeCommentId === item.id;
                const isHovered = hoveredCommentId === item.id;
                return (
                  <div
                    key={`marker_${item.id}`}
                    title={`${item.review_code ?? "—"} · ${item.author_name ?? item.author_email ?? "—"}`}
                    style={{
                      position: "absolute",
                      left: item.area_x ?? 0,
                      top: item.area_y ?? 0,
                      width: item.area_w ?? 0,
                      height: item.area_h ?? 0,
                      border: isActive ? "2px solid #2563eb" : "2px solid #f59e0b",
                      background: isActive
                        ? "rgba(37,99,235,0.14)"
                        : isHovered
                          ? "rgba(245,158,11,0.24)"
                          : "rgba(245,158,11,0.12)",
                      pointerEvents: "auto",
                      cursor: "pointer",
                    }}
                    onMouseEnter={() => setHoveredCommentId(item.id)}
                    onMouseLeave={() => setHoveredCommentId((prev) => (prev === item.id ? null : prev))}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      jumpToComment(item);
                    }}
                  />
                );
              })}
            </div>
          </div>
          {loadError && <Alert type="error" message={`Не удалось загрузить PDF: ${loadError}`} />}
          {mode === "owner_create" ? (
            <>
              {canManageOwnerRemarks && activeCommentId && (
                <Space style={{ width: "100%", justifyContent: "flex-end" }}>
                  {(() => {
                    const active = comments.find((item) => item.id === activeCommentId && item.parent_id === null) ?? null;
                    if (!active) return null;
                    return (
                      <>
                        {!active.is_published_to_contractor &&
                          !active.in_crs &&
                          active.contractor_status === null &&
                          active.status !== "REJECTED" && (
                          <Button
                            size="small"
                            onClick={async () => {
                              await addCommentToCrs(active.id);
                              message.success("Замечание добавлено в CRS");
                              await onCreated();
                            }}
                          >
                            Добавить в CRS
                          </Button>
                        )}
                        {!active.is_published_to_contractor &&
                          !active.in_crs &&
                          active.contractor_status === null &&
                          active.status !== "REJECTED" && (
                          <Button
                            size="small"
                            danger
                            onClick={async () => {
                              await ownerCommentDecision(active.id, { action: "REJECT", note: "Снято LR" });
                              message.success("Замечание отклонено LR");
                              await onCreated();
                            }}
                          >
                            Отклонить замечание
                          </Button>
                        )}
                        {active.contractor_status === "I" && active.backlog_status !== "LR_FINAL_CONFIRM" && (
                          <Button
                            size="small"
                            onClick={async () => {
                              await ownerCommentDecision(active.id, { action: "FINAL_CONFIRM" });
                              message.success("LR финально подтвердил замечание, подрядчику доступен только статус A");
                              await onCreated();
                            }}
                          >
                            Финально подтвердить (LR)
                          </Button>
                        )}
                      </>
                    );
                  })()}
                </Space>
              )}
              {canCreateInOwnerMode && pendingRemarks.length > 0 && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={`В списке: ${pendingRemarks.length}`}
                  description={
                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                      {pendingRemarks.map((item) => (
                        <Space key={item.id} wrap style={{ width: "100%", justifyContent: "space-between" }}>
                          <Typography.Text ellipsis style={{ maxWidth: 640 }}>
                            стр. {item.page} · {item.review_code} · Замечание · {item.text}
                          </Typography.Text>
                          <Button size="small" danger type="link" onClick={() => removePending(item.id)}>
                            Убрать
                          </Button>
                        </Space>
                      ))}
                    </Space>
                  }
                />
              )}
              {canCreateInOwnerMode && (
                <Form form={form} layout="vertical">
                  <Form.Item name="review_code" label="Статус замечания (RJ/CO/AN)" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: "RJ", label: "RJ - Ревизия не засчитывается" },
                        { value: "CO", label: "CO - Существенные замечания" },
                        { value: "AN", label: "AN - Незначительные замечания" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="text" label="Текст" rules={[{ required: true }]}>
                    <Input.TextArea rows={3} placeholder="Опиши замечание..." />
                  </Form.Item>
                </Form>
              )}
              {canManageOwnerRemarks && carryOverRemarks.length > 0 && (
                <Tabs
                  items={[
                    {
                      key: "carry_open",
                      label: `Должны были устранить (${carryOpenRemarks.length})`,
                      children: (
                        <Space direction="vertical" style={{ width: "100%" }} size={8}>
                          {carryOpenRemarks.map((item) => (
                            <Space key={item.id} wrap style={{ width: "100%", justifyContent: "space-between" }}>
                              <Space direction="vertical" size={2} style={{ maxWidth: 640 }}>
                                <Typography.Text style={{ maxWidth: 640 }}>
                                  {item.review_code ?? "—"} · стр. {item.page ?? "—"} ·{" "}
                                  {(item.text ?? "").replace(/^\[(REMARK|QUESTION)\]\s*/i, "")}
                                </Typography.Text>
                                {carryRHints[item.id] === "R_CLOSED" ? (
                                  <Tag color="green">Автор считает устранено</Tag>
                                ) : carryRHints[item.id] === "R_OPEN" ? (
                                  <Tag color="red">Автор считает не устранено</Tag>
                                ) : null}
                              </Space>
                              <Space>
                                <Button
                                  size="small"
                                  disabled={carryDecidedIds.includes(item.id)}
                                  onClick={async () => {
                                    if (!revisionId) return;
                                    if (onCarryOpen) {
                                      await onCarryOpen(item);
                                      return;
                                    }
                                    const exists = comments.some(
                                      (c) =>
                                        c.parent_id === null &&
                                        c.text === item.text &&
                                        (c.review_code ?? null) === (item.review_code ?? null),
                                    );
                                    if (exists) {
                                      message.info("Такое замечание уже есть в текущей ревизии");
                                      return;
                                    }
                                    await createComment({
                                      revision_id: revisionId,
                                      text: item.text,
                                      status: "OPEN",
                                      review_code: item.review_code ?? null,
                                      page: item.page ?? null,
                                      area_x: item.area_x ?? null,
                                      area_y: item.area_y ?? null,
                                      area_w: item.area_w ?? null,
                                      area_h: item.area_h ?? null,
                                    });
                                    message.success("Замечание возвращено в OPEN текущей ревизии");
                                    await onCreated();
                                  }}
                                >
                                  {carryActionMode === "recommendation" ? "Не устранено (R)" : "Не устранено (вернуть)"}
                                </Button>
                                <Button
                                  size="small"
                                  disabled={carryDecidedIds.includes(item.id)}
                                  onClick={() => onCarryClose?.(item.id)}
                                >
                                  {carryActionMode === "recommendation" ? "Устранено (R)" : "Устранено ✓"}
                                </Button>
                              </Space>
                            </Space>
                          ))}
                        </Space>
                      ),
                    },
                    {
                      key: "carry_done",
                      label: `Было устранено (${carryDoneRemarks.length})`,
                      children: (
                        <Space direction="vertical" style={{ width: "100%" }} size={8}>
                          {carryDoneRemarks.map((item) => (
                            <Space key={item.id} wrap style={{ width: "100%", justifyContent: "space-between" }}>
                              <Space direction="vertical" size={2} style={{ maxWidth: 640 }}>
                                <Typography.Text style={{ maxWidth: 640 }}>
                                  {item.review_code ?? "—"} · стр. {item.page ?? "—"} ·{" "}
                                  {(item.text ?? "").replace(/^\[(REMARK|QUESTION)\]\s*/i, "")}
                                </Typography.Text>
                                {carryRHints[item.id] === "R_CLOSED" ? (
                                  <Tag color="green">Автор считает устранено</Tag>
                                ) : carryRHints[item.id] === "R_OPEN" ? (
                                  <Tag color="red">Автор считает не устранено</Tag>
                                ) : null}
                              </Space>
                              <Button
                                size="small"
                                disabled={carryDecidedIds.includes(item.id)}
                                onClick={() => onCarryReopen?.(item.id)}
                              >
                                Вернуть в OPEN
                              </Button>
                            </Space>
                          ))}
                        </Space>
                      ),
                    },
                  ]}
                />
              )}
            </>
          ) : contractorPendingParentComments.length > 0 ? (
            // Кнопки ответа подрядчика «I — На обсуждение» и «A — Принято»
            // показываем только когда есть нерассмотренные замечания
            // заказчика. Пока подрядчик просто просматривает свой PDF
            // (до получения CRS) — кнопок нет, чтобы не путать.
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              <Space>
                <Button
                  onClick={() => {
                    setContractorResponseStatus("I");
                    setContractorResponseText("");
                    setContractorResponseOpen(true);
                  }}
                  disabled={
                    !activeCommentId ||
                    (() => {
                      const active = comments.find((item) => item.id === activeCommentId);
                      if (!active) return true;
                      return active.contractor_status !== null;
                    })()
                  }
                >
                  I - На обсуждение
                </Button>
                <Button
                  onClick={() => {
                    setContractorResponseStatus("A");
                    setContractorResponseText("");
                    setContractorResponseOpen(true);
                  }}
                  disabled={
                    !activeCommentId ||
                    (() => {
                      const active = comments.find((item) => item.id === activeCommentId);
                      if (!active) return true;
                      return !(active.contractor_status === null || (active.contractor_status === "I" && active.backlog_status === "LR_FINAL_CONFIRM"));
                    })()
                  }
                >
                  A - Принято
                </Button>
              </Space>
            </Space>
          ) : null}
        </Space>
      )}
    </Modal>
    <Modal
      title={contractorResponseStatus === "I" ? "Ответ подрядчика: На обсуждение (I)" : "Ответ подрядчика: Принято (A)"}
      open={contractorResponseOpen}
      onCancel={() => setContractorResponseOpen(false)}
      onOk={async () => {
        if (contractorResponseStatus === "I" && contractorResponseText.trim().length < 3) {
          message.warning("Для статуса I укажи комментарий подрядчика");
          return;
        }
        await contractorSetStatus(contractorResponseStatus, contractorResponseText);
        setContractorResponseOpen(false);
      }}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          Этот ответ увидят автор замечания и LR заказчика.
        </Typography.Text>
        <Input.TextArea
          rows={4}
          value={contractorResponseText}
          onChange={(event) => setContractorResponseText(event.target.value)}
          placeholder={
            contractorResponseStatus === "I"
              ? "Опиши причину несогласия и что нужно обсудить..."
              : "При необходимости добавь комментарий по принятому замечанию..."
          }
        />
      </Space>
    </Modal>
    </>
  );
}
