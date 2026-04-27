import type {
  CipherTemplate,
  CipherTemplateField,
  CommentItem,
  CsrQueueItem,
  CompanyType,
  DocumentItem,
  DocumentAttachmentItem,
  CarryDecisionItem,
  MDRRecord,
  MdrImportResult,
  NotificationItem,
  ProjectItem,
  ProjectMember,
  ProjectMemberRole,
  ProjectReference,
  ReviewMatrixMember,
  TdoQueueItem,
  QuickDemoSetupResult,
  RegistrationRequest,
  RevisionCard,
  RevisionOverviewItem,
  DocumentRegistryItem,
  Revision,
  User,
  UserSession,
  UserPermissions,
  UserRole,
  WorkflowStatus,
} from "./types";

const API_URL =
  import.meta.env.VITE_API_URL ??
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://localhost:8000");
const PREFIX = `${API_URL}/api/v1`;

interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

function getProfileId(): string {
  if (typeof window === "undefined") {
    return "default";
  }
  const raw = new URLSearchParams(window.location.search).get("profile") ?? "default";
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return normalized || "default";
}

function tokenStorageKey(type: "access" | "refresh"): string {
  const profile = getProfileId();
  return `tdo_${type}_token_${profile}`;
}

export function getActiveProfileId(): string {
  return getProfileId();
}

