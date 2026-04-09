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
