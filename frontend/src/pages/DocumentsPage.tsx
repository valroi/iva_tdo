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
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import {
  addCommentToCrs,
  createComment,
  createRevision,
  getAdminReviewSlaSettings,
  listComments,
  listCarryDecisions,
  listRevisionAttachments,
  listRevisions,
  ownerCommentDecision,
  processRevisionTdoDecision,
  setRevisionReviewCode,
  setCarryDecision,
  downloadRevisionAttachmentsArchive,
  deleteOwnerComment,
  uploadRevisionAttachment,
  uploadRevisionPdf,
  getAuthHeaders,
  getRevisionPdfUrl,
  listNotifications,
  listOwnerReviewQueue,
} from "../api";
import RevisionPdfAnnotator from "../components/RevisionPdfAnnotator";
import ProcessHint from "../components/ProcessHint";
import type { CarryDecisionItem, CommentItem, DocumentAttachmentItem, DocumentItem, MDRRecord, ProjectMember, Revision, User } from "../types";
import { formatDateTimeRu } from "../utils/datetime";
import {
  ContractorReuploadPdfTag,
  RevisionStatusCell,
  contractorNeedsPdfReupload,
} from "../utils/revisionHints";
import { getCleanRemarkText, getDisplayRevisionCode, getRemarksSummaryLabel } from "../utils/revisionProcess";
import {
  PROCESS_STEPS,
  getProcessCurrentStep,
  isContractorResponseAllowedStatus,
  isOwnerCommentLockedStatus,
  isOlderRevision,
  shouldCarryRemark,
  type PreviousRevisionRemark,
} from "../utils/workflowProgress";

