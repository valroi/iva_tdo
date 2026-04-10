import { Alert, Button, Card, Descriptions, Modal, Space, Steps, Switch, Table, Tabs, Tag, Tooltip, Typography, Upload, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";

import { addCommentToCrs, createComment, downloadRevisionAttachmentsArchive, getRevisionCard, listCarryDecisions, ownerCommentDecision, setCarryDecision, uploadRevisionPdf } from "../api";
import ProcessHint from "../components/ProcessHint";
import RevisionPdfAnnotator from "../components/RevisionPdfAnnotator";
import type { CarryDecisionItem, CommentItem, RevisionCard, User } from "../types";
import { formatDateTimeRu } from "../utils/datetime";
import { ContractorReuploadPdfTag, RevisionStatusCell, contractorNeedsPdfReupload } from "../utils/revisionHints";
import { getDisplayRevisionCode, getRemarksSummaryLabel } from "../utils/revisionProcess";
import { PROCESS_STEPS, getProcessCurrentStep } from "../utils/workflowProgress";

interface Props {
  revisionId: number;
  currentUser: User;
  onBack: () => void;
}

export default function RevisionCardPage({ revisionId, currentUser, onBack }: Props): JSX.Element {
  const [card, setCard] = useState<RevisionCard | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number>(revisionId);
  const [pdfAnnotatorOpen, setPdfAnnotatorOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showOnlyUnsentCrs, setShowOnlyUnsentCrs] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);
  const [pdfFocusCommentId, setPdfFocusCommentId] = useState<number | null>(null);
  const [carryClosedByRevision, setCarryClosedByRevision] = useState<Record<number, number[]>>({});
  const [carryDecisionsByRevision, setCarryDecisionsByRevision] = useState<Record<number, CarryDecisionItem[]>>({});

  const loadCard = async (): Promise<void> => {
    try {
      const next = await getRevisionCard(revisionId);
      setCard(next);
      if (!next.revisions.some((item) => item.id === selectedRevisionId)) {
        setSelectedRevisionId(next.revisions[next.revisions.length - 1]?.id ?? revisionId);
      }
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Не удалось открыть карточку ревизии";
      message.error(text);
    }
  };

  useEffect(() => {
    void loadCard();
  }, [revisionId]);

  const selectedRevision = useMemo(
    () => card?.revisions.find((item) => item.id === selectedRevisionId) ?? null,
    [card?.revisions, selectedRevisionId],
  );
  const selectedRevisionComments = useMemo<CommentItem[]>(
    () => card?.history.find((item) => item.revision_id === selectedRevisionId)?.comments ?? [],
    [card?.history, selectedRevisionId],
  );
  const currentProcessStatus = useMemo(
    () => getRemarksSummaryLabel(selectedRevisionComments, selectedRevision?.review_code ?? null),
    [selectedRevisionComments, selectedRevision?.review_code],
  );
  const lastRevision = useMemo(
    () => (card?.revisions.length ? card.revisions[card.revisions.length - 1] : null),
    [card?.revisions],
  );
  const latestByCreated = useMemo(
    () =>
      card?.revisions.length
        ? [...card.revisions].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))[0]
        : null,
    [card?.revisions],
  );
  const latestRevisionId = lastRevision?.id ?? null;
  const documentCompleted =
    (latestByCreated?.issue_purpose ?? "").toUpperCase() === "AFD" && latestByCreated?.review_code === "AP";

  const filteredHistory = useMemo(() => {
    if (!card?.history) return [];
    return card.history;
  }, [card?.history]);
  const selectedHistoryIndex = useMemo(
    () => filteredHistory.findIndex((item) => item.revision_id === selectedRevisionId),
    [filteredHistory, selectedRevisionId],
  );
  const selectedCarryRemarks = useMemo<CommentItem[]>(
    () =>
      selectedHistoryIndex > 0
        ? filteredHistory
            .slice(0, selectedHistoryIndex)
            .flatMap((h) => h.comments)
            .filter((comment) => comment.parent_id === null && comment.status === "RESOLVED" && !comment.carry_finalized)
        : [],
    [filteredHistory, selectedHistoryIndex],
  );

  const canOwnerCreateRemarks = currentUser.company_type !== "owner" || Boolean(card?.can_current_user_raise_comments);
  const canManageCarryOver = currentUser.role === "admin" || currentUser.company_type === "owner";
  const canCommentOnSelectedRevision =
    selectedRevision?.status === "UNDER_REVIEW" || selectedRevision?.status === "OWNER_COMMENTS_SENT";
  const formatDateRu = (value: string | null | undefined): string => {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split("-");
        return `${d}.${m}.${y}`;
      }
      return value;
    }
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = String(dt.getFullYear());
    return `${dd}.${mm}.${yyyy}`;
  };

  const submitUpload = async (): Promise<void> => {
    if (!selectedRevisionId || !uploadFile) {
      message.warning("Выберите ревизию и PDF файл");
      return;
    }
    if (!currentUser.permissions.can_upload_files) {
      message.error("Недостаточно прав для загрузки PDF");
      return;
    }
    if (documentCompleted) {
      message.warning("Документ завершен (AFD + AP). Загрузка PDF заблокирована.");
      return;
    }
    setUploading(true);
    try {
      await uploadRevisionPdf(selectedRevisionId, uploadFile);
      message.success("PDF загружен");
      setUploadModalOpen(false);
      setUploadFile(null);
      await loadCard();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить PDF";
      message.error(text);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!selectedRevisionId || !canManageCarryOver) return;
    listCarryDecisions(selectedRevisionId)
      .then((items) => {
        setCarryDecisionsByRevision((prev) => ({ ...prev, [selectedRevisionId]: items }));
        const closed = items.filter((item) => item.status === "CLOSED").map((item) => item.source_comment_id);
        setCarryClosedByRevision((prev) => ({ ...prev, [selectedRevisionId]: closed }));
      })
      .catch(() => {
        setCarryDecisionsByRevision((prev) => ({ ...prev, [selectedRevisionId]: [] }));
        setCarryClosedByRevision((prev) => ({ ...prev, [selectedRevisionId]: [] }));
      });
  }, [selectedRevisionId, canManageCarryOver]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Tooltip title="Вернуться к общему списку ревизий">
          <Button onClick={onBack}>Назад</Button>
        </Tooltip>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Карточка документа
        </Typography.Title>
        <Tooltip title="Открыть PDF выбранной ревизии для просмотра и комментариев">
          <Button
            type="primary"
            onClick={() => {
              setPdfFocusCommentId(null);
              setPdfAnnotatorOpen(true);
            }}
            disabled={
              !selectedRevision?.file_path ||
              documentCompleted ||
              (!currentUser.permissions.can_raise_comments && currentUser.company_type !== "contractor") ||
              !canOwnerCreateRemarks ||
              (currentUser.company_type === "owner" && !canCommentOnSelectedRevision)
            }
          >
            {currentUser.company_type === "contractor" ? "Открыть PDF" : "Комментировать PDF"}
          </Button>
        </Tooltip>
        {currentUser.permissions.can_upload_files && (
          <Tooltip title="Загрузить или заменить основной PDF выбранной ревизии">
            <Button
              icon={<UploadOutlined />}
              disabled={documentCompleted}
              onClick={() => {
                setUploadFile(null);
                setUploadModalOpen(true);
              }}
            >
              PDF
            </Button>
          </Tooltip>
        )}
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как читать карточку ревизии"
        steps={[
          "Сначала выберите нужную ревизию в истории.",
          "Открывайте PDF для контекста замечаний и ответов.",
          "Подтверждение исправлений из прошлых ревизий делает заказчик (LR/R).",
          "Действия доступны только там, где это допустимо по этапу процесса.",
        ]}
      />

      <Card style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="Проект">{card?.project_code ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Документ">{card?.document_num ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Название">{card?.document_title ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Категория">{card?.category ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Дисциплина">{card?.discipline_code ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Текущий статус процесса">
            {(selectedRevision ?? lastRevision) ? (
              <Space direction="vertical" size={2}>
                <Typography.Text>{(selectedRevision ?? lastRevision)?.status}</Typography.Text>
                <Space size={6}>
                  <Typography.Text type="secondary">Код замечаний:</Typography.Text>
                  <Tag color={currentProcessStatus === "AP" ? "success" : "default"}>{currentProcessStatus}</Tag>
                </Space>
                {contractorNeedsPdfReupload(currentUser, (selectedRevision ?? lastRevision)?.status) && <ContractorReuploadPdfTag />}
              </Space>
            ) : (
              "—"
            )}
          </Descriptions.Item>
        </Descriptions>
        {(selectedRevision ?? lastRevision) && (
          <div style={{ marginTop: 10 }}>
            <Typography.Text type="secondary">Этапы процесса:</Typography.Text>
            <Steps
              size="small"
              current={getProcessCurrentStep((selectedRevision ?? lastRevision)?.status)}
              responsive={false}
              items={PROCESS_STEPS.map((item) => ({
                ...item,
                title: (
                  <Tooltip title={item.description ?? item.title}>
                    <span>{item.title}</span>
                  </Tooltip>
                ),
              }))}
            />
          </div>
        )}
        {currentUser.company_type === "owner" && !canOwnerCreateRemarks && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 10 }}
            message="Вы не назначены рассматривающим (LR/R) по этому документу"
            description="Доступен только просмотр документа и согласованных замечаний."
          />
        )}
      </Card>

      <Card title="План / факт по документу" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="План начала разработки">{formatDateRu(card?.planned_dev_start)}</Descriptions.Item>
          <Descriptions.Item label="План выпуска">{formatDateRu(card?.planned_issue_date)}</Descriptions.Item>
          <Descriptions.Item label="Факт первой загрузки PDF">
            {card?.actual_first_upload_date ? formatDateTimeRu(card.actual_first_upload_date) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Факт последнего выпуска">
            {card?.actual_latest_issue_date ? formatDateTimeRu(card.actual_latest_issue_date) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Фактический прогресс">{card?.actual_progress_percent ?? 0}%</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Иерархия ревизий" style={{ marginBottom: 12 }}>
        {contractorNeedsPdfReupload(currentUser, selectedRevision?.status) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 10 }}
            message="Требуется перезагрузка PDF"
            description="Руководитель ТДО отклонил загрузку. В проекте откройте документ и нажмите «PDF» у этой ревизии."
          />
        )}
        <Table
          rowKey="id"
          dataSource={card?.revisions ?? []}
          pagination={false}
          size="small"
          columns={[
            { title: "Рев", width: 90, render: (_, row) => getDisplayRevisionCode(row, card?.revisions ?? []) },
            { title: "Цель", dataIndex: "issue_purpose", width: 120 },
            {
              title: "Статус",
              dataIndex: "status",
              width: 260,
              render: (v: string) => <RevisionStatusCell currentUser={currentUser} status={v} />,
            },
            { title: "TRM", dataIndex: "trm_number", render: (v: string | null) => v ?? "—" },
            { title: "Создана", dataIndex: "created_at", width: 180, render: (v) => formatDateTimeRu(v) },
            {
              title: "Действие",
              key: "action",
              width: 220,
              render: (_, row) => (
                <Space wrap size={[8, 8]}>
                  <Button
                    size="small"
                    onClick={() => {
                      setSelectedRevisionId(row.id);
                      setPdfFocusCommentId(null);
                      setPdfAnnotatorOpen(true);
                    }}
                    disabled={
                      !row.file_path ||
                      !canOwnerCreateRemarks ||
                      (currentUser.company_type === "owner" && !(row.status === "UNDER_REVIEW" || row.status === "OWNER_COMMENTS_SENT"))
                    }
                  >
                    {currentUser.company_type === "contractor" ? "Открыть" : "Комментировать"}
                  </Button>
                  <Button
                    size="small"
                    onClick={async () => {
                      try {
                        await downloadRevisionAttachmentsArchive(row.id, card?.document_num ?? "document");
                      } catch (error: unknown) {
                        const text = error instanceof Error ? error.message : "Нет дополнительных файлов";
                        message.error(text);
                      }
                    }}
                  >
                    Файлы
                  </Button>
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
                </Space>
              ),
            },
          ]}
          tableLayout="fixed"
          scroll={{ x: 1080 }}
          locale={{ emptyText: "История ревизий пуста." }}
        />
      </Card>

      <Card
        title="Таблица ревизий и комментариев (по нарастанию)"
        extra={
          currentUser.permissions.can_publish_comments ? (
            <Space size={8}>
              <Typography.Text type="secondary">Только неотправленные в CRS</Typography.Text>
              <Switch size="small" checked={showOnlyUnsentCrs} onChange={setShowOnlyUnsentCrs} />
            </Space>
          ) : undefined
        }
      >
        <Table
          rowKey="revision_id"
          dataSource={filteredHistory}
          pagination={false}
          locale={{ emptyText: "По этой ревизии пока нет комментариев." }}
          expandable={{
            expandedRowRender: (row) => {
              const canManageFromCard = currentUser.permissions.can_publish_comments && !documentCompleted;
              const isLatestRow = latestRevisionId !== null && row.revision_id === latestRevisionId;
              const rowComments =
                showOnlyUnsentCrs && currentUser.permissions.can_publish_comments && row.revision_id === selectedRevisionId
                  ? row.comments.filter(
                      (comment) =>
                        comment.parent_id === null &&
                        !comment.is_published_to_contractor &&
                        !comment.crs_sent_at &&
                        comment.status !== "REJECTED",
                    )
                  : row.comments;
              const grouped = {
                inProgress: rowComments.filter((comment) => comment.status === "OPEN" || comment.status === "IN_PROGRESS"),
                resolved: rowComments.filter((comment) => comment.status === "RESOLVED"),
                rejected: rowComments.filter((comment) => comment.status === "REJECTED"),
              };
              const rowIndex = filteredHistory.findIndex((item) => item.revision_id === row.revision_id);
              const carryCandidates =
                rowIndex > 0
                  ? filteredHistory
                      .slice(0, rowIndex)
                      .flatMap((h) => h.comments)
                      .filter((comment) => comment.parent_id === null && comment.status === "RESOLVED" && !comment.carry_finalized)
                  : [];
              const carryClosedIds = carryClosedByRevision[row.revision_id] ?? [];
              const carryOpen = carryCandidates.filter((item) => !carryClosedIds.includes(item.id));
              const carryDone = carryCandidates.filter((item) => carryClosedIds.includes(item.id));
              const renderCommentsTable = (items: CommentItem[]) => (
                <Table
                  rowKey="id"
                  dataSource={items}
                  pagination={false}
                  size="small"
                  columns={[
                  {
                    title: "Текст",
                    dataIndex: "text",
                    render: (value: string, comment: CommentItem) => (
                      <Button
                        type="link"
                        style={{ padding: 0 }}
                        onClick={() => {
                          setSelectedRevisionId(row.revision_id);
                          setPdfFocusCommentId(comment.id);
                          setPdfAnnotatorOpen(true);
                        }}
                      >
                        <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 390 }}>
                          {value}
                        </Typography.Text>
                      </Button>
                    ),
                  },
                  {
                    title: "Статус",
                    dataIndex: "status",
                    width: 140,
                    render: (value: string) => <Tag>{value}</Tag>,
                  },
                  {
                    title: "Код замечания",
                    key: "review_code",
                    width: 130,
                    render: (_: unknown, comment: CommentItem) => comment.review_code ?? "—",
                  },
                  {
                    title: "Автор замечания",
                    key: "author_name",
                    width: 180,
                    render: (_: unknown, comment: CommentItem) => comment.author_name ?? comment.author_email ?? "—",
                  },
                  {
                    title: "CRS",
                    key: "crs_number",
                    width: 150,
                    render: (_: unknown, comment: CommentItem) => comment.crs_number ?? (comment.in_crs ? "В CRS" : "—"),
                  },
                  {
                    title: "Дата CRS",
                    key: "crs_sent_at",
                    width: 160,
                    render: (_: unknown, comment: CommentItem) => formatDateTimeRu(comment.crs_sent_at),
                  },
                  {
                    title: "Статус замечания",
                    dataIndex: "status",
                    width: 150,
                    render: (value: CommentItem["status"]) => {
                      const titleMap: Record<CommentItem["status"], string> = {
                        OPEN: "Открыто",
                        IN_PROGRESS: "В работе",
                        RESOLVED: "Закрыто",
                        REJECTED: "Отклонено LR",
                      };
                      return <Tag>{titleMap[value]}</Tag>;
                    },
                  },
                  {
                    title: "Статус подрядчика",
                    key: "contractor_status",
                    width: 160,
                    render: (_: unknown, comment: CommentItem) =>
                      comment.contractor_status === "I" ? "I - На обсуждении" : comment.contractor_status === "A" ? "A - Принято" : "—",
                  },
                  {
                    title: "Ответ подрядчика",
                    key: "contractor_response_text",
                    width: 230,
                    render: (_: unknown, comment: CommentItem) => comment.contractor_response_text ?? "—",
                  },
                  {
                    title: "Дата ответа",
                    key: "contractor_response_at",
                    width: 160,
                    render: (_: unknown, comment: CommentItem) => formatDateTimeRu(comment.contractor_response_at),
                  },
                  { title: "Лист", dataIndex: "page", width: 90, render: (v: number | null) => v ?? "—" },
                  { title: "Создан", dataIndex: "created_at", width: 180, render: (v) => formatDateTimeRu(v) },
                  {
                    title: "Просмотр",
                    key: "view",
                    width: 130,
                    render: (_: unknown, comment: CommentItem) => (
                      <Button
                        size="small"
                        onClick={() => {
                          setSelectedRevisionId(row.revision_id);
                          setPdfFocusCommentId(comment.id);
                          setPdfAnnotatorOpen(true);
                        }}
                      >
                        Открыть в PDF
                      </Button>
                    ),
                  },
                  ...(canManageFromCard
                    ? ([
                        {
                          title: "Действие",
                          key: "action",
                          width: 260,
                          render: (_: unknown, comment: CommentItem) => (
                            <Space>
                              {isLatestRow &&
                                (comment.status === "OPEN" || comment.status === "IN_PROGRESS") &&
                                comment.parent_id === null &&
                                !comment.is_published_to_contractor &&
                                !comment.in_crs && (
                                <Button
                                  size="small"
                                  loading={busyCommentId === comment.id}
                                  onClick={async () => {
                                    try {
                                      setBusyCommentId(comment.id);
                                      message.loading({ content: "Добавление в CRS...", key: `crs_${comment.id}` });
                                      await addCommentToCrs(comment.id);
                                      message.success({ content: "Замечание добавлено в CRS", key: `crs_${comment.id}` });
                                      await loadCard();
                                    } catch (error: unknown) {
                                      const text = error instanceof Error ? error.message : "Не удалось добавить в CRS";
                                      message.error({ content: text, key: `crs_${comment.id}` });
                                    } finally {
                                      setBusyCommentId(null);
                                    }
                                  }}
                                >
                                  Добавить в CRS
                                </Button>
                              )}
                              {isLatestRow && (comment.status === "OPEN" || comment.status === "IN_PROGRESS") && (
                                <Button
                                  size="small"
                                  danger
                                  loading={busyCommentId === comment.id}
                                  disabled={comment.parent_id !== null || comment.status === "REJECTED"}
                                  onClick={async () => {
                                    try {
                                      setBusyCommentId(comment.id);
                                      message.loading({ content: "Отклонение замечания...", key: `withdraw_${comment.id}` });
                                      await ownerCommentDecision(comment.id, { action: "REJECT", note: "Снято LR" });
                                      message.success({ content: "Замечание отклонено LR", key: `withdraw_${comment.id}` });
                                      await loadCard();
                                    } catch (error: unknown) {
                                      const text = error instanceof Error ? error.message : "Не удалось отклонить замечание";
                                      message.error({ content: text, key: `withdraw_${comment.id}` });
                                    } finally {
                                      setBusyCommentId(null);
                                    }
                                  }}
                                >
                                  Отклонить
                                </Button>
                              )}
                            </Space>
                          ),
                        },
                      ] as const)
                    : []),
                  ]}
                  tableLayout="fixed"
                  scroll={{ x: 1100, y: 260 }}
                />
              );
              const tabItems = [
                { key: "in_progress", label: `В работе (${grouped.inProgress.length})`, children: renderCommentsTable(grouped.inProgress) },
                { key: "resolved", label: `Будет учтено (${grouped.resolved.length})`, children: renderCommentsTable(grouped.resolved) },
                ...(currentUser.company_type === "contractor"
                  ? []
                  : [{ key: "rejected", label: `Отклонено LR (${grouped.rejected.length})`, children: renderCommentsTable(grouped.rejected) }]),
                ...(canManageCarryOver && rowIndex > 0
                  ? [
                      {
                        key: "carry_open",
                        label: `Должны были устранить (${carryOpen.length})`,
                        children: (
                          <Table
                            rowKey="id"
                            size="small"
                            dataSource={carryOpen}
                            pagination={false}
                            columns={[
                              {
                                title: "Из ревизии",
                                width: 110,
                                render: (_, item) =>
                                  filteredHistory.find((h) => h.comments.some((c) => c.id === item.id))?.revision_code ?? "—",
                              },
                              { title: "Код", key: "review_code", width: 90, render: (_, item) => item.review_code ?? "—" },
                              { title: "Текст", dataIndex: "text" },
                              { title: "Автор", key: "author", width: 180, render: (_, item) => item.author_name ?? item.author_email ?? "—" },
                              {
                                title: "Кем подтверждено",
                                width: 180,
                                render: (_, item) => {
                                  const d = (carryDecisionsByRevision[row.revision_id] ?? []).find((x) => x.source_comment_id === item.id);
                                  return d?.decided_by_name ?? d?.decided_by_email ?? "—";
                                },
                              },
                              {
                                title: "Когда подтверждено",
                                width: 170,
                                render: (_, item) => {
                                  const d = (carryDecisionsByRevision[row.revision_id] ?? []).find((x) => x.source_comment_id === item.id);
                                  return d ? formatDateTimeRu(d.decided_at) : "—";
                                },
                              },
                              {
                                title: "Действие",
                                width: 220,
                                render: (_, item) => (
                                  <Space>
                                    <Button
                                      size="small"
                                      disabled={!isLatestRow}
                                      onClick={async () => {
                                        const exists = row.comments.some((c) => c.text === item.text && c.review_code === item.review_code);
                                        if (!exists) {
                                          await createComment({
                                            revision_id: row.revision_id,
                                            text: item.text,
                                            status: "OPEN",
                                            review_code: item.review_code ?? null,
                                            page: item.page ?? null,
                                            area_x: item.area_x ?? null,
                                            area_y: item.area_y ?? null,
                                            area_w: item.area_w ?? null,
                                            area_h: item.area_h ?? null,
                                          });
                                          await loadCard();
                                        }
                                      }}
                                    >
                                      OPEN
                                    </Button>
                                    <Button
                                      size="small"
                                      disabled={!isLatestRow}
                                      onClick={() => {
                                        void setCarryDecision(row.revision_id, { source_comment_id: item.id, status: "CLOSED" })
                                          .then((decision) => {
                                            setCarryClosedByRevision((prev) => {
                                              const next = Array.from(new Set([...(prev[row.revision_id] ?? []), item.id]));
                                              return { ...prev, [row.revision_id]: next };
                                            });
                                            setCarryDecisionsByRevision((prev) => ({
                                              ...prev,
                                              [row.revision_id]: [
                                                decision,
                                                ...(prev[row.revision_id] ?? []).filter((x) => x.source_comment_id !== decision.source_comment_id),
                                              ],
                                            }));
                                            message.success("Замечание переведено в 'Было устранено'");
                                          })
                                          .catch((error: unknown) => {
                                            const text = error instanceof Error ? error.message : "Не удалось сохранить CLOSED";
                                            message.error(text);
                                          });
                                      }}
                                    >
                                      CLOSED
                                    </Button>
                                  </Space>
                                ),
                              },
                            ]}
                            scroll={{ x: 900, y: 220 }}
                          />
                        ),
                      },
                      {
                        key: "carry_done",
                        label: `Было устранено (${carryDone.length})`,
                        children: (
                          <Table
                            rowKey="id"
                            size="small"
                            dataSource={carryDone}
                            pagination={false}
                            columns={[
                              {
                                title: "Из ревизии",
                                width: 110,
                                render: (_, item) =>
                                  filteredHistory.find((h) => h.comments.some((c) => c.id === item.id))?.revision_code ?? "—",
                              },
                              { title: "Код", key: "review_code", width: 90, render: (_, item) => item.review_code ?? "—" },
                              { title: "Текст", dataIndex: "text" },
                              { title: "Автор", key: "author", width: 180, render: (_, item) => item.author_name ?? item.author_email ?? "—" },
                              {
                                title: "Кем подтверждено",
                                width: 180,
                                render: (_, item) => {
                                  const d = (carryDecisionsByRevision[row.revision_id] ?? []).find((x) => x.source_comment_id === item.id);
                                  return d?.decided_by_name ?? d?.decided_by_email ?? "—";
                                },
                              },
                              {
                                title: "Когда подтверждено",
                                width: 170,
                                render: (_, item) => {
                                  const d = (carryDecisionsByRevision[row.revision_id] ?? []).find((x) => x.source_comment_id === item.id);
                                  return d ? formatDateTimeRu(d.decided_at) : "—";
                                },
                              },
                              {
                                title: "Действие",
                                width: 180,
                                render: () => <Typography.Text type="secondary">Зафиксировано</Typography.Text>,
                              },
                            ]}
                            scroll={{ x: 900, y: 220 }}
                          />
                        ),
                      },
                    ]
                  : []),
              ];
              return (
                <Tabs
                  items={tabItems}
                />
              );
            },
          }}
          columns={[
            { title: "Ревизия", width: 100, render: (_, row) => getDisplayRevisionCode(row, card?.revisions ?? []) },
            {
              title: "Статус ревизии",
              dataIndex: "status",
              width: 300,
              render: (v: string, row) => (
                <Space direction="vertical" size={2}>
                  <RevisionStatusCell currentUser={currentUser} status={v} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Код замечаний: {getRemarksSummaryLabel(row.comments, (card?.revisions.find((rev) => rev.id === row.revision_id)?.review_code as string | null | undefined) ?? null)}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: "Комментариев", key: "comments_count", width: 120, render: (_, row) => row.comments.length },
            { title: "Дата", dataIndex: "created_at", width: 180, render: (v) => formatDateTimeRu(v) },
          ]}
          tableLayout="fixed"
          scroll={{ x: 920 }}
        />
      </Card>
      <RevisionPdfAnnotator
        revisionId={selectedRevisionId}
        open={pdfAnnotatorOpen}
        onClose={() => {
          setPdfAnnotatorOpen(false);
          setPdfFocusCommentId(null);
        }}
        mode={currentUser.company_type === "contractor" ? "contractor_review" : "owner_create"}
        comments={selectedRevisionComments}
        carryOverRemarks={canManageCarryOver ? selectedCarryRemarks : []}
        carryClosedIds={canManageCarryOver ? (carryClosedByRevision[selectedRevisionId] ?? []) : []}
        onCarryClose={canManageCarryOver ? (id) => {
          void setCarryDecision(selectedRevisionId, { source_comment_id: id, status: "CLOSED" })
            .then((decision) => {
              setCarryClosedByRevision((prev) => {
                const next = Array.from(new Set([...(prev[selectedRevisionId] ?? []), id]));
                return { ...prev, [selectedRevisionId]: next };
              });
              setCarryDecisionsByRevision((prev) => ({
                ...prev,
                [selectedRevisionId]: [
                  decision,
                  ...(prev[selectedRevisionId] ?? []).filter((x) => x.source_comment_id !== decision.source_comment_id),
                ],
              }));
            })
            .catch((error: unknown) => {
              const text = error instanceof Error ? error.message : "Не удалось сохранить CLOSED";
              message.error(text);
            });
        } : undefined}
        onCarryReopen={canManageCarryOver ? (id) => {
          void setCarryDecision(selectedRevisionId, { source_comment_id: id, status: "OPEN" })
            .then((decision) => {
              setCarryClosedByRevision((prev) => {
                const next = (prev[selectedRevisionId] ?? []).filter((itemId) => itemId !== id);
                return { ...prev, [selectedRevisionId]: next };
              });
              setCarryDecisionsByRevision((prev) => ({
                ...prev,
                [selectedRevisionId]: [
                  decision,
                  ...(prev[selectedRevisionId] ?? []).filter((x) => x.source_comment_id !== decision.source_comment_id),
                ],
              }));
            })
            .catch((error: unknown) => {
              const text = error instanceof Error ? error.message : "Не удалось сохранить OPEN";
              message.error(text);
            });
        } : undefined}
        onCarryOpen={canManageCarryOver ? async (item) => {
          if (!selectedRevisionId) return;
          const exists = selectedRevisionComments.some(
            (c) => c.parent_id === null && c.text === item.text && (c.review_code ?? null) === (item.review_code ?? null),
          );
          if (exists) return;
          await createComment({
            revision_id: selectedRevisionId,
            text: item.text,
            status: "OPEN",
            review_code: item.review_code ?? null,
            page: item.page ?? null,
            area_x: item.area_x ?? null,
            area_y: item.area_y ?? null,
            area_w: item.area_w ?? null,
            area_h: item.area_h ?? null,
          });
          await loadCard();
        } : undefined}
        canCreateRemarks={(card?.can_current_user_raise_comments ?? true) && !documentCompleted}
        canCreateOwnerRemarks={canOwnerCreateRemarks && !documentCompleted}
        canManageOwnerRemarks={currentUser.permissions.can_publish_comments}
        noAccessHint="Вы не назначены рассматривающим (LR/R) по этому документу. Доступен только просмотр PDF и замечаний."
        focusCommentId={pdfFocusCommentId}
        onCreated={async () => {
          await loadCard();
        }}
      />
      <Modal
        open={uploadModalOpen}
        title="Загрузить PDF в ревизию"
        onCancel={() => setUploadModalOpen(false)}
        onOk={() => void submitUpload()}
        okButtonProps={{ loading: uploading }}
      >
        <Typography.Text type="secondary">
          Выбранная ревизия: {selectedRevisionId ?? "—"}. Поддерживается только PDF.
        </Typography.Text>
        <div style={{ marginTop: 12 }}>
          <Upload
            maxCount={1}
            beforeUpload={(file) => {
              if (file.type !== "application/pdf") {
                message.error("Можно загружать только PDF");
                return Upload.LIST_IGNORE;
              }
              setUploadFile(file);
              return false;
            }}
            onRemove={() => {
              setUploadFile(null);
            }}
          >
            <Button icon={<UploadOutlined />}>Выбрать PDF</Button>
          </Upload>
        </div>
      </Modal>
    </div>
  );
}