function getAccessToken(): string | null {
  return localStorage.getItem(tokenStorageKey("access"));
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function saveTokens(tokens: Tokens): void {
  localStorage.setItem(tokenStorageKey("access"), tokens.access_token);
  localStorage.setItem(tokenStorageKey("refresh"), tokens.refresh_token);
}

export function clearTokens(): void {
  localStorage.removeItem(tokenStorageKey("access"));
  localStorage.removeItem(tokenStorageKey("refresh"));
}

export function hasAccessToken(): boolean {
  return Boolean(getAccessToken());
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init.headers ?? {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${PREFIX}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const rawText = await response.text();
    let errorMessage = rawText || "API request failed";
    try {
      const parsed = JSON.parse(rawText) as { detail?: string };
      if (parsed?.detail) {
        errorMessage = parsed.detail;
      }
    } catch {
      // keep raw text fallback for non-JSON responses
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const token = getAccessToken();
  const headers = new Headers(init.headers ?? {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${PREFIX}${path}`, { ...init, headers });
  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(rawText || "API request failed");
  }
  return response.blob();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function login(email: string, password: string): Promise<void> {
  const tokens = await request<Tokens>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  saveTokens(tokens);
}

export async function impersonateLogin(userId: number): Promise<void> {
  const tokens = await request<Tokens>(`/auth/impersonate/${userId}`, {
    method: "POST",
  });
  saveTokens(tokens);
}

export function me(): Promise<User> {
  return request<User>("/auth/me");
}

export function listMdr(): Promise<MDRRecord[]> {
  return request<MDRRecord[]>("/mdr");
}

export function createMdr(payload: Record<string, unknown>): Promise<MDRRecord> {
  return request<MDRRecord>("/mdr", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMdr(mdrId: number, payload: Record<string, unknown>): Promise<MDRRecord> {
  return request<MDRRecord>(`/mdr/${mdrId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteMdr(mdrId: number): Promise<void> {
  return request<void>(`/mdr/${mdrId}`, {
    method: "DELETE",
  });
}

export async function downloadMdrTemplate(projectCode: string): Promise<void> {
  const blob = await requestBlob(`/mdr/template?project_code=${encodeURIComponent(projectCode)}`);
  downloadBlob(blob, `mdr_template_${projectCode}.xlsx`);
}

export async function exportMdr(projectCode: string): Promise<void> {
  const blob = await requestBlob(`/mdr/export?project_code=${encodeURIComponent(projectCode)}`);
  downloadBlob(blob, `mdr_export_${projectCode}.xlsx`);
}

export function importMdr(projectCode: string, file: File, dryRun = false): Promise<MdrImportResult> {
  const body = new FormData();
  body.append("file", file);
  return request<MdrImportResult>(
    `/mdr/import?project_code=${encodeURIComponent(projectCode)}&dry_run=${dryRun ? "true" : "false"}`,
    {
      method: "POST",
      body,
    },
  );
}

export function composeMdrCipher(payload: {
  project_code: string;
  category?: string;
  values?: Record<string, string>;
  originator_code?: string;
  title_object?: string;
  discipline_code?: string;
  doc_type?: string;
  serial_number?: string;
}): Promise<{ cipher: string; rule: string }> {
  return request<{ cipher: string; rule: string }>("/mdr/compose-cipher", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCipherTemplate(projectCode: string, category: string): Promise<CipherTemplate | null> {
  return request<CipherTemplate | null>(
    `/mdr/cipher-template?project_code=${encodeURIComponent(projectCode)}&category=${encodeURIComponent(category)}`,
  );
}

export function upsertCipherTemplate(
  projectCode: string,
  category: string,
  fields: CipherTemplateField[],
): Promise<CipherTemplate> {
  return request<CipherTemplate>(
    `/mdr/cipher-template?project_code=${encodeURIComponent(projectCode)}&category=${encodeURIComponent(category)}`,
    {
      method: "PUT",
      body: JSON.stringify({ fields }),
    },
  );
}

export function checkMdrCipher(projectCode: string, value: string): Promise<{ exists: boolean }> {
  return request<{ exists: boolean }>(
    `/mdr/check-cipher?project_code=${encodeURIComponent(projectCode)}&value=${encodeURIComponent(value)}`,
  );
}

export function listDocuments(): Promise<DocumentItem[]> {
  return request<DocumentItem[]>("/documents");
}

export function listDocumentsRegistry(filters?: {
  project_code?: string;
  category?: string;
  discipline_code?: string;
  release_status?: string;
  revision_status?: string;
  comments_scope?: "ANY" | "OPEN" | "NONE";
  overdue_only?: boolean;
}): Promise<DocumentRegistryItem[]> {
  const search = new URLSearchParams();
  if (filters?.project_code) search.set("project_code", filters.project_code);
  if (filters?.category) search.set("category", filters.category);
  if (filters?.discipline_code) search.set("discipline_code", filters.discipline_code);
  if (filters?.release_status) search.set("release_status", filters.release_status);
  if (filters?.revision_status) search.set("revision_status", filters.revision_status);
  if (filters?.comments_scope) search.set("comments_scope", filters.comments_scope);
  if (filters?.overdue_only) search.set("overdue_only", "true");
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request<DocumentRegistryItem[]>(`/documents/registry${suffix}`);
}

export function createDocument(payload: Record<string, unknown>): Promise<DocumentItem> {
  return request<DocumentItem>("/documents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listRevisions(documentId: number): Promise<Revision[]> {
  return request<Revision[]>(`/documents/${documentId}/revisions`);
}

export function createRevision(payload: Record<string, unknown>): Promise<Revision> {
  return request<Revision>("/revisions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function processRevisionTdoDecision(
  revisionId: number,
  payload: { action: "SEND_TO_OWNER" | "CANCELLED"; note?: string },
): Promise<Revision> {
  return request<Revision>(`/revisions/${revisionId}/tdo-decision`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function processRevisionsTdoDecisionBulk(
  payload: { revision_ids: number[]; action: "SEND_TO_OWNER" | "CANCELLED"; note?: string },
): Promise<Revision[]> {
  return request<Revision[]>("/revisions/tdo-decision/bulk", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listTdoQueue(): Promise<TdoQueueItem[]> {
  return request<TdoQueueItem[]>("/revisions/tdo-queue");
}

export function listOwnerReviewQueue(): Promise<TdoQueueItem[]> {
  return request<TdoQueueItem[]>("/revisions/owner-review-queue");
}

export function listRevisionsOverview(): Promise<RevisionOverviewItem[]> {
  return request<RevisionOverviewItem[]>("/revisions/overview");
}

export function listComments(revisionId: number): Promise<CommentItem[]> {
  return request<CommentItem[]>(`/revisions/${revisionId}/comments`);
}

export function setRevisionReviewCode(revisionId: number, reviewCode: "AP"): Promise<Revision> {
  return request<Revision>(`/revisions/${revisionId}/review-code`, {
    method: "POST",
    body: JSON.stringify({ review_code: reviewCode }),
  });
}

export function listCarryDecisions(revisionId: number): Promise<CarryDecisionItem[]> {
  return request<CarryDecisionItem[]>(`/revisions/${revisionId}/carry-decisions`);
}

export function setCarryDecision(revisionId: number, payload: { source_comment_id: number; status: "OPEN" | "CLOSED" }): Promise<CarryDecisionItem> {
  return request<CarryDecisionItem>(`/revisions/${revisionId}/carry-decisions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createComment(payload: Record<string, unknown>): Promise<CommentItem> {
  return request<CommentItem>("/comments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function respondToComment(
  commentId: number,
  payload: Record<string, unknown>,
): Promise<CommentItem> {
  return request<CommentItem>(`/comments/${commentId}/response`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function publishComment(commentId: number): Promise<CommentItem> {
  return request<CommentItem>(`/comments/${commentId}/publish`, {
    method: "POST",
  });
}

export function ownerCommentDecision(
  commentId: number,
  payload: { action: "PUBLISH" | "REJECT" | "WITHDRAW" | "UPDATE" | "FINAL_CONFIRM"; note?: string; text?: string; review_code?: "RJ" | "AP" | "CO" | "AN" },
): Promise<CommentItem> {
  return request<CommentItem>(`/comments/${commentId}/owner-decision`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function publishAllCommentsForRevision(revisionId: number): Promise<{ revision_id: number; published_count: number }> {
  return request<{ revision_id: number; published_count: number }>(`/revisions/${revisionId}/comments/publish-all`, {
    method: "POST",
  });
}

export function listCrsQueue(): Promise<CsrQueueItem[]> {
  return request<CsrQueueItem[]>("/comments/crs-queue");
}

export function addCommentToCrs(commentId: number): Promise<CommentItem> {
  return request<CommentItem>(`/comments/${commentId}/add-to-crs`, {
    method: "POST",
  });
}

export function sendCrsComments(commentIds: number[]): Promise<{ revision_id: number; published_count: number }> {
  return request<{ revision_id: number; published_count: number }>("/comments/crs-send", {
    method: "POST",
    body: JSON.stringify({ comment_ids: commentIds }),
  });
}

export function listNotifications(): Promise<NotificationItem[]> {
  return request<NotificationItem[]>("/notifications");
}

export function markNotificationRead(notificationId: number): Promise<NotificationItem> {
  return request<NotificationItem>(`/notifications/${notificationId}/read`, {
    method: "PUT",
  });
}

export function listWorkflowStatuses(): Promise<WorkflowStatus[]> {
  return request<WorkflowStatus[]>("/workflow/statuses");
}

export function listUsers(): Promise<User[]> {
  return request<User[]>("/users");
}

export function createUser(payload: {
  email: string;
  password: string;
  full_name: string;
  company_code?: string;
  company_type: CompanyType;
  role: UserRole;
}): Promise<User> {
  return request<User>("/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUserRole(userId: number, role: UserRole): Promise<User> {
  return request<User>(`/users/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}

export function setUserActive(userId: number, isActive: boolean): Promise<User> {
  return request<User>(`/users/${userId}/active`, {
    method: "PUT",
    body: JSON.stringify({ is_active: isActive }),
  });
}

export function updateUserPermissions(userId: number, permissions: UserPermissions): Promise<User> {
  return request<User>(`/users/${userId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissions }),
  });
}

export function updateUserPassword(userId: number, newPassword: string): Promise<void> {
  return request<void>(`/users/${userId}/password`, {
    method: "PUT",
    body: JSON.stringify({ new_password: newPassword }),
  });
}

export function updateUser(
  userId: number,
  payload: { email?: string; full_name?: string; company_code?: string; company_type?: CompanyType; is_active?: boolean },
): Promise<User> {
  return request<User>(`/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function listUserSessions(userId: number): Promise<UserSession[]> {
  return request<UserSession[]>(`/users/${userId}/sessions`);
}

export function revokeUserSession(userId: number, sessionId: number): Promise<void> {
  return request<void>(`/users/${userId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function listMySessions(): Promise<UserSession[]> {
  return request<UserSession[]>(`/auth/sessions`);
}

export function deleteMySession(sessionId: number): Promise<void> {
  return request<void>(`/auth/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function deleteUser(userId: number): Promise<void> {
  return request<void>(`/users/${userId}`, {
    method: "DELETE",
  });
}

export function listRegistrationRequests(): Promise<RegistrationRequest[]> {
  return request<RegistrationRequest[]>("/users/registration-requests");
}

export function approveRegistrationRequest(
  requestId: number,
  payload: { role: UserRole; company_type: CompanyType; is_active: boolean },
): Promise<User> {
  return request<User>(`/users/registration-requests/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function rejectRegistrationRequest(requestId: number, reviewNote: string): Promise<RegistrationRequest> {
  return request<RegistrationRequest>(`/users/registration-requests/${requestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ review_note: reviewNote }),
  });
}

export function createQuickDemoSetup(payload: {
  contractor_email: string;
  owner_email: string;
  password: string;
}): Promise<QuickDemoSetupResult> {
  return request<QuickDemoSetupResult>("/users/quick-demo-setup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface AdminReviewSlaSettings {
  initial_days: number;
  next_days: number;
  owner_dcc_incoming_days: number;
  owner_specialist_review_days: number;
  owner_lr_approval_days: number;
  contractor_consideration_days: number;
  contractor_ap_issue_days: number;
  contractor_an_issue_days: number;
  contractor_co_rj_issue_days: number;
  owner_final_approval_days: number;
  owner_stamp_days: number;
}

export function getAdminReviewSlaSettings(): Promise<AdminReviewSlaSettings> {
  return request<AdminReviewSlaSettings>("/users/admin-settings/review-sla");
}

export function updateAdminReviewSlaSettings(payload: {
  initial_days: number;
  next_days: number;
  owner_dcc_incoming_days: number;
  owner_specialist_review_days: number;
  owner_lr_approval_days: number;
  contractor_consideration_days: number;
  contractor_ap_issue_days: number;
  contractor_an_issue_days: number;
  contractor_co_rj_issue_days: number;
  owner_final_approval_days: number;
  owner_stamp_days: number;
}): Promise<AdminReviewSlaSettings> {
  return request<AdminReviewSlaSettings>("/users/admin-settings/review-sla", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function clearProjectData(): Promise<{
  message: string;
  deleted_files: number;
  deleted_revisions: number;
  deleted_documents: number;
  deleted_mdr: number;
}> {
  return request("/users/admin-tools/project-data", {
    method: "DELETE",
  });
}

export function clearAllNotifications(): Promise<{
  message: string;
  deleted_notifications: number;
}> {
  return request("/users/admin-tools/notifications", {
    method: "DELETE",
  });
}

export function uploadRevisionPdf(revisionId: number, file: File): Promise<{
  file_name: string;
  file_path: string;
  content_type: string;
  file_size: number;
}> {
  const body = new FormData();
  body.append("file", file);
  body.append("revision_id", String(revisionId));
  return request("/documents/upload", {
    method: "POST",
    body,
  });
}

export function listDocumentAttachments(documentId: number): Promise<DocumentAttachmentItem[]> {
  return request<DocumentAttachmentItem[]>(`/documents/${documentId}/attachments`);
}

export function uploadDocumentAttachment(documentId: number, file: File): Promise<DocumentAttachmentItem> {
  const body = new FormData();
  body.append("file", file);
  return request<DocumentAttachmentItem>(`/documents/${documentId}/attachments`, {
    method: "POST",
    body,
  });
}

export function listRevisionAttachments(revisionId: number): Promise<DocumentAttachmentItem[]> {
  return request<DocumentAttachmentItem[]>(`/revisions/${revisionId}/attachments`);
}

export function uploadRevisionAttachment(revisionId: number, file: File): Promise<DocumentAttachmentItem> {
  const body = new FormData();
  body.append("file", file);
  return request<DocumentAttachmentItem>(`/revisions/${revisionId}/attachments`, {
    method: "POST",
    body,
  });
}

export function getDocumentAttachmentsArchiveUrl(documentId: number): string {
  return `${PREFIX}/documents/${documentId}/attachments/archive`;
}

export async function downloadDocumentAttachmentsArchive(documentId: number, documentNum: string): Promise<void> {
  const blob = await requestBlob(`/documents/${documentId}/attachments/archive`);
  downloadBlob(blob, `${documentNum}_files.zip`);
}

export async function downloadRevisionAttachmentsArchive(revisionId: number, documentNum: string): Promise<void> {
  const blob = await requestBlob(`/revisions/${revisionId}/attachments/archive`);
  downloadBlob(blob, `${documentNum}_files.zip`);
}

export function getRevisionPdfUrl(revisionId: number): string {
  return `${PREFIX}/revisions/${revisionId}/file`;
}

export function getRevisionCard(revisionId: number): Promise<RevisionCard> {
  return request<RevisionCard>(`/revisions/${revisionId}/card`);
}

export function listProjects(): Promise<ProjectItem[]> {
  return request<ProjectItem[]>("/projects");
}

export interface SmartUploadPreviewResult {
  fields: Record<string, string | null>;
  confidence: number;
  source: string;
  requires_confirmation: boolean;
  suggested_hierarchy: string;
}

export interface SmartUploadProcessResult {
  fields: Record<string, string | null>;
  confidence: number;
  source: string;
  requires_confirmation: boolean;
  hierarchy: string;
  destination: string;
  pdf_path: string;
  related_paths: string[];
}

export interface SmartUploadBatchProcessResult {
  total: number;
  processed: number;
  items: SmartUploadProcessResult[];
}

export interface SmartUploadTreeNode {
  key: string;
  name: string;
  node_type: "directory" | "file";
  relative_path: string;
  is_pdf: boolean;
  children: SmartUploadTreeNode[];
}

export interface SmartUploadRegistryItem {
  entry_key: string;
  full_cipher: string;
  cipher_no_revision: string;
  revision: string;
  project: string;
  document_category: string;
  document_class: string;
  discipline: string;
  title_code: string;
  development_date: string | null;
  issue_purpose: string | null;
  title_text: string | null;
  hierarchy: string;
  destination: string;
  pdf_name: string;
  pdf_relative_path: string;
  source: string;
  confidence: number;
}

export function smartUploadPreview(pdf: File): Promise<SmartUploadPreviewResult> {
  const body = new FormData();
  body.append("pdf", pdf);
  return request<SmartUploadPreviewResult>("/smart-upload/preview", {
    method: "POST",
    body,
  });
}

export function smartUploadProcess(payload: {
  pdf: File;
  relatedFiles?: File[];
  overrides?: Record<string, string>;
}): Promise<SmartUploadProcessResult> {
  const body = new FormData();
  body.append("pdf", payload.pdf);
  for (const file of payload.relatedFiles ?? []) {
    body.append("related_files", file);
  }
  if (payload.overrides && Object.keys(payload.overrides).length > 0) {
    body.append("overrides_json", JSON.stringify(payload.overrides));
  }
  return request<SmartUploadProcessResult>("/smart-upload/process", {
    method: "POST",
    body,
  });
}

export function smartUploadProcessBatch(pdfFiles: File[]): Promise<SmartUploadBatchProcessResult> {
  const body = new FormData();
  for (const file of pdfFiles) {
    body.append("pdf_files", file);
  }
  return request<SmartUploadBatchProcessResult>("/smart-upload/process-batch", {
    method: "POST",
    body,
  });
}

export function listSmartUploadTree(): Promise<SmartUploadTreeNode[]> {
  return request<SmartUploadTreeNode[]>("/smart-upload/tree");
}

export function listSmartUploadRegistry(): Promise<SmartUploadRegistryItem[]> {
  return request<SmartUploadRegistryItem[]>("/smart-upload/registry");
}

export function deleteSmartUploadRegistryItem(entryKey: string): Promise<{ deleted_files: number; deleted_folder: string }> {
  return request<{ deleted_files: number; deleted_folder: string }>(
    `/smart-upload/registry-item?entry_key=${encodeURIComponent(entryKey)}`,
    {
      method: "DELETE",
    },
  );
}

export function updateSmartUploadRegistryItem(payload: {
  entry_key: string;
  fields: Record<string, string | null>;
}): Promise<SmartUploadRegistryItem> {
  return request<SmartUploadRegistryItem>("/smart-upload/registry-item", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getSmartUploadFileUrl(relativePath: string): string {
  return `${PREFIX}/smart-upload/file?relative_path=${encodeURIComponent(relativePath)}`;
}

export function fetchSmartUploadFileBlob(relativePath: string): Promise<Blob> {
  return requestBlob(`/smart-upload/file?relative_path=${encodeURIComponent(relativePath)}`);
}

export function createProject(payload: {
  code: string;
  name: string;
  document_category: string;
  description?: string;
}): Promise<ProjectItem> {
  return request<ProjectItem>("/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProject(
  projectId: number,
  payload: {
    name?: string;
    description?: string;
    document_category?: string;
  },
): Promise<ProjectItem> {
  return request<ProjectItem>(`/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteProject(projectId: number, options?: { purge?: boolean; confirmCode?: string }): Promise<void> {
  const search = new URLSearchParams();
  if (options?.purge) {
    search.set("purge", "true");
  }
  if (options?.confirmCode) {
    search.set("confirm_code", options.confirmCode);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request<void>(`/projects/${projectId}${suffix}`, {
    method: "DELETE",
  });
}

export function listProjectMembers(projectId: number): Promise<ProjectMember[]> {
  return request<ProjectMember[]>(`/projects/${projectId}/members`);
}

export function addProjectMember(
  projectId: number,
  payload: { user_id: number; member_role: ProjectMemberRole },
): Promise<ProjectMember> {
  return request<ProjectMember>(`/projects/${projectId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteProjectMember(projectId: number, memberId: number): Promise<void> {
  return request<void>(`/projects/${projectId}/members/${memberId}`, {
    method: "DELETE",
  });
}

export function listProjectReferences(projectId: number, refType?: string): Promise<ProjectReference[]> {
  const suffix = refType ? `?ref_type=${encodeURIComponent(refType)}` : "";
  return request<ProjectReference[]>(`/projects/${projectId}/references${suffix}`);
}

export async function downloadProjectReferencesTemplate(projectId: number, refType: string): Promise<void> {
  const blob = await requestBlob(`/projects/${projectId}/references/template?ref_type=${encodeURIComponent(refType)}`);
  downloadBlob(blob, `project_references_template_${refType}.xlsx`);
}

export async function exportProjectReferences(projectId: number, refType: string): Promise<void> {
  const blob = await requestBlob(`/projects/${projectId}/references/export?ref_type=${encodeURIComponent(refType)}`);
  downloadBlob(blob, `project_references_${refType}.xlsx`);
}

export function importProjectReferences(projectId: number, refType: string, file: File): Promise<{ imported: number; updated: number }> {
  const body = new FormData();
  body.append("file", file);
  return request<{ imported: number; updated: number }>(
    `/projects/${projectId}/references/import?ref_type=${encodeURIComponent(refType)}`,
    {
      method: "POST",
      body,
    },
  );
}

export function createProjectReference(
  projectId: number,
  payload: { ref_type: string; code: string; value: string; is_active?: boolean },
): Promise<ProjectReference> {
  return request<ProjectReference>(`/projects/${projectId}/references`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProjectReference(
  referenceId: number,
  payload: { value?: string; is_active?: boolean },
): Promise<ProjectReference> {
  return request<ProjectReference>(`/projects/references/${referenceId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function listReviewMatrix(projectId: number): Promise<ReviewMatrixMember[]> {
  return request<ReviewMatrixMember[]>(`/projects/${projectId}/review-matrix`);
}

export function createReviewMatrixItem(
  projectId: number,
  payload: { user_id: number; discipline_code: string; doc_type: string; level: 1 | 2; state: "LR" | "R" },
): Promise<ReviewMatrixMember> {
  return request<ReviewMatrixMember>(`/projects/${projectId}/review-matrix`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateReviewMatrixItem(
  itemId: number,
  payload: { level?: 1 | 2; state?: "LR" | "R" },
): Promise<ReviewMatrixMember> {
  return request<ReviewMatrixMember>(`/projects/review-matrix/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteReviewMatrixItem(itemId: number): Promise<void> {
  return request<void>(`/projects/review-matrix/${itemId}`, {
    method: "DELETE",
  });
}