const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
pdfjs.GlobalWorkerOptions.workerSrc = `${workerSrc}?v=${pdfjs.version}`;

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
  const normalizeDocNum = (value: string): string => value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(documents[0]?.id ?? null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsByRevision, setCommentsByRevision] = useState<Record<number, CommentItem[]>>({});
  const [previousRevisionRemarks, setPreviousRevisionRemarks] = useState<PreviousRevisionRemark[]>([]);
  const [latestRevisionComments, setLatestRevisionComments] = useState<CommentItem[]>([]);
  const [carryClosedByRevision, setCarryClosedByRevision] = useState<Record<number, number[]>>({});
  const [carryDecisionsByRevision, setCarryDecisionsByRevision] = useState<Record<number, CarryDecisionItem[]>>({});
  const [documentAttachments, setDocumentAttachments] = useState<DocumentAttachmentItem[]>([]);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false);
  const [attachmentsModalOpen, setAttachmentsModalOpen] = useState(false);

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
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [pdfFocusCommentId, setPdfFocusCommentId] = useState<number | null>(null);
  const [allNotifications, setAllNotifications] = useState<
    { event_type: string; revision_id?: number | null; created_at: string; message?: string | null }[]
  >([]);
  const [ownerCanPublishByRevision, setOwnerCanPublishByRevision] = useState<Record<number, boolean>>({});
  const [slaDays, setSlaDays] = useState<{ initial_days: number; owner_specialist_review_days: number } | null>(null);

  const openCommentContext = (row: CommentItem): void => {
    if (currentUser.company_type === "contractor") {
      if (row.revision_id && row.revision_id !== selectedRevisionId) {
        setSelectedRevisionId(row.revision_id);
      }
      setSelectedCommentId(row.id);
      setPdfFocusCommentId(row.id);
      setPdfAnnotatorOpen(true);
      return;
    }
    if (row.revision_id && row.revision_id !== selectedRevisionId) {
      setSelectedRevisionId(row.revision_id);
    }
    setSelectedCommentId(row.id);
    setSelectedCommentForResponse(row);
    setResponsePageNumber(Math.max(1, Math.min(responsePdfPages || 1, row.page ?? 1)));
    setResponsePdfError(null);
    setResponseModalOpen(true);
  };

  const [revForm] = Form.useForm();
  const [responseForm] = Form.useForm();
  const [tdoCancelForm] = Form.useForm<{ note?: string }>();
  const responsePdfUrl = useMemo(
    () => (selectedRevisionId ? getRevisionPdfUrl(selectedRevisionId) : null),
    [selectedRevisionId],
  );
  const responsePdfOptions = useMemo(() => ({ httpHeaders: getAuthHeaders() }), [responseModalOpen]);

  const documentRows = useMemo(() => documents.map((d) => ({ ...d, key: d.id })), [documents]);
  const isDocumentCompleted = (document: DocumentItem): boolean =>
    (document.latest_issue_purpose ?? "").toUpperCase() === "AFD" && document.latest_review_code === "AP";
  const activeDocumentRows = useMemo(() => documentRows.filter((row) => !isDocumentCompleted(row)), [documentRows]);
  const completedDocumentRows = useMemo(() => documentRows.filter((row) => isDocumentCompleted(row)), [documentRows]);
  const selectedDocument = useMemo(
    () => documents.find((item) => item.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );
  const selectedMdr = useMemo(
    () => mdr.find((item) => item.id === (selectedDocument?.mdr_id ?? -1)) ?? null,
    [mdr, selectedDocument],
  );
  const currentCategory = (selectedMdr?.category ?? "").toUpperCase();
  const currentMemberRole = useMemo(
    () => projectMembers.find((m) => m.user_id === currentUser.id)?.member_role ?? null,
    [projectMembers, currentUser.id],
  );
  const canUploadDocumentAttachments = currentMemberRole === "contractor_member";
  const canManageCarryOver = currentUser.role === "admin" || currentUser.company_type === "owner";
  const selectedRevision = useMemo(
    () => revisions.find((item) => item.id === selectedRevisionId) ?? null,
    [revisions, selectedRevisionId],
  );
  const latestRevision = useMemo(() => {
    if (!revisions.length) return null;
    return [...revisions].sort((a, b) => {
      if (a.created_at === b.created_at) return b.id - a.id;
      return a.created_at < b.created_at ? 1 : -1;
    })[0];
  }, [revisions]);
  const latestEffectiveReviewCode = useMemo(
    () => getRemarksSummaryLabel(latestRevisionComments, latestRevision?.review_code ?? null),
    [latestRevisionComments, latestRevision?.review_code],
  );
  const isLatestSelected = selectedRevisionId !== null && latestRevision?.id === selectedRevisionId;
  const ownerCommentLocked = isOwnerCommentLockedStatus(selectedRevision?.status);
  const contractorCanRespondNow = isContractorResponseAllowedStatus(selectedRevision?.status);
  const selectedDocumentCompleted = useMemo(() => {
    if (selectedDocument && isDocumentCompleted(selectedDocument)) return true;
    if (!latestRevision) return false;
    return (latestRevision.issue_purpose ?? "").toUpperCase() === "AFD" && latestRevision.review_code === "AP";
  }, [selectedDocument, latestRevision]);
  const canOwnerPublishToCrs =
    currentUser.role === "admin" ||
    (currentUser.permissions.can_publish_comments && Boolean(ownerCanPublishByRevision[selectedRevisionId ?? -1]));
  const selectedCarryDecidedIds =
    selectedRevisionId !== null
      ? (carryDecisionsByRevision[selectedRevisionId] ?? []).map((item) => item.source_comment_id)
      : [];
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
  const contractorAuthorOptions = useMemo(
    () =>
      projectMembers
        .filter(
          (member) =>
            member.member_role === "contractor_member" ||
            member.member_role === "contractor_tdo_lead" ||
            member.user_company_type === "contractor",
        )
        .map((member) => ({
          value: member.user_id,
          label: `${member.user_full_name ?? "Пользователь"} (${member.user_email ?? "—"})`,
        })),
    [projectMembers],
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

  const progressMilestones = useMemo(() => {
    const addDays = (value: string | null | undefined, days: number): string => {
      if (!value) return "—";
      const base = new Date(value);
      if (Number.isNaN(base.getTime())) return "—";
      const dt = new Date(base);
      dt.setDate(dt.getDate() + Math.max(0, Math.ceil(days)));
      return dt.toISOString().slice(0, 10);
    };
    const revA = revisions.find((rev) => rev.revision_code.toUpperCase() === "A" && rev.issue_purpose.toUpperCase() === "IFR") ?? null;
    const revB = revisions.find((rev) => rev.revision_code.toUpperCase() === "B" && rev.issue_purpose.toUpperCase() === "IFR") ?? null;
    const rev00 = revisions.find((rev) => rev.revision_code === "00" && rev.issue_purpose.toUpperCase() === "IFD") ?? null;
    const planStart = selectedMdr?.planned_dev_start ?? null;
    const initialDays = slaDays?.initial_days ?? 14;
    const ownerReviewDays = slaDays?.owner_specialist_review_days ?? 8;
    const plan70 = planStart ?? "—";
    const plan75 = plan70 !== "—" ? addDays(plan70, ownerReviewDays) : "—";
    const plan80 = plan75 !== "—" ? addDays(plan75, initialDays) : "—";
    const plan85 = plan80 !== "—" ? addDays(plan80, ownerReviewDays) : "—";
    const plan90 = plan85 !== "—" ? addDays(plan85, initialDays) : "—";
    const plan100 = plan90 !== "—" ? addDays(plan90, ownerReviewDays) : "—";
    const cycles85 = revisions.filter((rev) => rev.review_code && rev.review_code !== "AP").length;
    const latestReviewCode = [...revisions].reverse().find((rev) => rev.review_code)?.review_code ?? null;
    const latestCreated = revisions.length > 0 ? revisions[revisions.length - 1].created_at : null;
    const forecast100 =
      latestRevision?.status === "CONTRACTOR_REPLY_I"
        ? addDays(latestCreated, 2)
        : latestRevision?.status === "OWNER_COMMENTS_SENT"
          ? addDays(latestCreated, 8)
          : latestRevision?.status === "UNDER_REVIEW"
            ? addDays(latestCreated, 10)
            : plan100;
    const factBySentToOwner = (rev: Revision | null): string => {
      if (!rev) return "—";
      if (rev.reviewed_at) return formatDateTimeRu(rev.reviewed_at);
      const tdoEvent = allNotifications.find((n) => n.event_type === "TDO_SENT_TO_OWNER" && n.revision_id === rev.id);
      return tdoEvent ? formatDateTimeRu(tdoEvent.created_at) : "—";
    };
    const autoCrsByRevision = (rev: Revision | null): string | null => {
      if (!rev) return null;
      const notif = allNotifications.find(
        (n) => n.event_type === "OWNER_COMMENTS_PUBLISHED" && n.revision_id === rev.id && (n.message ?? "").includes("CRS:"),
      );
      const match = notif?.message?.match(/CRS:\s*([A-Z0-9-]+)/);
      return match?.[1] ?? null;
    };
    const fact70 = (() => {
      if (!revA) return "—";
      return factBySentToOwner(revA);
    })();
    const fact75 = (() => {
      if (!revA) return "—";
      if (!(revA.status === "CONTRACTOR_REPLY_A" || revA.status === "SUBMITTED")) return "—";
      const revAComments = commentsByRevision[revA.id] ?? [];
      const responseDates = revAComments
        .filter(
          (c) =>
            c.parent_id === null &&
            c.is_published_to_contractor &&
            (c.status === "RESOLVED" || c.status === "REJECTED"),
        )
        .map((c) => new Date((c.resolved_at ?? c.contractor_response_at ?? c.created_at) as string).getTime())
        .filter((v) => !Number.isNaN(v));
      if (responseDates.length > 0) {
        return formatDateTimeRu(new Date(Math.max(...responseDates)).toISOString());
      }
      return "—";
    })();
    return [
      { key: "70", step: "Выпуск ревизии A (IFR)", progress: "70%", plan: formatDateRu(plan70), forecast: formatDateRu(plan70), trm: revA?.trm_number ?? "—", fact: fact70 },
      {
        key: "75",
        step: "Рассмотрение заказчиком ревизии A",
        progress: "75%",
        plan: formatDateRu(plan75),
        forecast: formatDateRu(plan75),
        trm:
          (Array.from(new Set((commentsByRevision[revA?.id ?? -1] ?? []).map((c) => c.crs_number).filter(Boolean))).join(", ") ||
            revA?.trm_number) ??
          "—",
        fact: fact75,
      },
      { key: "80", step: "Выпуск ревизии B (IFR)", progress: "80%", plan: formatDateRu(plan80), forecast: formatDateRu(plan80), trm: revB?.trm_number ?? "—", fact: factBySentToOwner(revB) },
      {
        key: "85",
        step: "Рассмотрение заказчиком (циклы до AP)",
        progress: "85%",
        plan: formatDateRu(plan85),
        forecast: formatDateRu(plan85),
        trm:
          (Array.from(new Set((commentsByRevision[revB?.id ?? -1] ?? []).map((c) => c.crs_number).filter(Boolean))).join(", ") ||
            revB?.trm_number) ??
          "—",
        fact: `${revB?.status === "OWNER_COMMENTS_SENT" || revB?.status === "CONTRACTOR_REPLY_A" || revB?.status === "SUBMITTED" ? formatDateTimeRu(revB.created_at) : "—"}${cycles85 > 0 ? ` · циклов: ${cycles85}` : ""}${latestReviewCode ? ` · код: ${latestReviewCode}` : ""}`,
      },
      { key: "90", step: "Выпуск ревизии 00 (IFD)", progress: "90%", plan: formatDateRu(plan90), forecast: formatDateRu(plan90), trm: rev00?.trm_number ?? "—", fact: factBySentToOwner(rev00) },
      {
        key: "100",
        step: "Получение согласования от заказчика",
        progress: "100%",
        plan: formatDateRu(plan100),
        forecast: formatDateRu(forecast100),
        trm: autoCrsByRevision(rev00) ?? rev00?.trm_number ?? "—",
        fact: revisions.some((r) => r.review_code === "AP" && (r.issue_purpose ?? "").toUpperCase() === "AFD")
          ? formatDateTimeRu(
              revisions.find((r) => r.review_code === "AP" && (r.issue_purpose ?? "").toUpperCase() === "AFD")?.reviewed_at ??
                revisions.find((r) => r.review_code === "AP" && (r.issue_purpose ?? "").toUpperCase() === "AFD")?.created_at ??
                null,
            )
          : "—",
      },
    ];
  }, [allNotifications, commentsByRevision, formatDateRu, latestRevision?.status, revisions, selectedMdr?.planned_dev_start, slaDays?.initial_days, slaDays?.owner_specialist_review_days]);

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
    if (latestRevision && latestEffectiveReviewCode === "RJ") {
      revForm.setFieldValue("revision_code", latestRevision.revision_code);
      return;
    }
    const normalized = issuePurpose.toUpperCase();
    if (normalized === "IFR") {
      revForm.setFieldValue("revision_code", computeNextAlphabeticRevision());
      return;
    }
    revForm.setFieldValue("revision_code", computeNextNumericRevision());
  };

  useEffect(() => {
    listNotifications().then(setAllNotifications).catch(() => setAllNotifications([]));
  }, []);

  useEffect(() => {
    getAdminReviewSlaSettings()
      .then((item) => {
        setSlaDays({
          initial_days: item.initial_days,
          owner_specialist_review_days: item.owner_specialist_review_days,
        });
      })
      .catch(() => setSlaDays(null));
  }, []);

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
    const targetNormalized = normalizeDocNum(notificationTarget.document_num);
    const targetDoc = documents.find((item) => normalizeDocNum(item.document_num) === targetNormalized);
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
    if (currentUser.company_type !== "owner" || !currentUser.permissions.can_publish_comments) {
      setOwnerCanPublishByRevision({});
      return;
    }
    let cancelled = false;
    listOwnerReviewQueue()
      .then((rows) => {
        if (cancelled) return;
        const mapped: Record<number, boolean> = {};
        rows.forEach((row) => {
          mapped[row.revision_id] = row.can_publish_to_contractor;
        });
        setOwnerCanPublishByRevision(mapped);
      })
      .catch(() => {
        if (!cancelled) setOwnerCanPublishByRevision({});
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.company_type, currentUser.permissions.can_publish_comments]);

  useEffect(() => {
    if (!revisions.length) {
      setCommentsByRevision({});
      return;
    }
    Promise.all(
      revisions.map(async (rev) => {
        try {
          const items = await listComments(rev.id);
          return [rev.id, items] as const;
        } catch {
          return [rev.id, []] as const;
        }
      }),
    ).then((pairs) => {
      const next: Record<number, CommentItem[]> = {};
      for (const [id, items] of pairs) {
        next[id] = items;
      }
      setCommentsByRevision(next);
    });
  }, [revisions]);

  useEffect(() => {
    if (!latestRevision?.id) {
      setLatestRevisionComments([]);
      return;
    }
    listComments(latestRevision.id)
      .then(setLatestRevisionComments)
      .catch(() => setLatestRevisionComments([]));
  }, [latestRevision?.id]);

  useEffect(() => {
    if (!selectedRevisionId || !canManageCarryOver || !selectedRevision) return;
    listCarryDecisions(selectedRevisionId)
      .then((merged) => {
        const closed = merged.filter((item) => item.status === "CLOSED").map((item) => item.source_comment_id);
        setCarryClosedByRevision((prev) => ({ ...prev, [selectedRevisionId]: closed }));
        setCarryDecisionsByRevision((prev) => ({ ...prev, [selectedRevisionId]: merged }));
      })
      .catch(() => {
        setCarryClosedByRevision((prev) => ({ ...prev, [selectedRevisionId]: [] }));
        setCarryDecisionsByRevision((prev) => ({ ...prev, [selectedRevisionId]: [] }));
      });
  }, [selectedRevisionId, canManageCarryOver, selectedRevision, revisions]);

  useEffect(() => {
    if (!selectedRevisionId) {
      setDocumentAttachments([]);
      return;
    }
    listRevisionAttachments(selectedRevisionId)
      .then(setDocumentAttachments)
      .catch(() => setDocumentAttachments([]));
  }, [selectedRevisionId]);


  const reloadRevisionContext = async (revisionId: number): Promise<void> => {
    if (!selectedDocumentId) return;
    const [revisionItems, commentItems] = await Promise.all([listRevisions(selectedDocumentId), listComments(revisionId)]);
    setRevisions(revisionItems);
    setComments(commentItems);
  };

  useEffect(() => {
    if (!selectedRevision || revisions.length === 0) {
      setPreviousRevisionRemarks([]);
      return;
    }
    const previous = revisions
      .filter((item) => isOlderRevision(item, selectedRevision))
      .sort((a, b) => {
        if (a.created_at === b.created_at) return b.id - a.id;
        return a.created_at < b.created_at ? 1 : -1;
      })[0];
    if (!previous) {
      setPreviousRevisionRemarks([]);
      return;
    }
    listComments(previous.id)
      .then((items) => {
        const merged = items
          .filter((c) => c.parent_id === null && shouldCarryRemark(c.status) && !c.carry_finalized)
          .map((c) => ({
            id: c.id,
            revision_id: previous.id,
            revision_code: previous.revision_code,
            status: c.status,
            review_code: c.review_code ?? null,
            text: c.text,
            created_at: c.created_at,
          }))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        setPreviousRevisionRemarks(merged);
      })
      .catch(() => setPreviousRevisionRemarks([]));
  }, [revisions, selectedRevision]);

  useEffect(() => {
    if (!revModalOpen) return;
    const canUseIfd = issuePurposeOptions.includes("IFD");
    const defaultPurpose =
      latestRevision?.review_code === "AP" && canUseIfd
        ? "IFD"
        : issuePurposeOptions[0] ?? "IFR";
    revForm.setFieldValue("issue_purpose", defaultPurpose);
    applyAutoRevision(defaultPurpose);
  }, [revModalOpen, selectedDocumentId, issuePurposeOptions, revisions, latestRevision?.review_code]);

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
    {
      title: "Название",
      dataIndex: "title",
      key: "title",
      width: 240,
      ellipsis: true,
      render: (value: string) => (
        <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 220 }}>
          {value}
        </Typography.Text>
      ),
    },
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
      render: (_, row) => (
        <Space direction="vertical" size={2} style={{ maxWidth: 200 }}>
          <Typography.Text ellipsis={{ tooltip: row.latest_revision_status ?? "—" }}>
            {row.latest_revision_status ?? "—"}
          </Typography.Text>
          {contractorNeedsPdfReupload(currentUser, row.latest_revision_status ?? undefined) && (
            <ContractorReuploadPdfTag />
          )}
        </Space>
      ),
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
      width: 180,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setSelectedDocumentId(row.id)}>
            Открыть
          </Button>
          <Button
            size="small"
            onClick={() => {
              setSelectedDocumentId(row.id);
              setProgressModalOpen(true);
            }}
          >
            Прогресс
          </Button>
        </Space>
      ),
    },
  ];

  const revisionColumns: ColumnsType<Revision> = [
    {
      title: "Рев",
      key: "revision_code",
      render: (_, row) => getDisplayRevisionCode(row, revisions),
    },
    { title: "Цель", dataIndex: "issue_purpose", key: "issue_purpose" },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      render: (value: string, row) => {
        if ((row.issue_purpose ?? "").toUpperCase() === "AFD" && row.review_code === "AP") {
          return <Tag color="success">Документ завершен (100%)</Tag>;
        }
        if (
          currentUser.company_type === "contractor" &&
          (value === "REVISION_CREATED" || value === "UPLOADED_WAITING_TDO")
        ) {
          return (
            <Space direction="vertical" size={2}>
              <Tag color="gold">{value}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Не отправлено в TRM
              </Typography.Text>
            </Space>
          );
        }
        if (currentUser.company_type === "owner" && value === "UPLOADED_WAITING_TDO") {
          return (
            <Space direction="vertical" size={2}>
              <Tag color="blue">{value}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Доступно после TRM
              </Typography.Text>
            </Space>
          );
        }
        if (currentUser.company_type === "contractor" && value === "CANCELLED_BY_TDO") {
          return <RevisionStatusCell currentUser={currentUser} status={value} />;
        }
        return <RevisionStatusCell currentUser={currentUser} status={value} />;
      },
    },
    {
      title: "Срок обсуждения",
      dataIndex: "review_deadline",
      key: "review_deadline",
      render: (value: string | null) => formatDateTimeRu(value),
    },
    {
      title: "Файл",
      dataIndex: "file_path",
      key: "file_path",
      render: (_value: string | null, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text ellipsis={{ tooltip: row.file_path ? `${selectedDocument?.document_num ?? "DOC"}_rev_${row.revision_code}.pdf` : undefined }}>
            {row.file_path ? `${selectedDocument?.document_num ?? "DOC"}_rev_${row.revision_code}.pdf` : "—"}
          </Typography.Text>
          {contractorNeedsPdfReupload(currentUser, row.status) && <ContractorReuploadPdfTag />}
        </Space>
      ),
    },
  ];
  revisionColumns.push({
    title: "Действие",
    key: "action",
    width: 260,
    render: (_, row) => (
      <Space direction="vertical" size={6}>
        <Space wrap size={[8, 8]}>
          <Button
            size="small"
            onClick={() => {
              setSelectedRevisionId(row.id);
              setPdfAnnotatorOpen(true);
            }}
            disabled={!row.file_path}
          >
            Открыть
          </Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={async (event) => {
              event.stopPropagation();
              try {
                await downloadRevisionAttachmentsArchive(row.id, selectedDocument?.document_num ?? "document");
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
              disabled={
                selectedDocumentCompleted ||
                currentUser.company_type === "contractor" &&
                !["REVISION_CREATED", "UPLOADED_WAITING_TDO", "CANCELLED_BY_TDO"].includes(row.status)
              }
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
                disabled={selectedDocumentCompleted}
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
                disabled={selectedDocumentCompleted}
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
          {(row.id === latestRevision?.id &&
            row.review_code !== "AP" &&
            (currentUser.role === "admin" || (currentUser.company_type === "owner" && currentUser.permissions.can_publish_comments))) &&
            (() => {
              const rowComments = commentsByRevision[row.id];
              const activeCount = (rowComments ?? []).filter(
                (c) =>
                  c.parent_id === null &&
                  c.is_published_to_contractor &&
                  c.status !== "REJECTED" &&
                  (c.status === "OPEN" || c.status === "IN_PROGRESS"),
              ).length;
              const carryOpenCount =
                selectedRevisionId === row.id && isLatestSelected
                  ? previousRevisionRemarks.filter(
                      (r) => r.status === "RESOLVED" && !(carryClosedByRevision[row.id] ?? []).includes(r.id),
                    ).length
                  : 0;
              const apDisabled = !rowComments || activeCount > 0 || carryOpenCount > 0;
              return (
                <Tooltip
                  title={
                    !rowComments
                      ? "Проверяем замечания ревизии..."
                      : activeCount > 0
                      ? `Нельзя поставить AP: активных замечаний ${activeCount}`
                      : carryOpenCount > 0
                      ? `Нельзя поставить AP: в "Должны были устранить" осталось ${carryOpenCount}`
                      : "Все замечания закрыты/отклонены, можно поставить AP"
                  }
                >
                  <Button
                    size="small"
                    disabled={apDisabled}
                    onClick={async (event) => {
                      event.stopPropagation();
                      try {
                        await setRevisionReviewCode(row.id, "AP");
                        message.success("Для ревизии установлен статус AP");
                        if (selectedDocumentId) {
                          const revs = await listRevisions(selectedDocumentId);
                          setRevisions(revs);
                        }
                        if (selectedRevisionId === row.id) {
                          setComments(await listComments(row.id));
                        }
                      } catch (error: unknown) {
                        const text = error instanceof Error ? error.message : "Не удалось установить AP";
                        message.error(text);
                      }
                    }}
                  >
                    Поставить AP
                  </Button>
                </Tooltip>
              );
            })()}
        </Space>
        {contractorNeedsPdfReupload(currentUser, row.status) && <ContractorReuploadPdfTag />}
      </Space>
    ),
  });

  const commentColumns: ColumnsType<CommentItem> = [
    {
      title: "Код замечания",
      key: "review_code",
      width: 130,
      render: (_: unknown, row: CommentItem) => row.review_code ?? "—",
    },
    {
      title: "Автор замечания",
      key: "author_name",
      width: 180,
      render: (_: unknown, row: CommentItem) => row.author_name ?? row.author_email ?? "—",
    },
    {
      title: "CRS",
      key: "crs_number",
      width: 150,
      render: (_: unknown, row: CommentItem) => row.crs_number ?? (row.in_crs ? "В CRS" : "—"),
    },
    {
      title: "Дата CRS",
      key: "crs_sent_at",
      width: 160,
      render: (_: unknown, row: CommentItem) => formatDateTimeRu(row.crs_sent_at),
    },
    {
      title: "Замечание",
      dataIndex: "text",
      key: "text",
      width: 240,
      render: (value: string, row) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => openCommentContext(row)}>
          <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 220 }}>
            {getCleanRemarkText(value)}
          </Typography.Text>
        </Button>
      ),
    },
    {
      title: "Статус замечания",
      dataIndex: "status",
      key: "status",
      width: 160,
      render: (value: CommentItem["status"]) => {
        const colorMap: Record<CommentItem["status"], string> = {
          OPEN: "default",
          IN_PROGRESS: "processing",
          RESOLVED: "success",
          REJECTED: "error",
        };
        const titleMap: Record<CommentItem["status"], string> = {
          OPEN: "Открыто",
          IN_PROGRESS: "В работе",
          RESOLVED: "Будет учтено в новой ревизии",
          REJECTED: "Отклонено LR",
        };
        return <Tag color={colorMap[value]}>{titleMap[value]}</Tag>;
      },
    },
    {
      title: "Статус подрядчика",
      key: "contractor_status",
      width: 160,
      render: (_: unknown, row: CommentItem) => (row.contractor_status === "I" ? "I - На обсуждении" : row.contractor_status === "A" ? "A - Принято" : "—"),
    },
    {
      title: "Ответ подрядчика",
      key: "contractor_response_text",
      width: 240,
      render: (_: unknown, row: CommentItem) => row.contractor_response_text ?? "—",
    },
    {
      title: "Дата ответа",
      key: "contractor_response_at",
      width: 170,
      render: (_: unknown, row: CommentItem) => formatDateTimeRu(row.contractor_response_at),
    },
    { title: "Лист", dataIndex: "page", key: "page", width: 80, render: (value: number | null) => value ?? "—" },
    {
      title: "Действие",
      key: "action",
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => openCommentContext(row)}>
            Открыть в PDF
          </Button>
          {currentUser.permissions.can_respond_comments && currentUser.company_type === "contractor" && (
            <Button
              size="small"
              disabled={
                selectedDocumentCompleted ||
                row.author_id === currentUser.id ||
                !(row.contractor_status === null || (row.contractor_status === "I" && row.backlog_status === "LR_FINAL_CONFIRM")) ||
                !contractorCanRespondNow
              }
              onClick={() => openCommentContext(row)}
            >
              Ответить
            </Button>
          )}
          {canOwnerPublishToCrs &&
            isLatestSelected &&
            !selectedDocumentCompleted &&
            row.parent_id === null &&
            (row.status === "OPEN" || row.status === "IN_PROGRESS") &&
            !row.is_published_to_contractor &&
            row.contractor_status === null &&
            !row.in_crs && (
            <Button
              size="small"
              onClick={async () => {
                if (!selectedRevisionId) return;
                try {
                  await addCommentToCrs(row.id);
                  message.success("Замечание добавлено в CRS");
                  await reloadRevisionContext(selectedRevisionId);
                } catch (error: unknown) {
                  const text = error instanceof Error ? error.message : "Не удалось добавить замечание в CRS";
                  message.error(text);
                }
              }}
            >
              Добавить в CRS
            </Button>
          )}
          {canOwnerPublishToCrs &&
            isLatestSelected &&
            !selectedDocumentCompleted &&
            row.parent_id === null &&
            !row.is_published_to_contractor &&
            !row.in_crs &&
            row.contractor_status === null &&
            (row.status === "OPEN" || row.status === "IN_PROGRESS") && (
            <Button
              size="small"
              danger
              onClick={async () => {
                if (!selectedRevisionId) return;
                try {
                  await ownerCommentDecision(row.id, { action: "REJECT", note: "Снято LR" });
                  message.success("Замечание отклонено LR");
                  await reloadRevisionContext(selectedRevisionId);
                } catch (error: unknown) {
                  const text = error instanceof Error ? error.message : "Не удалось отклонить замечание";
                  message.error(text);
                }
              }}
            >
              Отклонить
            </Button>
          )}
          {currentUser.permissions.can_publish_comments &&
            currentUser.company_type === "owner" &&
            isLatestSelected &&
            !selectedDocumentCompleted &&
            row.parent_id === null &&
            !row.is_published_to_contractor &&
            !row.in_crs &&
            row.contractor_status === null &&
            row.status === "REJECTED" && (
            <Button
              size="small"
              onClick={async () => {
                if (!selectedRevisionId) return;
                try {
                  await ownerCommentDecision(row.id, { action: "REOPEN", note: "Возврат в работу" });
                  message.success("Замечание возвращено в работу");
                  await reloadRevisionContext(selectedRevisionId);
                } catch (error: unknown) {
                  const text = error instanceof Error ? error.message : "Не удалось вернуть замечание";
                  message.error(text);
                }
              }}
            >
              Вернуть в работу
            </Button>
          )}
          {currentUser.permissions.can_publish_comments &&
            currentUser.company_type === "owner" &&
            isLatestSelected &&
            !selectedDocumentCompleted &&
            row.parent_id === null &&
            !row.is_published_to_contractor &&
            !row.in_crs &&
            row.contractor_status === null && (
            <Button
              size="small"
              danger
              onClick={async () => {
                if (!selectedRevisionId) return;
                try {
                  await deleteOwnerComment(row.id);
                  message.success("Замечание удалено");
                  await reloadRevisionContext(selectedRevisionId);
                } catch (error: unknown) {
                  const text = error instanceof Error ? error.message : "Не удалось удалить замечание";
                  message.error(text);
                }
              }}
            >
              Удалить
            </Button>
          )}
          {canOwnerPublishToCrs &&
            isLatestSelected &&
            !selectedDocumentCompleted &&
            row.parent_id === null &&
            row.contractor_status === "I" &&
            row.backlog_status !== "LR_FINAL_CONFIRM" && (
            <Button
              size="small"
              onClick={async () => {
                if (!selectedRevisionId) return;
                try {
                  await ownerCommentDecision(row.id, { action: "FINAL_CONFIRM" });
                  message.success("LR финально подтвердил замечание");
                  await reloadRevisionContext(selectedRevisionId);
                } catch (error: unknown) {
                  const text = error instanceof Error ? error.message : "Не удалось финально подтвердить";
                  message.error(text);
                }
              }}
            >
              Финально подтвердить (LR)
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
    if (!currentUser.permissions.can_upload_files) {
      message.error("Недостаточно прав для создания ревизии");
      return;
    }
    if (selectedDocumentCompleted) {
      message.warning("Документ завершен (AFD + AP). Создание новой ревизии заблокировано.");
      return;
    }
    try {
      const values = await revForm.validateFields();
      if (
        latestRevision &&
        latestEffectiveReviewCode === "RJ" &&
        (values.revision_code !== latestRevision.revision_code ||
          String(values.issue_purpose ?? "").toUpperCase() !== String(latestRevision.issue_purpose ?? "").toUpperCase())
      ) {
        message.error("После кода RJ документ должен перевыпускаться в той же ревизии и с той же целью выпуска");
        return;
      }
      await createRevision({ ...values, document_id: selectedDocumentId });
      setRevModalOpen(false);
      revForm.resetFields();
      const items = await listRevisions(selectedDocumentId);
      setRevisions(items);
      const nextSelected = [...items].sort((a, b) => {
        if (a.created_at === b.created_at) return b.id - a.id;
        return a.created_at < b.created_at ? 1 : -1;
      })[0];
      if (nextSelected) {
        setSelectedRevisionId(nextSelected.id);
      }
      message.success("Ревизия создана");
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Не удалось создать ревизию";
      message.error(text);
    }
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
    if (selectedDocumentCompleted) {
      message.warning("Документ завершен (AFD + AP). Загрузка PDF заблокирована.");
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

  const submitAttachmentUpload = async () => {
    if (!selectedRevisionId || !attachmentFile) {
      message.warning("Выберите ревизию и файл");
      return;
    }
    if (selectedDocumentCompleted) {
      message.warning("Документ завершен (AFD + AP). Загрузка файлов заблокирована.");
      return;
    }
    setAttachmentUploadBusy(true);
    try {
      await uploadRevisionAttachment(selectedRevisionId, attachmentFile);
      message.success("Файл ревизии загружен");
      setAttachmentFile(null);
      setDocumentAttachments(await listRevisionAttachments(selectedRevisionId));
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить файл";
      message.error(text);
    } finally {
      setAttachmentUploadBusy(false);
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Ревизии и комментарии
        </Typography.Title>
        {currentUser.permissions.can_upload_files && (
          <Tooltip title="Создать новую ревизию для выбранного документа">
            <Button onClick={() => setRevModalOpen(true)} disabled={!selectedDocumentId || selectedDocumentCompleted}>
              + Ревизия
            </Button>
          </Tooltip>
        )}
        {currentUser.permissions.can_raise_comments && (
          <Tooltip title="Открыть PDF и добавить замечание в текущую ревизию">
            <Button
              onClick={() => setPdfAnnotatorOpen(true)}
              disabled={!selectedRevisionId || ownerCommentLocked || selectedDocumentCompleted || !selectedRevision?.file_path}
            >
              + Вопрос/замечание
            </Button>
          </Tooltip>
        )}
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать с ревизией"
        steps={[
          "Выберите строку ревизии в таблице, чтобы активировать действия и комментарии.",
          "Сначала загрузите основной PDF (кнопка PDF), затем открывайте просмотрщик и работайте с замечаниями.",
          "Доп. файлы привязаны к текущей ревизии: откройте «Файлы ревизии», выберите файл и нажмите «Загрузить».",
          "CRS/TRM/AP доступны только для актуальной ревизии и по ролям.",
        ]}
      />

      <Row gutter={16}>
        <Col span={10}>
          <Card title="Документы">
            <Tabs
              items={[
                {
                  key: "docs_active",
                  label: `В работе (${activeDocumentRows.length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      className="documents-table"
                      columns={documentColumns}
                      dataSource={activeDocumentRows}
                      pagination={false}
                      tableLayout="fixed"
                      scroll={{ x: 1250 }}
                      locale={{ emptyText: "Документы в работе не найдены." }}
                    />
                  ),
                },
                {
                  key: "docs_done",
                  label: `Завершенные документы (${completedDocumentRows.length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      className="documents-table"
                      columns={documentColumns}
                      dataSource={completedDocumentRows}
                      pagination={false}
                      tableLayout="fixed"
                      scroll={{ x: 1250 }}
                      locale={{ emptyText: "Завершенные документы пока отсутствуют." }}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col span={14}>
          <Card title={selectedDocument ? `Карточка документа: ${selectedDocument.document_num}` : "Карточка документа"}>
            {selectedDocument && selectedMdr ? (
              <>
                <Descriptions size="small" column={1} style={{ marginBottom: 10 }}>
                  <Descriptions.Item label="Наименование">
                    <Typography.Text ellipsis={{ tooltip: selectedDocument.title }} style={{ maxWidth: 520 }}>
                      {selectedDocument.title}
                    </Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Дисциплина">{selectedDocument.discipline}</Descriptions.Item>
                  <Descriptions.Item label="Категория">{selectedMdr.category}</Descriptions.Item>
                  <Descriptions.Item label="Титульный объект">{selectedMdr.title_object}</Descriptions.Item>
                  <Descriptions.Item label="Шифр">{selectedMdr.doc_number}</Descriptions.Item>
                  <Descriptions.Item label="ID">{selectedMdr.document_key}</Descriptions.Item>
                </Descriptions>
                <Space direction="vertical" size={4}>
                  {selectedDocumentCompleted && (
                    <Alert
                      type="success"
                      showIcon
                      message="Документ завершен (100%)"
                      description="AFD + AP зафиксированы. Комментирование и загрузки по документу заблокированы."
                    />
                  )}
                  <Typography.Text type="secondary">
                    PDF прикрепляется к ревизии через кнопку <b>PDF</b> в таблице ревизий.
                  </Typography.Text>
                  <Space size={8} wrap>
                    <Tooltip title="Загрузка и просмотр доп. файлов только выбранной ревизии">
                      <Button size="small" onClick={() => setAttachmentsModalOpen(true)} disabled={!selectedRevisionId || selectedDocumentCompleted}>
                        Файлы ревизии
                      </Button>
                    </Tooltip>
                    <Typography.Text type="secondary">
                      Доп. файлы ревизии: {documentAttachments.length}
                    </Typography.Text>
                  </Space>
                  {selectedRevision?.file_path && (
                    <>
                      <Tooltip title="Открыть основной PDF текущей ревизии">
                        <Button type="default" size="small" onClick={() => setPdfAnnotatorOpen(true)}>
                          Открыть документ
                        </Button>
                      </Tooltip>
                      <Tooltip title="Показать этапы процесса и текущий шаг">
                        <Button type="default" size="small" onClick={() => setProgressModalOpen(true)}>
                          Прогресс
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </Space>
                {selectedRevision && (
                  <div style={{ marginTop: 12 }}>
                    <Space direction="vertical" size={2}>
                      <Typography.Text type="secondary">Workflow ревизии:</Typography.Text>
                      <Typography.Text type="secondary">Последний статус по документу: {latestRevision?.status ?? "—"}</Typography.Text>
                      <Space size={6}>
                        <Typography.Text type="secondary">Код замечаний (по выбранной ревизии):</Typography.Text>
                        {(() => {
                          const code = getRemarksSummaryLabel(comments, selectedRevision?.review_code ?? null);
                          return <Tag color={code === "AP" ? "success" : "default"}>{code}</Tag>;
                        })()}
                      </Space>
                    </Space>
                    <Steps
                      size="small"
                      current={getProcessCurrentStep((latestRevision ?? selectedRevision).status)}
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
            {contractorNeedsPdfReupload(currentUser, selectedRevision?.status) && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 10 }}
                message="Требуется перезагрузка PDF"
                description="Руководитель ТДО отклонил текущую загрузку. Нажмите «PDF» в строке ревизии и загрузите исправленный файл."
              />
            )}
            <Table
              rowKey="id"
              size="small"
              columns={revisionColumns}
              dataSource={revisions}
              pagination={false}
              scroll={{ x: 980 }}
              onRow={(record) => ({
                onClick: () => setSelectedRevisionId(record.id),
                style: { cursor: "pointer" },
              })}
              locale={{ emptyText: "Ревизий пока нет. Создайте ревизию кнопкой '+ Ревизия'." }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title={`Замечания и обсуждение (ревизия: ${selectedRevisionId ?? "—"})`}>
            <Tabs
              items={[
                {
                  key: "work",
                  label: `В работе (${comments.filter((item) => item.status === "OPEN" || item.status === "IN_PROGRESS").length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      columns={commentColumns}
                      dataSource={comments.filter((item) => item.status === "OPEN" || item.status === "IN_PROGRESS")}
                      pagination={false}
                      scroll={{ x: "max-content", y: 220 }}
                      locale={{ emptyText: "Нет замечаний в работе по выбранной ревизии." }}
                    />
                  ),
                },
                {
                  key: "resolved",
                  label: `Будет учтено (${comments.filter((item) => item.status === "RESOLVED").length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      columns={commentColumns}
                      dataSource={comments.filter((item) => item.status === "RESOLVED")}
                      pagination={false}
                      scroll={{ x: "max-content", y: 220 }}
                      locale={{ emptyText: "Нет замечаний со статусом 'Будет учтено'." }}
                    />
                  ),
                },
                {
                  key: "rejected",
                  label: `Отклонено LR (${comments.filter((item) => item.status === "REJECTED").length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      columns={commentColumns}
                      dataSource={comments.filter((item) => item.status === "REJECTED")}
                      pagination={false}
                      scroll={{ x: "max-content", y: 220 }}
                      locale={{ emptyText: "Нет замечаний, отклоненных LR." }}
                    />
                  ),
                },
              ]}
            />
            {canManageCarryOver && isLatestSelected && previousRevisionRemarks.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Typography.Text type="secondary">
                  Нерешенные замечания из прошлых ревизий (для учета в новой ревизии):
                </Typography.Text>
                <Tabs
                  style={{ marginTop: 10 }}
                  items={[
                      {
                        key: "carry_open",
                        label: `Должны были устранить (${previousRevisionRemarks.filter((r) => r.status === "RESOLVED" && !(carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => x.source_comment_id === r.id)).length})`,
                        children: (
                          <Table<PreviousRevisionRemark>
                            rowKey={(row) => `carry_open_${row.revision_id}_${row.id}`}
                            size="small"
                            pagination={false}
                            dataSource={previousRevisionRemarks.filter(
                              (row) =>
                                row.status === "RESOLVED" &&
                                !(carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => x.source_comment_id === row.id),
                            )}
                            columns={[
                              { title: "Из ревизии", dataIndex: "revision_code", width: 100 },
                              { title: "Код", dataIndex: "review_code", width: 90, render: (v) => v ?? "—" },
                              { title: "Текст", dataIndex: "text", render: (value: string) => getCleanRemarkText(value) },
                              {
                                title: "Подтвердил",
                                width: 170,
                                render: (_: unknown, row) => {
                                  const d = (carryDecisionsByRevision[selectedRevisionId] ?? []).find((x) => x.source_comment_id === row.id);
                                  const name = d?.decided_by_name ?? d?.decided_by_email ?? "—";
                                  return (
                                    <Typography.Text ellipsis={{ tooltip: name }} style={{ maxWidth: 150, whiteSpace: "nowrap" }}>
                                      {name}
                                    </Typography.Text>
                                  );
                                },
                              },
                              {
                                title: "Дата подтверждения",
                                width: 170,
                                render: (_: unknown, row) => {
                                  const d = (carryDecisionsByRevision[selectedRevisionId] ?? []).find((x) => x.source_comment_id === row.id);
                                  return d ? formatDateTimeRu(d.decided_at) : "—";
                                },
                              },
                              {
                                title: "Действие",
                                width: 220,
                                render: (_, row) => (
                                  <Space>
                                    <Button
                                      size="small"
                                      disabled={(carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => x.source_comment_id === row.id)}
                                      onClick={async () => {
                                        if (!selectedRevisionId) return;
                                        if ((carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => x.source_comment_id === row.id)) {
                                          message.info("Решение по замечанию уже зафиксировано");
                                          return;
                                        }
                                        const decision = await setCarryDecision(selectedRevisionId, { source_comment_id: row.id, status: "OPEN" });
                                        setCarryDecisionsByRevision((prev) => ({
                                          ...prev,
                                          [selectedRevisionId]: [
                                            decision,
                                            ...(prev[selectedRevisionId] ?? []).filter((x) => x.source_comment_id !== decision.source_comment_id),
                                          ],
                                        }));
                                        await createComment({
                                          revision_id: selectedRevisionId,
                                          text: row.text,
                                          status: "OPEN",
                                          review_code: (row.review_code as "AN" | "CO" | "RJ" | null) ?? null,
                                          page: null,
                                          area_x: null,
                                          area_y: null,
                                          area_w: null,
                                          area_h: null,
                                        });
                                        setComments(await listComments(selectedRevisionId));
                                        message.success("Замечание добавлено в текущую ревизию как OPEN");
                                      }}
                                    >
                                      OPEN
                                    </Button>
                                    <Button
                                      size="small"
                                      disabled={(carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => x.source_comment_id === row.id)}
                                      onClick={() => {
                                        if (!selectedRevisionId) return;
                                        if ((carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => x.source_comment_id === row.id)) {
                                          message.info("Решение по замечанию уже зафиксировано");
                                          return;
                                        }
                                        void setCarryDecision(selectedRevisionId, { source_comment_id: row.id, status: "CLOSED" })
                                          .then((decision) => {
                                            const next = Array.from(new Set([...(carryClosedByRevision[selectedRevisionId] ?? []), row.id]));
                                            setCarryClosedByRevision((prev) => ({ ...prev, [selectedRevisionId]: next }));
                                            setCarryDecisionsByRevision((prev) => ({
                                              ...prev,
                                              [selectedRevisionId]: [
                                                decision,
                                                ...(prev[selectedRevisionId] ?? []).filter((x) => x.source_comment_id !== decision.source_comment_id),
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
                            scroll={{ x: 980, y: 180 }}
                            tableLayout="fixed"
                          />
                        ),
                      },
                      {
                        key: "carry_closed",
                        label: `Было устранено (${previousRevisionRemarks.filter((r) => r.status === "RESOLVED" && (carryClosedByRevision[selectedRevisionId] ?? []).includes(r.id)).length})`,
                        children: (
                          <Table<PreviousRevisionRemark>
                            rowKey={(row) => `carry_closed_${row.revision_id}_${row.id}`}
                            size="small"
                            pagination={false}
                            dataSource={previousRevisionRemarks.filter(
                              (row) => row.status === "RESOLVED" && (carryClosedByRevision[selectedRevisionId] ?? []).includes(row.id),
                            )}
                            columns={[
                              { title: "Из ревизии", dataIndex: "revision_code", width: 100 },
                              { title: "Код", dataIndex: "review_code", width: 90, render: (v) => v ?? "—" },
                              { title: "Текст", dataIndex: "text", render: (value: string) => getCleanRemarkText(value) },
                              {
                                title: "Подтвердил",
                                width: 170,
                                render: (_: unknown, row) => {
                                  const d = (carryDecisionsByRevision[selectedRevisionId] ?? []).find((x) => x.source_comment_id === row.id);
                                  const name = d?.decided_by_name ?? d?.decided_by_email ?? "—";
                                  return (
                                    <Typography.Text ellipsis={{ tooltip: name }} style={{ maxWidth: 150, whiteSpace: "nowrap" }}>
                                      {name}
                                    </Typography.Text>
                                  );
                                },
                              },
                              {
                                title: "Дата подтверждения",
                                width: 170,
                                render: (_: unknown, row) => {
                                  const d = (carryDecisionsByRevision[selectedRevisionId] ?? []).find((x) => x.source_comment_id === row.id);
                                  return d ? formatDateTimeRu(d.decided_at) : "—";
                                },
                              },
                              {
                                title: "Действие",
                                width: 160,
                                render: () => <Typography.Text type="secondary">Зафиксировано</Typography.Text>,
                              },
                            ]}
                            scroll={{ x: 980, y: 180 }}
                            tableLayout="fixed"
                          />
                        ),
                      },
                  ]}
                />
              </div>
            )}
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
              options={contractorAuthorOptions}
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
        onClose={() => {
          setPdfAnnotatorOpen(false);
          setPdfFocusCommentId(null);
        }}
        mode={currentUser.company_type === "contractor" ? "contractor_review" : "owner_create"}
        comments={comments}
        canCreateOwnerRemarks={!ownerCommentLocked}
        carryOverRemarks={
          canManageCarryOver
            ? previousRevisionRemarks.filter(
                (row) =>
                  row.status === "RESOLVED" &&
                  !(carryDecisionsByRevision[selectedRevisionId ?? -1] ?? []).some((x) => x.source_comment_id === row.id),
              )
            : []
        }
        carryClosedIds={canManageCarryOver && selectedRevisionId ? (carryClosedByRevision[selectedRevisionId] ?? []) : []}
        carryDecidedIds={canManageCarryOver ? selectedCarryDecidedIds : []}
        onCarryClose={canManageCarryOver ? (id) => {
          if (!selectedRevisionId) return;
          if ((carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => x.source_comment_id === id)) return;
          void setCarryDecision(selectedRevisionId, { source_comment_id: id, status: "CLOSED" })
            .then((decision) => {
              const next = Array.from(new Set([...(carryClosedByRevision[selectedRevisionId] ?? []), id]));
              setCarryClosedByRevision((prev) => ({ ...prev, [selectedRevisionId]: next }));
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
        onCarryOpen={canManageCarryOver ? async (item) => {
          if (!selectedRevisionId) return;
          if ((carryDecisionsByRevision[selectedRevisionId] ?? []).some((x) => x.source_comment_id === item.id)) return;
          const decision = await setCarryDecision(selectedRevisionId, { source_comment_id: item.id, status: "OPEN" });
          setCarryDecisionsByRevision((prev) => ({
            ...prev,
            [selectedRevisionId]: [
              decision,
              ...(prev[selectedRevisionId] ?? []).filter((x) => x.source_comment_id !== decision.source_comment_id),
            ],
          }));
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
          setComments(await listComments(selectedRevisionId));
        } : undefined}
        focusCommentId={pdfFocusCommentId}
        canManageOwnerRemarks={canOwnerPublishToCrs}
        onCreated={async () => {
          if (selectedRevisionId) {
            const items = await listComments(selectedRevisionId);
            setComments(items);
          }
        }}
      />

      <Modal
        open={attachmentsModalOpen}
        onCancel={() => setAttachmentsModalOpen(false)}
        footer={null}
        title={`Файлы ревизии: ${selectedDocument?.document_num ?? "—"} / ${selectedRevision?.revision_code ?? "—"}`}
        width={900}
      >
        {!selectedRevisionId && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 10 }}
            message="Сначала выберите ревизию в таблице ниже. После этого можно загружать доп. файлы."
          />
        )}
        {selectedDocumentCompleted && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 10 }}
            message="Документ завершен: загрузка файлов отключена"
          />
        )}
        <Space style={{ marginBottom: 10 }} wrap>
          {canUploadDocumentAttachments && (
            <Upload
              maxCount={1}
              disabled={!selectedRevisionId || selectedDocumentCompleted}
              beforeUpload={(file) => {
                setAttachmentFile(file);
                return false;
              }}
              onRemove={() => {
                setAttachmentFile(null);
              }}
            >
              <Tooltip title="Выберите дополнительный файл для текущей ревизии">
                <Button>Выбрать файл</Button>
              </Tooltip>
            </Upload>
          )}
          {canUploadDocumentAttachments && (
            <Tooltip title="Загрузить выбранный доп. файл в текущую ревизию">
              <Button
                type="primary"
                loading={attachmentUploadBusy}
                disabled={!selectedRevisionId || !attachmentFile || selectedDocumentCompleted}
                onClick={() => void submitAttachmentUpload()}
              >
                Загрузить
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Скачать архив всех доп. файлов текущей ревизии">
            <Button
              disabled={!selectedRevisionId || documentAttachments.length === 0}
              onClick={() => {
                if (!selectedRevisionId || !selectedDocument || !selectedRevision) return;
                void downloadRevisionAttachmentsArchive(
                  selectedRevisionId,
                  `${selectedDocument.document_num}-${selectedRevision.revision_code}`,
                );
              }}
            >
              Скачать архив
            </Button>
          </Tooltip>
        </Space>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={documentAttachments}
          columns={[
            { title: "Файл", dataIndex: "file_name" },
            {
              title: "Кто загрузил",
              key: "uploader",
              width: 220,
              render: (_: unknown, row: DocumentAttachmentItem) => row.uploaded_by_name ?? row.uploaded_by_email ?? "—",
            },
            { title: "Загружен", dataIndex: "created_at", width: 180, render: (v: string) => formatDateTimeRu(v) },
          ]}
          scroll={{ y: 320 }}
          locale={{ emptyText: "Для этой ревизии дополнительные файлы еще не загружены." }}
        />
      </Modal>

      <Modal
        open={responseModalOpen}
        onCancel={() => setResponseModalOpen(false)}
        okButtonProps={{ style: { display: "none" } }}
        title="Контекст замечания в PDF и обсуждение"
        width={1200}
      >
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
                      setResponsePageNumber((prev) => Math.min(Math.max(1, prev), Math.max(1, numPages)));
                    }}
                    onLoadError={(error) => {
                      setResponsePdfError(error instanceof Error ? error.message : "Failed to load PDF");
                    }}
                  >
                    <Page pageNumber={responsePageNumber} width={1020} />
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
          {currentUser.permissions.can_publish_comments && selectedCommentForResponse && (
            <Space style={{ width: "100%", justifyContent: "flex-end" }}>
              {selectedCommentForResponse.parent_id === null && !selectedCommentForResponse.is_published_to_contractor && !selectedCommentForResponse.in_crs && (
                <Button
                  type="primary"
                  onClick={async () => {
                    const activeRevisionId = selectedRevisionId ?? selectedCommentForResponse.revision_id;
                    try {
                      message.loading({ content: "Добавление в CRS...", key: "crs_action" });
                      await addCommentToCrs(selectedCommentForResponse.id);
                      message.success({ content: "Замечание добавлено в CRS", key: "crs_action" });
                      setResponseModalOpen(false);
                      await reloadRevisionContext(activeRevisionId);
                    } catch (error: unknown) {
                      const text = error instanceof Error ? error.message : "Не удалось добавить в CRS";
                      message.error({ content: text, key: "crs_action" });
                    }
                  }}
                >
                  Отправить в CRS
                </Button>
              )}
              <Button
                danger
                disabled={selectedCommentForResponse.parent_id !== null || selectedCommentForResponse.status === "REJECTED"}
                onClick={async () => {
                  const activeRevisionId = selectedRevisionId ?? selectedCommentForResponse.revision_id;
                  try {
                    message.loading({ content: "Отклонение замечания...", key: "withdraw_action" });
                    await ownerCommentDecision(selectedCommentForResponse.id, { action: "REJECT", note: "Снято LR" });
                    message.success({ content: "Замечание отклонено LR", key: "withdraw_action" });
                    setResponseModalOpen(false);
                    await reloadRevisionContext(activeRevisionId);
                  } catch (error: unknown) {
                    const text = error instanceof Error ? error.message : "Не удалось отклонить замечание";
                    message.error({ content: text, key: "withdraw_action" });
                  }
                }}
              >
                Отклонить
              </Button>
              {selectedCommentForResponse.parent_id === null &&
                selectedCommentForResponse.contractor_status === "I" &&
                selectedCommentForResponse.backlog_status !== "LR_FINAL_CONFIRM" && (
                <Button
                  onClick={async () => {
                    const note = window.prompt("Комментарий подрядчику (финальное подтверждение замечания):", "");
                    if (!note || note.trim().length < 3) {
                      message.warning("Нужен комментарий минимум 3 символа");
                      return;
                    }
                    const activeRevisionId = selectedRevisionId ?? selectedCommentForResponse.revision_id;
                    try {
                      message.loading({ content: "Финальное подтверждение LR...", key: "lr_final_confirm" });
                      await ownerCommentDecision(selectedCommentForResponse.id, { action: "FINAL_CONFIRM", note: note.trim() });
                      message.success({ content: "Замечание финально подтверждено LR", key: "lr_final_confirm" });
                      setResponseModalOpen(false);
                      await reloadRevisionContext(activeRevisionId);
                    } catch (error: unknown) {
                      const text = error instanceof Error ? error.message : "Не удалось финально подтвердить замечание";
                      message.error({ content: text, key: "lr_final_confirm" });
                    }
                  }}
                >
                  Финально подтвердить LR
                </Button>
              )}
            </Space>
          )}
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
      <Modal
        open={progressModalOpen}
        onCancel={() => setProgressModalOpen(false)}
        footer={null}
        width={980}
        title={`Прогресс документа: ${selectedDocument?.document_num ?? "—"}`}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Карточка шагов 70/75/80/85/90/100. План/прогноз рассчитываются в разделе «Отчетность», здесь показана фиксация фактов по ревизиям/TRM.
        </Typography.Paragraph>
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={progressMilestones}
          columns={[
            { title: "Шаг", dataIndex: "progress", width: 90 },
            { title: "Событие", dataIndex: "step" },
            { title: "План", dataIndex: "plan", width: 120 },
            { title: "Прогноз", dataIndex: "forecast", width: 120 },
            { title: "TRM/CRS", dataIndex: "trm", width: 180 },
            { title: "Факт", dataIndex: "fact", width: 200 },
          ]}
        />
      </Modal>
    </>
  );
}
