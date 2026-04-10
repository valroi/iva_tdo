import type { CommentItem } from "../types";

export type RemarksSummaryCode = "RJ" | "CO" | "AN" | "NONE";

function parentAddressedRemarks(comments: CommentItem[]): CommentItem[] {
  return comments.filter(
    (item) =>
      item.parent_id === null &&
      item.status === "RESOLVED" &&
      !!item.review_code,
  );
}

export function getRemarksSummaryCode(comments: CommentItem[]): RemarksSummaryCode {
  const codes = new Set(parentAddressedRemarks(comments).map((item) => item.review_code));
  if (codes.has("RJ")) return "RJ";
  if (codes.has("CO")) return "CO";
  if (codes.has("AN")) return "AN";
  return "NONE";
}

export function getRemarksSummaryLabel(comments: CommentItem[], fallbackReviewCode?: string | null): string {
  const code = getRemarksSummaryCode(comments);
  if (code !== "NONE") return code;
  const parentCodes = new Set(
    comments
      .filter((item) => item.parent_id === null)
      .map((item) => item.review_code)
      .filter((item): item is "AP" | "AN" | "CO" | "RJ" => item === "AP" || item === "AN" || item === "CO" || item === "RJ"),
  );
  if (parentCodes.has("RJ")) return "RJ";
  if (parentCodes.has("CO")) return "CO";
  if (parentCodes.has("AN")) return "AN";
  if (parentCodes.has("AP")) return "AP";
  if (fallbackReviewCode === "AP" || fallbackReviewCode === "AN" || fallbackReviewCode === "CO" || fallbackReviewCode === "RJ") {
    return fallbackReviewCode;
  }
  return "Нет замечаний";
}

type RevisionCodeCarrier = {
  id?: number | null;
  created_at?: string | null;
  revision_code: string;
  issue_purpose?: string | null;
};

export function getDisplayRevisionCode(current: RevisionCodeCarrier, all?: RevisionCodeCarrier[]): string {
  const code = String(current.revision_code ?? "").trim().toUpperCase();
  const purpose = String(current.issue_purpose ?? "").trim().toUpperCase();
  if (!code) return "—";
  if (!purpose) return code;
  if (purpose === "IFR") return code;
  if (/^\d{2}$/.test(code)) return code;
  // Legacy rows may contain letter codes for non-IFR purposes; show canonical numeric index.
  if (all && all.length > 0) {
    const nonIfr = all
      .filter((item) => String(item.issue_purpose ?? "").trim().toUpperCase() !== "IFR")
      .slice()
      .sort((a, b) => {
        const at = new Date(a.created_at ?? "").getTime();
        const bt = new Date(b.created_at ?? "").getTime();
        if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at - bt;
        return Number(a.id ?? 0) - Number(b.id ?? 0);
      });
    const index = nonIfr.findIndex((item) => Number(item.id ?? -1) === Number(current.id ?? -2));
    if (index >= 0) return String(index).padStart(2, "0");
  }
  return "00";
}
