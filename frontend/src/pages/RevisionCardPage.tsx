import { Alert, App, Button, Card, Descriptions, Modal, Space, Steps, Switch, Table, Tabs, Tag, Tooltip, Typography, Upload } from "antd";
import { DownloadOutlined, FileTextOutlined, PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";

import { addCommentToCrs, createComment, deleteOwnerComment, docDownloadName, downloadCommentAttachment, downloadCommentsExport, downloadRevisionAnnotatedPdf, downloadRevisionAttachmentsArchive, getRevisionCard, getRevisionReviewerStates, listCarryDecisions, listCommentAttachments, listRevisionEvents, markRevisionNoComments, ownerCommentDecision, setCarryDecision, setRevisionReviewCode, uploadRevisionPdf } from "../api";
import type { ReviewEventItem, RevisionReviewerSummary } from "../api";
import ProcessHint from "../components/ProcessHint";
import RevisionPdfAnnotator from "../components/RevisionPdfAnnotator";
import type { CarryDecisionItem, CommentItem, RevisionCard, User } from "../types";
import { formatDateTimeRu } from "../utils/datetime";
import { ContractorReuploadPdfTag, RevisionStatusCell, contractorNeedsPdfReupload, getRuStatusLabel } from "../utils/revisionHints";
import { getCleanRemarkText, getDisplayRevisionCode, getRemarksSummaryLabel } from "../utils/revisionProcess";
import { PROCESS_STEPS, getProcessCurrentStep, isOwnerCommentingAllowedStatus } from "../utils/workflowProgress";
import { canUploadRevisionFiles, isOwner } from "../utils/revisionActions";

interface Props {
  revisionId: number;
  currentUser: User;
  onBack: () => void;
}

const REVIEW_EVENT_LABELS: Record<string, string> = {
  SENT_TO_OWNER: "Направлено на рассмотрение",
  R_NO_COMMENTS: "Рассмотрено без замечаний",
  R_COMMENTED: "Замечание R",
  LR_COMMENTED: "Замечание LR",
  LR_SENT_TO_CONTRACTOR: "Замечания переданы подрядчику",
  COMMENT_REJECTED: "Замечание отклонено",
  AP_SET: "Согласовано (AP)",
  DEADLINE_REMINDER: "Напоминание о дедлайне",
};

/** Скрепка «есть файл» у замечания: по клику скачивает вложение(я). */
function CommentAttachmentsLink({ comment }: { comment: CommentItem }): JSX.Element | null {
  const { message } = App.useApp();
  if (!comment.attachment_count) return null;
  return (
    <Tooltip title="Скачать файл(ы), приложенные к замечанию">
      <Button
        type="link"
        size="small"
        style={{ padding: 0 }}
        icon={<PaperClipOutlined />}
        onClick={async (e) => {
          e.stopPropagation();
          try {
            const items = await listCommentAttachments(comment.id);
            if (!items.length) {
              message.info("Файлов нет");
              return;
            }
            for (const item of items) {
              await downloadCommentAttachment(item.id, item.file_name);
            }
          } catch (error) {
            message.error(error instanceof Error ? error.message : "Не удалось скачать файл");
          }
        }}
      >
        {comment.attachment_count}
      </Button>
    </Tooltip>
  );
}

export default function RevisionCardPage({ revisionId, currentUser, onBack }: Props): JSX.Element {
  const { message, modal } = App.useApp();
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
  const [reviewerSummary, setReviewerSummary] = useState<RevisionReviewerSummary | null>(null);
  const [reviewEvents, setReviewEvents] = useState<ReviewEventItem[]>([]);
  const [markingNoComments, setMarkingNoComments] = useState(false);
  // Индикаторы загрузки для кнопок скачивания (item 5).
  const [exportBusy, setExportBusy] = useState(false);
  const [annotatedBusy, setAnnotatedBusy] = useState(false);

  const loadReviewMeta = async (revId: number): Promise<void> => {
    try {
      const [summary, events] = await Promise.all([
        getRevisionReviewerStates(revId).catch(() => null),
        listRevisionEvents(revId).catch(() => [] as ReviewEventItem[]),
      ]);
      setReviewerSummary(summary);
      setReviewEvents(events);
    } catch {
      /* мета необязательна — карточка работает и без неё */
    }
  };

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

  useEffect(() => {
    if (selectedRevisionId) void loadReviewMeta(selectedRevisionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRevisionId]);

  // Polling карточки и замечаний каждые 8 секунд: пока пользователь
  // смотрит документ (в том числе при открытой модалке PDF), другие
  // роли могут добавлять/менять замечания — они должны появляться
  // вживую без F5. Короткий интервал — потому что модалка PDF это
  // активная зона работы двух ролей одновременно.
  useEffect(() => {
    if (!revisionId) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void loadCard();
    };
    const id = window.setInterval(tick, 8_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadCard();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
  // Код замечаний по последней (актуальной) ревизии — нужен заголовку
  // карточки, чтобы LR при переходе по задаче не путал статус старой
  // выбранной ревизии с финальным статусом документа.
  const latestRevisionComments = useMemo<CommentItem[]>(
    () => card?.history.find((item) => item.revision_id === (card?.revisions.length ? [...card.revisions].sort((a,b)=>a.id-b.id)[card.revisions.length-1].id : -1))?.comments ?? [],
    [card?.history, card?.revisions],
  );
  // Ревизии создаются строго последовательно, поэтому id монотонен.
  // «Последняя» ревизия = ревизия с максимальным id (created_at ненадёжен).
  const latestRevision = useMemo(
    () =>
      card?.revisions.length
        ? [...card.revisions].sort((a, b) => a.id - b.id)[card.revisions.length - 1]
        : null,
    [card?.revisions],
  );
  const lastRevision = latestRevision;
  const latestRevisionId = latestRevision?.id ?? null;
  const documentCompleted =
    (latestRevision?.issue_purpose ?? "").toUpperCase() === "AFD" && latestRevision?.review_code === "AP";

  const filteredHistory = useMemo(() => {
    if (!card?.history) return [];
    return card.history;
  }, [card?.history]);
  const selectedHistoryIndex = useMemo(
    () => filteredHistory.findIndex((item) => item.revision_id === selectedRevisionId),
    [filteredHistory, selectedRevisionId],
  );
  // Carry remarks — ВСЕ RESOLVED-замечания из предыдущей ревизии.
  // Не фильтруем по carry_finalized и не выкидываем уже decided:
  // Annotator сам разделит их на «Должны были устранить» (carryOpen)
  // и «Было устранено» (carryDone) по carryClosedIds.
  const selectedCarryRemarks = useMemo<CommentItem[]>(
    () =>
      selectedHistoryIndex > 0
        ? filteredHistory[selectedHistoryIndex - 1].comments.filter(
            (comment) => comment.parent_id === null && comment.status === "RESOLVED",
          )
        : [],
    [filteredHistory, selectedHistoryIndex],
  );

  const canOwnerCreateRemarks = currentUser.company_type !== "owner" || Boolean(card?.can_current_user_raise_comments);
  const canManageCarryOver = currentUser.role === "admin" || currentUser.company_type === "owner";
  const selectedCarryDecidedIds = (carryDecisionsByRevision[selectedRevisionId] ?? [])
    .filter((item) => item.status === "OPEN" || item.status === "CLOSED")
    .map((item) => item.source_comment_id);
  const isRMatrixReviewer = card?.current_user_matrix_role === "R" && currentUser.role !== "admin";
  const carryActionMode = isRMatrixReviewer ? "recommendation" : "final";
  const getCarrySuggestion = (revisionId: number, sourceCommentId: number) =>
    (carryDecisionsByRevision[revisionId] ?? []).find(
      (item) => item.source_comment_id === sourceCommentId && (item.status === "R_OPEN" || item.status === "R_CLOSED"),
    );
  const carryRHintsBySourceId = useMemo(() => {
    const out: Partial<Record<number, "R_OPEN" | "R_CLOSED">> = {};
    for (const item of carryDecisionsByRevision[selectedRevisionId] ?? []) {
      if (item.status === "R_OPEN" || item.status === "R_CLOSED") {
        out[item.source_comment_id] = item.status;
      }
    }
    return out;
  }, [carryDecisionsByRevision, selectedRevisionId]);
  const canCommentOnSelectedRevision = isOwnerCommentingAllowedStatus(selectedRevision?.status);
  // R, отметивший «Рассмотрено без замечаний», больше не создаёт замечания
  // по этой ревизии — иначе конфликт «нет замечаний» + новое замечание (item 13).
  const currentUserMarkedNoComments = Boolean(
    reviewerSummary?.reviewers.find((r) => r.user_id === currentUser.id)?.no_comments,
  );
  const rBlockedByNoComments = isRMatrixReviewer && currentUserMarkedNoComments;
  // CRS уже сформирована и отправлена подрядчику по выбранной ревизии —
  // мяч у подрядчика, «рассмотрение заказчиком» закрыто.
  const crsSentForSelectedRevision =
    selectedRevision?.status === "OWNER_COMMENTS_SENT" ||
    selectedRevision?.status === "CONTRACTOR_REPLY_I" ||
    selectedRevision?.status === "CONTRACTOR_REPLY_A";
  const isSelectedRevisionClosedForPdfUpdate =
    selectedRevision?.status === "CONTRACTOR_REPLY_A" || selectedRevision?.status === "SUBMITTED";
  // AP ставит ТОЛЬКО LR заказчика. R может комментировать, но финальное
  // решение AP — прерогатива лидера ревьюверов. Администратор — наблюдатель.
  const canSetApByRole =
    currentUser.company_type === "owner" &&
    currentUser.permissions.can_publish_comments &&
    card?.current_user_matrix_role === "LR";
  // Активные замечания — любые с status OPEN/IN_PROGRESS у корневых
  // комментариев. Считаем не только опубликованные, но и черновики:
  // AP не должен ставиться пока есть хоть одно незакрытое замечание,
  // даже если LR ещё не отправил CRS.
  const activePublishedRemarksCount = selectedRevisionComments.filter(
    (comment) =>
      comment.parent_id === null &&
      (comment.status === "OPEN" || comment.status === "IN_PROGRESS"),
  ).length;
  // Есть хотя бы одно RJ-замечание (опубликованное или черновик) →
  // ревизия отвергнута полностью, AP по ней невозможен.
  const hasRejectRemark = selectedRevisionComments.some(
    (comment) => comment.parent_id === null && comment.review_code === "RJ",
  );
  // Из carry-кандидатов вычитаем уже решённые LR (CLOSED/OPEN в carry_decisions)
  // и локально подтверждённые через carryClosedByRevision — иначе AP-кнопка
  // блокируется даже когда вкладка «Должны были устранить» уже показывает 0.
  const carryLocallyClosedIds = carryClosedByRevision[selectedRevisionId] ?? [];
  const carryOpenCount = selectedCarryRemarks.filter(
    (item) =>
      !selectedCarryDecidedIds.includes(item.id) &&
      !carryLocallyClosedIds.includes(item.id),
  ).length;
  // AP допустим только когда мяч у LR И обсуждение закончено:
  //   UNDER_REVIEW (изначально, до отправки CRS) или CONTRACTOR_REPLY_A
  //   (подрядчик принял всё). При CONTRACTOR_REPLY_I сначала надо
  //   разрешить I-замечания (директивно вернуть или согласиться).
  const apActionableStatus =
    selectedRevision?.status === "UNDER_REVIEW" || selectedRevision?.status === "CONTRACTOR_REPLY_A";
  // Управление замечаниями LR доступно ВКЛЮЧАЯ статус CONTRACTOR_REPLY_I
  // (нужны кнопки «Вернуть директивно в работу» / «Согласиться»).
  const ownerRemarkManagementStatus =
    selectedRevision?.status === "UNDER_REVIEW" ||
    selectedRevision?.status === "CONTRACTOR_REPLY_I" ||
    selectedRevision?.status === "CONTRACTOR_REPLY_A";
  const canSetApForSelectedRevision =
    Boolean(selectedRevision) &&
    selectedRevision?.id === latestRevisionId &&
    selectedRevision?.review_code !== "AP" &&
    canSetApByRole &&
    apActionableStatus &&
    !hasRejectRemark &&
    activePublishedRemarksCount === 0 &&
    carryOpenCount === 0;
  const getRevisionRemarksStatus = (revisionId: number, comments: CommentItem[]): string => {
    const revisionReviewCode = (card?.revisions.find((rev) => rev.id === revisionId)?.review_code as string | null | undefined) ?? null;
    if (revisionReviewCode) return revisionReviewCode;
    const fallback = getRemarksSummaryLabel(comments, revisionReviewCode);
    return fallback === "Нет замечаний" ? "—" : fallback;
  };
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
    if (!canManageCarryOver || filteredHistory.length === 0) return;
    // Грузим carry decisions для ВСЕХ ревизий в истории — таблица
    // «по нарастанию» раскрывает любую из них, и для каждой нужны
    // данные «Было устранено». Раньше грузилось только для выбранной
    // ревизии, и в раскрытых строках «Было устранено» всегда было 0.
    let cancelled = false;
    Promise.all(
      filteredHistory.map((row) =>
        listCarryDecisions(row.revision_id)
          .then((merged) => ({ revisionId: row.revision_id, merged }))
          .catch(() => ({ revisionId: row.revision_id, merged: [] })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const nextDecisions: Record<number, CarryDecisionItem[]> = {};
      const nextClosed: Record<number, number[]> = {};
      for (const { revisionId, merged } of results) {
        nextDecisions[revisionId] = merged;
        nextClosed[revisionId] = merged
          .filter((item) => item.status === "CLOSED")
          .map((item) => item.source_comment_id);
      }
      setCarryDecisionsByRevision(nextDecisions);
      setCarryClosedByRevision(nextClosed);
    });
    return () => {
      cancelled = true;
    };
  }, [canManageCarryOver, filteredHistory]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Tooltip title="Вернуться к общему списку ревизий">
          <Button onClick={onBack}>Назад</Button>
        </Tooltip>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Карточка документа
        </Typography.Title>
        {/* Выгрузка замечаний по этому документу (все ревизии) — Excel для
            рассылки внутри команды. Доступна и подрядчику, и заказчику. */}
        <Tooltip title="Скачать Excel со всеми замечаниями и действиями по этому документу">
          <Button
            icon={<DownloadOutlined />}
            loading={exportBusy}
            onClick={async () => {
              setExportBusy(true);
              try {
                await downloadCommentsExport({
                  project_code: card?.project_code ?? null,
                  document_num: card?.document_num ?? null,
                });
                message.success("Выгрузка по документу сформирована");
              } catch (error) {
                message.error(error instanceof Error ? error.message : "Не удалось выгрузить замечания");
              } finally {
                setExportBusy(false);
              }
            }}
          >
            Выгрузить замечания (Excel)
          </Button>
        </Tooltip>
        {/* PDF выбранной ревизии с врисованными замечаниями (рамки/номера +
            страница-сводка). Доступно, когда к ревизии прикреплён PDF. */}
        {selectedRevision?.file_path && (
          <Tooltip title="Скачать PDF ревизии с нанесёнными замечаниями и страницей-сводкой">
            <Button
              icon={<DownloadOutlined />}
              loading={annotatedBusy}
              onClick={async () => {
                setAnnotatedBusy(true);
                message.loading({ content: "Собираем PDF с замечаниями…", key: "annpdf" });
                try {
                  await downloadRevisionAnnotatedPdf(
                    selectedRevision.id,
                    docDownloadName(card?.document_num, selectedRevision.revision_code, "_замечания.pdf"),
                  );
                  message.success({ content: "PDF готов", key: "annpdf" });
                } catch (error) {
                  message.error({ content: error instanceof Error ? error.message : "Не удалось собрать PDF с замечаниями", key: "annpdf" });
                } finally {
                  setAnnotatedBusy(false);
                }
              }}
            >
              PDF с замечаниями
            </Button>
          </Tooltip>
        )}
        {/* Просмотр PDF — доступен ВСЕМ ролям всегда, пока к ревизии прикреплён
            PDF (даже после отправки замечаний). Создавать новые замечания при
            этом нельзя — только смотреть; ограничения внутри просмотрщика. */}
        {selectedRevision?.file_path && (
          <Tooltip title="Открыть PDF для просмотра (без создания замечаний)">
            <Button
              icon={<FileTextOutlined />}
              onClick={() => {
                setPdfFocusCommentId(null);
                setPdfAnnotatorOpen(true);
              }}
            >
              Просмотр PDF
            </Button>
          </Tooltip>
        )}
        {/* Кнопка PDF: для owner — «Комментировать» только когда ревизия
            на рассмотрении заказчика; для contractor/admin — всегда «Открыть»
            для просмотра. В прочих owner-статусах кнопка прячется целиком. */}
        {(() => {
          // Наблюдатель (owner + member_role=observer, без матрицы) видит PDF
          // read-only в ЛЮБОМ статусе — просмотрщик у него всегда активен, но
          // без права комментировать. Обычный owner — только когда может
          // добавлять замечания. Contractor/admin — всегда «Открыть».
          const isObserver = Boolean(card?.is_observer);
          const ownerCanShow = isObserver
            ? true
            : isOwner(currentUser)
            ? Boolean(canOwnerCreateRemarks) && canCommentOnSelectedRevision
            : true;
          if (!ownerCanShow) return null;
          // Наблюдатель для просмотра не ограничен статусом «завершён» — он
          // просто смотрит; блокировка documentCompleted нужна только тем, кто
          // может редактировать.
          const viewOnly = isObserver || currentUser.company_type === "contractor";
          return (
            <Tooltip
              title={
                !selectedRevision?.file_path
                  ? "PDF ещё не загружен для этой ревизии"
                  : viewOnly
                  ? "Открыть PDF для просмотра"
                  : documentCompleted
                  ? "Документ финально согласован (AFD + AP) — редактирование закрыто"
                  : "Открыть PDF и добавить замечания"
              }
            >
              <Button
                type="primary"
                onClick={() => {
                  setPdfFocusCommentId(null);
                  setPdfAnnotatorOpen(true);
                }}
                disabled={!selectedRevision?.file_path || (!viewOnly && documentCompleted)}
              >
                {isOwner(currentUser) && !isObserver ? "Комментировать PDF" : "Открыть PDF"}
              </Button>
            </Tooltip>
          );
        })()}
        {canUploadRevisionFiles(currentUser, selectedRevision?.status) && (
          <Tooltip title={isSelectedRevisionClosedForPdfUpdate ? "По этой ревизии цикл завершен. Создайте следующую ревизию для новой загрузки PDF." : "Загрузить или заменить основной PDF выбранной ревизии"}>
            <Button
              icon={<UploadOutlined />}
              disabled={documentCompleted || isSelectedRevisionClosedForPdfUpdate}
              onClick={() => {
                setUploadFile(null);
                setUploadModalOpen(true);
              }}
            >
              PDF
            </Button>
          </Tooltip>
        )}
        {card?.current_user_matrix_role === "R" &&
          currentUser.role !== "admin" &&
          selectedRevision?.id === latestRevisionId &&
          selectedRevision?.review_code !== "AP" &&
          canCommentOnSelectedRevision &&
          (() => {
            const my = reviewerSummary?.reviewers.find((r) => r.user_id === currentUser.id);
            const alreadyNc = Boolean(my?.no_comments);
            const hasMy = Boolean(my?.has_comments);
            return (
              <Tooltip
                title={
                  alreadyNc
                    ? "Вы уже отметили «нет замечаний»"
                    : hasMy
                      ? "У вас есть замечания по ревизии — отметка недоступна"
                      : "Отметить, что вы рассмотрели и замечаний нет (LR это увидит)"
                }
              >
                <Button
                  size="small"
                  loading={markingNoComments}
                  disabled={alreadyNc || hasMy}
                  onClick={async () => {
                    if (!selectedRevision) return;
                    setMarkingNoComments(true);
                    try {
                      const summary = await markRevisionNoComments(selectedRevision.id);
                      setReviewerSummary(summary);
                      message.success("Отмечено: рассмотрено без замечаний");
                      await loadReviewMeta(selectedRevision.id);
                      await loadCard();
                    } catch (error: unknown) {
                      message.error(error instanceof Error ? error.message : "Не удалось отметить");
                    } finally {
                      setMarkingNoComments(false);
                    }
                  }}
                >
                  Рассмотрено, без замечаний
                </Button>
              </Tooltip>
            );
          })()}
        {selectedRevision?.id === latestRevisionId &&
          selectedRevision?.review_code !== "AP" &&
          canSetApByRole &&
          apActionableStatus &&
          !hasRejectRemark && (
          <Tooltip
            title={(() => {
              const blocks: string[] = [];
              if (activePublishedRemarksCount > 0) blocks.push(`${activePublishedRemarksCount} активных замечаний не закрыто`);
              if (carryOpenCount > 0) blocks.push(`${carryOpenCount} пункт(а) в «Должны были устранить» без решения`);
              return blocks.length > 0
                ? `Нельзя поставить AP: ${blocks.join("; ")}`
                : "Все замечания закрыты/отклонены — можно поставить AP";
            })()}
          >
            <Button
              disabled={!canSetApForSelectedRevision}
              onClick={() => {
                if (!selectedRevision) return;
                const doAp = async (): Promise<void> => {
                  try {
                    await setRevisionReviewCode(selectedRevision.id, "AP");
                    message.success("Для ревизии установлен статус AP");
                    await loadCard();
                  } catch (error: unknown) {
                    const text = error instanceof Error ? error.message : "Не удалось установить AP";
                    message.error(text);
                  }
                };
                // Обязательный confirm-диалог. AP — необратимое действие
                // (документ помечается окончательно согласованным по этой
                // ревизии), без подтверждения такое срабатывать не должно.
                modal.confirm({
                  title: "Поставить AP по ревизии?",
                  content: (
                    <Space direction="vertical" size={4}>
                      <Typography.Text>
                        Документ {card?.document_num ?? "—"}, ревизия {selectedRevision.revision_code}.
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        После AP откатить решение можно только через администратора.
                        Убедитесь, что все замечания закрыты или отклонены.
                      </Typography.Text>
                    </Space>
                  ),
                  okText: "Да, поставить AP",
                  cancelText: "Отмена",
                  okButtonProps: { danger: true },
                  onOk: doAp,
                });
              }}
            >
              Поставить AP
            </Button>
          </Tooltip>
        )}
      </Space>
      {reviewerSummary && reviewerSummary.reviewers.length > 0 && (
        <Card size="small" style={{ marginBottom: 12 }} title="Рассмотрение ревьюверами">
          {reviewerSummary.approved ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 8 }}
              message="Ревизия согласована (AP)"
              description="Замечания отработаны, LR согласовал ревизию. Отметки ниже отражают исходную позицию ревьюверов."
            />
          ) : (
            reviewerSummary.all_reviewers_no_comments && canSetApByRole && (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 8 }}
                message="Все ревьюверы (R) — без замечаний"
                description="Можно согласовать документ: нажмите «Поставить AP» выше."
              />
            )
          )}
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            {reviewerSummary.reviewers.map((r) => (
              <Space key={r.user_id} size={8}>
                <Tag color={r.role === "LR" ? "blue" : "default"}>{r.role}</Tag>
                <Typography.Text>{r.full_name}</Typography.Text>
                {reviewerSummary.approved ? (
                  <Tag color="success">согласовано (AP)</Tag>
                ) : crsSentForSelectedRevision && r.role === "LR" ? (
                  <Tag color="processing">замечания отправлены (CRS)</Tag>
                ) : r.no_comments ? (
                  <Tag color="success">без замечаний{r.decided_at ? ` · ${formatDateTimeRu(r.decided_at)}` : ""}</Tag>
                ) : r.has_comments ? (
                  <Tag color="orange">есть замечания</Tag>
                ) : (
                  <Tag>рассматривает</Tag>
                )}
              </Space>
            ))}
          </Space>
        </Card>
      )}
      {reviewEvents.length > 0 && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Tabs
            size="small"
            items={[
              {
                key: "history",
                label: `История действий (${reviewEvents.length})`,
                children: (
                  <Space direction="vertical" size={4} style={{ width: "100%" }}>
                    {reviewEvents.map((e) => (
                      <Space key={e.id} size={8} wrap>
                        <Typography.Text type="secondary" style={{ minWidth: 130, display: "inline-block" }}>
                          {formatDateTimeRu(e.created_at)}
                        </Typography.Text>
                        <Tag>{REVIEW_EVENT_LABELS[e.event_type] ?? e.event_type}</Tag>
                        {e.actor_name && <Typography.Text>{e.actor_name}</Typography.Text>}
                        {e.actor_role && <Typography.Text type="secondary">({e.actor_role})</Typography.Text>}
                        {e.target_name && (
                          <Typography.Text type="secondary">→ {e.target_name}</Typography.Text>
                        )}
                        {e.deadline && (
                          <Typography.Text type="secondary">дедлайн {formatDateTimeRu(e.deadline)}</Typography.Text>
                        )}
                      </Space>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}
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
          <Descriptions.Item label="LR (ФИО)">{card?.lr_reviewer_name ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Разработчик (ФИО)">{card?.developer_name ?? "—"}</Descriptions.Item>
          <Descriptions.Item label="Текущий статус процесса">
            {latestRevision ? (
              <Space direction="vertical" size={2}>
                {/* Статус всегда по последней ревизии — это «текущий» статус
                    документа в целом. Старые ревизии уже закрыты. */}
                <Typography.Text strong>{getRuStatusLabel(latestRevision.status)}</Typography.Text>
                <Space size={6}>
                  <Typography.Text type="secondary">
                    Код замечаний по последней ревизии ({getDisplayRevisionCode(latestRevision)}):
                  </Typography.Text>
                  <Tag color={(latestRevision.review_code ?? null) === "AP" ? "success" : "default"}>
                    {getRemarksSummaryLabel(latestRevisionComments, latestRevision.review_code ?? null)}
                  </Tag>
                </Space>
                {selectedRevision && selectedRevision.id !== latestRevision.id && (
                  <Space size={6}>
                    <Typography.Text type="secondary">
                      Код замечаний по выбранной ревизии ({getDisplayRevisionCode(selectedRevision)}):
                    </Typography.Text>
                    <Tag color={currentProcessStatus === "AP" ? "success" : "default"}>{currentProcessStatus}</Tag>
                  </Space>
                )}
                {contractorNeedsPdfReupload(currentUser, latestRevision.status) && <ContractorReuploadPdfTag />}
              </Space>
            ) : (
              "—"
            )}
          </Descriptions.Item>
        </Descriptions>
        {latestRevision && (
          <div style={{ marginTop: 10 }}>
            <Typography.Text type="secondary">Этапы процесса (по последней ревизии):</Typography.Text>
            <Steps
              size="small"
              current={getProcessCurrentStep(latestRevision.status)}
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
        {currentUser.company_type === "contractor" && (selectedRevision ?? lastRevision)?.status === "UNDER_REVIEW" && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 10 }}
            message="Ревизия на рассмотрении заказчиком"
            description="Заказчик проверяет ревизию и формирует замечания. Действия со стороны подрядчика станут доступны после получения CRS."
          />
        )}
        {currentUser.company_type === "contractor" && (selectedRevision ?? lastRevision)?.status === "CONTRACTOR_REPLY_A" && (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 10 }}
            message="Цикл ревизии завершён"
            description="Все замечания отработаны. Создайте следующую ревизию, если документ требует перевыпуска."
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
          locale={{ emptyText: "История ревизий пуста." }}
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
                  <Tooltip
                    title={
                      !row.file_path
                        ? "PDF ещё не загружен"
                        : !canOwnerCreateRemarks
                        ? "Вы не назначены рассматривающим по этому документу"
                        : currentUser.company_type === "owner" && !(row.status === "UNDER_REVIEW" || row.status === "OWNER_COMMENTS_SENT")
                        ? `Замечания доступны только при статусе «На рассмотрении» или «Замечания отправлены». Текущий: ${getRuStatusLabel(row.status)}`
                        : undefined
                    }
                  >
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
                    {isOwner(currentUser) ? "Комментировать" : "Открыть"}
                  </Button>
                  </Tooltip>
                  <Button
                    size="small"
                    onClick={async () => {
                      try {
                        await downloadRevisionAttachmentsArchive(row.id, card?.document_num ?? "document", row.revision_code);
                      } catch (error: unknown) {
                        const text = error instanceof Error ? error.message : "Нет дополнительных файлов";
                        message.error(text);
                      }
                    }}
                  >
                    Файлы
                  </Button>
                  {canUploadRevisionFiles(currentUser, row.status) && (
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
              // Управление замечаниями — только LR по дисциплине.
              // Линейность процесса:
              //  • UNDER_REVIEW           — LR собирает/правит замечания.
              //  • OWNER_COMMENTS_SENT    — мяч у подрядчика (CRS уже у него),
              //                             LR ничего не делает.
              //  • CONTRACTOR_REPLY_I     — подрядчик ответил «На обсуждение»,
              //                             мяч ВЕРНУЛСЯ к LR — нужно решить
              //                             (директивно вернуть в работу
              //                             или согласиться/закрыть).
              //  • CONTRACTOR_REPLY_A     — подрядчик принял, мяч у LR
              //                             (может закрыть цикл, поставить AP).
              const rowStatus = row.status;
              const rowOwnerHoldsBall =
                rowStatus === "UNDER_REVIEW" ||
                rowStatus === "CONTRACTOR_REPLY_I" ||
                rowStatus === "CONTRACTOR_REPLY_A";
              // После проставления AP по ревизии её цикл закрыт: LR не
              // может ни вернуть в работу, ни добавить в CRS, ни удалить
              // или править замечания (включая carry из прошлых ревизий).
              // Если AP стоит на текущей (последней) ревизии — это аналог
              // финального решения, замочные кнопки убираются полностью.
              const rowFrozenByAp = row.review_code === "AP";
              const latestApFreeze = latestRevision?.review_code === "AP";
              const canManageFromCard =
                isOwner(currentUser) &&
                currentUser.permissions.can_publish_comments &&
                card?.current_user_matrix_role === "LR" &&
                !documentCompleted &&
                !latestApFreeze &&
                !rowFrozenByAp &&
                rowOwnerHoldsBall;
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
              // Кандидаты в carry-over — все RESOLVED-замечания из
              // предыдущей ревизии. carry_finalized НЕ исключаем —
              // финализированные нужны в «Было устранено», иначе они
              // пропадают из UI после нажатия «Устранено ✓».
              const carryCandidates =
                rowIndex > 0
                  ? filteredHistory[rowIndex - 1].comments.filter(
                      (comment) => comment.parent_id === null && comment.status === "RESOLVED",
                    )
                  : [];
              const carryClosedIds = carryClosedByRevision[row.revision_id] ?? [];
              const carryDecidedIds = new Set(
                (carryDecisionsByRevision[row.revision_id] ?? [])
                  .filter((item) => item.status === "OPEN" || item.status === "CLOSED")
                  .map((item) => item.source_comment_id),
              );
              const carryOpen = carryCandidates.filter((item) => !carryDecidedIds.has(item.id));
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
                    width: 360,
                    fixed: "left",
                    render: (value: string, comment: CommentItem) => (
                      <Space size={4}>
                        <Button
                          type="link"
                          style={{ padding: 0 }}
                          onClick={() => {
                            setSelectedRevisionId(row.revision_id);
                            setPdfFocusCommentId(comment.id);
                            setPdfAnnotatorOpen(true);
                          }}
                        >
                          <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 320 }}>
                            {getCleanRemarkText(value)}
                          </Typography.Text>
                        </Button>
                        <CommentAttachmentsLink comment={comment} />
                      </Space>
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
                                comment.contractor_status === null &&
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
                              {isLatestRow &&
                                !comment.is_published_to_contractor &&
                                !comment.in_crs &&
                                comment.contractor_status === null &&
                                (comment.status === "OPEN" || comment.status === "IN_PROGRESS") && (
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
                              {isLatestRow &&
                                comment.parent_id === null &&
                                !comment.is_published_to_contractor &&
                                !comment.in_crs &&
                                comment.contractor_status === null &&
                                comment.status === "REJECTED" && (
                                <Button
                                  size="small"
                                  loading={busyCommentId === comment.id}
                                  onClick={async () => {
                                    try {
                                      setBusyCommentId(comment.id);
                                      message.loading({ content: "Возврат замечания в работу...", key: `reopen_${comment.id}` });
                                      await ownerCommentDecision(comment.id, { action: "REOPEN", note: "Возврат в работу" });
                                      message.success({ content: "Замечание возвращено в работу", key: `reopen_${comment.id}` });
                                      await loadCard();
                                    } catch (error: unknown) {
                                      const text = error instanceof Error ? error.message : "Не удалось вернуть замечание";
                                      message.error({ content: text, key: `reopen_${comment.id}` });
                                    } finally {
                                      setBusyCommentId(null);
                                    }
                                  }}
                                >
                                  Вернуть в работу
                                </Button>
                              )}
                              {isLatestRow &&
                                comment.parent_id === null &&
                                !comment.is_published_to_contractor &&
                                !comment.in_crs &&
                                comment.contractor_status === null && (
                                <Button
                                  size="small"
                                  danger
                                  loading={busyCommentId === comment.id}
                                  onClick={async () => {
                                    try {
                                      setBusyCommentId(comment.id);
                                      message.loading({ content: "Удаление замечания...", key: `delete_${comment.id}` });
                                      await deleteOwnerComment(comment.id);
                                      message.success({ content: "Замечание удалено", key: `delete_${comment.id}` });
                                      await loadCard();
                                    } catch (error: unknown) {
                                      const text = error instanceof Error ? error.message : "Не удалось удалить замечание";
                                      message.error({ content: text, key: `delete_${comment.id}` });
                                    } finally {
                                      setBusyCommentId(null);
                                    }
                                  }}
                                >
                                  Удалить
                                </Button>
                              )}
                              {isLatestRow &&
                                comment.parent_id === null &&
                                comment.contractor_status === "I" &&
                                comment.backlog_status !== "LR_FINAL_CONFIRM" && (
                                <Button
                                  size="small"
                                  type="primary"
                                  loading={busyCommentId === comment.id}
                                  onClick={async () => {
                                    try {
                                      setBusyCommentId(comment.id);
                                      message.loading({ content: "Финальное подтверждение...", key: `final_${comment.id}` });
                                      await ownerCommentDecision(comment.id, { action: "FINAL_CONFIRM" });
                                      message.success({ content: "LR финально подтвердил замечание", key: `final_${comment.id}` });
                                      await loadCard();
                                    } catch (error: unknown) {
                                      const text = error instanceof Error ? error.message : "Не удалось финально подтвердить";
                                      message.error({ content: text, key: `final_${comment.id}` });
                                    } finally {
                                      setBusyCommentId(null);
                                    }
                                  }}
                                >
                                  Подтвердить (LR)
                                </Button>
                              )}
                              {/* После «I»-ответа подрядчика LR может либо
                                  финально подтвердить (директивно вернуть в
                                  работу), либо согласиться с подрядчиком и
                                  отклонить замечание — оно перестаёт быть
                                  обязательным к исправлению. */}
                              {isLatestRow &&
                                comment.parent_id === null &&
                                comment.contractor_status === "I" &&
                                comment.backlog_status !== "LR_FINAL_CONFIRM" &&
                                comment.status !== "REJECTED" && (
                                <Button
                                  size="small"
                                  danger
                                  loading={busyCommentId === comment.id}
                                  onClick={async () => {
                                    try {
                                      setBusyCommentId(comment.id);
                                      message.loading({ content: "Отклонение замечания...", key: `withdraw_i_${comment.id}` });
                                      await ownerCommentDecision(comment.id, { action: "REJECT", note: "LR согласился с подрядчиком" });
                                      message.success({ content: "Замечание снято (LR согласился)", key: `withdraw_i_${comment.id}` });
                                      await loadCard();
                                    } catch (error: unknown) {
                                      const text = error instanceof Error ? error.message : "Не удалось отклонить замечание";
                                      message.error({ content: text, key: `withdraw_i_${comment.id}` });
                                    } finally {
                                      setBusyCommentId(null);
                                    }
                                  }}
                                >
                                  Согласиться (отклонить)
                                </Button>
                              )}
                            </Space>
                          ),
                        },
                      ] as const)
                    : []),
                  ]}
                  tableLayout="fixed"
                  scroll={{ x: 1700, y: 260 }}
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
                              {
                                title: "Текст",
                                dataIndex: "text",
                                width: 360,
                                render: (value: string) => (
                                  <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 330, whiteSpace: "nowrap" }}>
                                    {getCleanRemarkText(value)}
                                  </Typography.Text>
                                ),
                              },
                              {
                                title: "Автор",
                                key: "author",
                                width: 180,
                                render: (_, item) => {
                                  const name = item.author_name ?? item.author_email ?? "—";
                                  return (
                                    <Typography.Text ellipsis={{ tooltip: name }} style={{ maxWidth: 160, whiteSpace: "nowrap" }}>
                                      {name}
                                    </Typography.Text>
                                  );
                                },
                              },
                              {
                                title: "Подсказка R",
                                width: 210,
                                render: (_, item) => {
                                  const d = getCarrySuggestion(row.revision_id, item.id);
                                  if (!d) return "—";
                                  return d.status === "R_CLOSED" ? (
                                    <Tag color="green">Автор считает устранено</Tag>
                                  ) : (
                                    <Tag color="red">Автор считает не устранено</Tag>
                                  );
                                },
                              },
                              {
                                title: "Кем подтверждено",
                                width: 180,
                                render: (_, item) => {
                                  const d = (carryDecisionsByRevision[row.revision_id] ?? []).find((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id);
                                  return d?.decided_by_name ?? d?.decided_by_email ?? "—";
                                },
                              },
                              {
                                title: "Когда подтверждено",
                                width: 170,
                                render: (_, item) => {
                                  const d = (carryDecisionsByRevision[row.revision_id] ?? []).find((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id);
                                  return d ? formatDateTimeRu(d.decided_at) : "—";
                                },
                              },
                              {
                                title: "Действие",
                                width: 220,
                                render: (_, item) => (
                                  <Space>
                                    <Tooltip title={isRMatrixReviewer ? "Зафиксировать рекомендацию: по вашему мнению замечание НЕ устранено. LR примет итоговое решение." : "Замечание не устранено — вернуть в работу текущей ревизии"}>
                                    <Button
                                      size="small"
                                      danger={!isRMatrixReviewer}
                                      disabled={!isLatestRow || (carryDecisionsByRevision[row.revision_id] ?? []).some((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id)}
                                      onClick={async () => {
                                        if ((carryDecisionsByRevision[row.revision_id] ?? []).some((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id)) {
                                          message.info("Решение по замечанию уже зафиксировано");
                                          return;
                                        }
                                        const decision = await setCarryDecision(row.revision_id, { source_comment_id: item.id, status: "OPEN" });
                                        setCarryDecisionsByRevision((prev) => ({
                                          ...prev,
                                          [row.revision_id]: [
                                            decision,
                                            ...(prev[row.revision_id] ?? []).filter((x) => x.source_comment_id !== decision.source_comment_id),
                                          ],
                                        }));
                                        if (!isRMatrixReviewer) {
                                          const exists = rowComments.some(
                                            (c) =>
                                              c.parent_id === null &&
                                              c.text === item.text &&
                                              (c.review_code ?? null) === (item.review_code ?? null),
                                          );
                                          if (exists) {
                                            message.info("Такое замечание уже есть в текущей ревизии");
                                          } else {
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
                                            message.success("Решение LR: замечание возвращено в работу текущей ревизии");
                                          }
                                        } else {
                                          message.success("Рекомендация R сохранена: замечание не устранено");
                                        }
                                        await loadCard();
                                      }}
                                    >
                                      {isRMatrixReviewer ? "Не устранено (R)" : "Не устранено (вернуть)"}
                                    </Button>
                                    </Tooltip>
                                    <Tooltip title={isRMatrixReviewer ? "Зафиксировать рекомендацию: по вашему мнению замечание УСТРАНЕНО. LR примет итоговое решение." : "Замечание устранено — подтвердить и закрыть"}>
                                    <Button
                                      size="small"
                                      disabled={!isLatestRow || (carryDecisionsByRevision[row.revision_id] ?? []).some((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id)}
                                      onClick={() => {
                                        if ((carryDecisionsByRevision[row.revision_id] ?? []).some((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id)) {
                                          message.info("Решение по замечанию уже зафиксировано");
                                          return;
                                        }
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
                                            message.success(
                                              isRMatrixReviewer
                                                ? "Рекомендация R сохранена: замечание устранено"
                                                : "Подтверждено: замечание устранено",
                                            );
                                          })
                                          .catch((error: unknown) => {
                                            const text = error instanceof Error ? error.message : "Не удалось сохранить решение";
                                            message.error(text);
                                          });
                                      }}
                                    >
                                      {isRMatrixReviewer ? "Устранено (R)" : "Устранено ✓"}
                                    </Button>
                                    </Tooltip>
                                  </Space>
                                ),
                              },
                            ]}
                            scroll={{ x: 1280, y: 220 }}
                            tableLayout="fixed"
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
                              {
                                title: "Текст",
                                dataIndex: "text",
                                width: 360,
                                render: (value: string) => (
                                  <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 330, whiteSpace: "nowrap" }}>
                                    {getCleanRemarkText(value)}
                                  </Typography.Text>
                                ),
                              },
                              {
                                title: "Автор",
                                key: "author",
                                width: 180,
                                render: (_, item) => {
                                  const name = item.author_name ?? item.author_email ?? "—";
                                  return (
                                    <Typography.Text ellipsis={{ tooltip: name }} style={{ maxWidth: 160, whiteSpace: "nowrap" }}>
                                      {name}
                                    </Typography.Text>
                                  );
                                },
                              },
                              {
                                title: "Подсказка R",
                                width: 210,
                                render: (_, item) => {
                                  const d = getCarrySuggestion(row.revision_id, item.id);
                                  if (!d) return "—";
                                  return d.status === "R_CLOSED" ? (
                                    <Tag color="green">Автор считает устранено</Tag>
                                  ) : (
                                    <Tag color="red">Автор считает не устранено</Tag>
                                  );
                                },
                              },
                              {
                                title: "Кем подтверждено",
                                width: 180,
                                render: (_, item) => {
                                  const d = (carryDecisionsByRevision[row.revision_id] ?? []).find((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id);
                                  return d?.decided_by_name ?? d?.decided_by_email ?? "—";
                                },
                              },
                              {
                                title: "Когда подтверждено",
                                width: 170,
                                render: (_, item) => {
                                  const d = (carryDecisionsByRevision[row.revision_id] ?? []).find((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id);
                                  return d ? formatDateTimeRu(d.decided_at) : "—";
                                },
                              },
                              {
                                title: "Действие",
                                width: 180,
                                render: () => <Typography.Text type="secondary">Зафиксировано</Typography.Text>,
                              },
                            ]}
                            scroll={{ x: 1280, y: 220 }}
                            tableLayout="fixed"
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
                    Код замечаний: {getRevisionRemarksStatus(row.revision_id, row.comments)}
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
        downloadFileName={docDownloadName(card?.document_num, selectedRevision?.revision_code, ".pdf")}
        onClose={() => {
          setPdfAnnotatorOpen(false);
          setPdfFocusCommentId(null);
        }}
        mode={currentUser.company_type === "contractor" ? "contractor_review" : "owner_create"}
        comments={selectedRevisionComments}
        carryOverRemarks={canManageCarryOver ? selectedCarryRemarks : []}
        carryClosedIds={canManageCarryOver ? (carryClosedByRevision[selectedRevisionId] ?? []) : []}
        carryDecidedIds={canManageCarryOver ? selectedCarryDecidedIds : []}
        onCarryClose={canManageCarryOver ? (id) => {
          if ((carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === id)) return;
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
          message.info("Решение уже зафиксировано и не может быть изменено");
        } : undefined}
        onCarryOpen={
          canManageCarryOver
            ? async (item) => {
                if (!selectedRevisionId) return;
                if ((carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => (x.status === "OPEN" || x.status === "CLOSED") && x.source_comment_id === item.id)) return;
                const decision = await setCarryDecision(selectedRevisionId, { source_comment_id: item.id, status: "OPEN" });
                setCarryDecisionsByRevision((prev) => ({
                  ...prev,
                  [selectedRevisionId]: [
                    decision,
                    ...(prev[selectedRevisionId] ?? []).filter((x) => x.source_comment_id !== decision.source_comment_id),
                  ],
                }));
                if (isRMatrixReviewer) {
                  message.success("Рекомендация R сохранена: автор считает, что замечание не устранено");
                  await loadCard();
                  return;
                }
                const exists = selectedRevisionComments.some(
                  (c) =>
                    c.parent_id === null &&
                    c.text === item.text &&
                    (c.review_code ?? null) === (item.review_code ?? null),
                );
                if (exists) {
                  message.info("Такое замечание уже есть в текущей ревизии");
                  await loadCard();
                  return;
                }
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
                message.success("Решение LR: замечание возвращено в OPEN текущей ревизии");
                await loadCard();
              }
            : undefined
        }
        canCreateRemarks={
          (card?.can_current_user_raise_comments ?? true) &&
          !documentCompleted &&
          !rBlockedByNoComments &&
          selectedRevision?.review_code !== "AP"
        }
        canCreateOwnerRemarks={
          canOwnerCreateRemarks &&
          canCommentOnSelectedRevision &&
          !documentCompleted &&
          !rBlockedByNoComments &&
          selectedRevision?.review_code !== "AP"
        }
        canManageOwnerRemarks={
          // Управление замечаниями (Отклонить/Удалить/Вернуть директивно)
          // у LR при UNDER_REVIEW, CONTRACTOR_REPLY_I (надо решить по
          // «I»-ответам подрядчика) и CONTRACTOR_REPLY_A. В режимах
          // OWNER_COMMENTS_SENT мяч у подрядчика — LR ничего не трогает.
          // После AP по ревизии цикл закрыт — никаких действий.
          card?.current_user_matrix_role === "LR" &&
          ownerRemarkManagementStatus &&
          selectedRevision?.review_code !== "AP"
        }
        noAccessHint={
          documentCompleted
            ? "Документ финально согласован (AFD + AP). Добавление замечаний закрыто."
            : rBlockedByNoComments
            ? "Вы отметили «Рассмотрено без замечаний» — добавление замечаний по этой ревизии закрыто. Доступен только просмотр."
            : selectedRevision?.review_code === "AP"
            ? "По ревизии стоит AP — цикл закрыт, изменение замечаний недоступно."
            : !canOwnerCreateRemarks
            ? "Вы не назначены рассматривающим (LR/R) по этому документу. Доступен только просмотр PDF и замечаний."
            : !canCommentOnSelectedRevision
            ? "Замечания можно добавлять только при статусе «На рассмотрении заказчиком». Доступен только просмотр PDF."
            : "Нет прав для создания замечаний."
        }
        focusCommentId={pdfFocusCommentId}
        carryActionMode={carryActionMode}
        carryRHints={carryRHintsBySourceId}
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
