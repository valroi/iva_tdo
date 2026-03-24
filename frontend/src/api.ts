import type {
  CommentItem,
  CompanyType,
  DocumentItem,
  MDRBulkImportResponse,
  MDRRecord,
  NotificationItem,
  ProjectItem,
  ProjectMember,
  ProjectMemberRole,
  ProjectReference,
  QuickDemoSetupResult,
  RegistrationRequest,
  Revision,
  User,
  UserRole,
  WorkflowStatus,
} from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const PREFIX = `${API_URL}/api/v1`;

interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

function getAccessToken(): string | null {
  return localStorage.getItem("tdo_access_token");
}

export function saveTokens(tokens: Tokens): void {
  localStorage.setItem("tdo_access_token", tokens.access_token);
  localStorage.setItem("tdo_refresh_token", tokens.refresh_token);
}

export function clearTokens(): void {
  localStorage.removeItem("tdo_access_token");
  localStorage.removeItem("tdo_refresh_token");
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
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      let payload: { detail?: unknown } | null = null;
      try {
        payload = (await response.json()) as { detail?: unknown };
      } catch {
        payload = null;
      }
      if (typeof payload?.detail === "string" && payload.detail.trim().length > 0) {
        throw new Error(payload.detail);
      }
      throw new Error("API request failed");
    }
    const errorText = await response.text();
    throw new Error(errorText || "API request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function login(email: string, password: string): Promise<void> {
  const tokens = await request<Tokens>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
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

export function createMdrBulk(payload: {
  project_code: string;
  category: string;
  rows: Array<{
    document_key: string;
    title_object: string;
    discipline_code: string;
    doc_type: string;
    doc_name: string;
    doc_weight?: number;
    progress_percent?: number;
    status?: string;
    note?: string | null;
    is_confidential?: boolean;
    contractor_responsible_id?: number | null;
    owner_responsible_id?: number | null;
  }>;
}): Promise<MDRRecord[]> {
  return request<MDRRecord[]>("/mdr/bulk", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function downloadMdrImportTemplate(): Promise<void> {
  const token = getAccessToken();
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${PREFIX}/mdr/import-template`, { method: "GET", headers });
  if (!response.ok) {
    throw new Error("Не удалось скачать шаблон");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mdr_import_template.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

export function importMdrFromXlsx(
  projectCode: string,
  category: string,
  file: File,
): Promise<MDRBulkImportResponse> {
  const body = new FormData();
  body.append("project_code", projectCode);
  body.append("category", category);
  body.append("file", file);
  return request<MDRBulkImportResponse>("/mdr/import-xlsx", {
    method: "POST",
    body,
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

export function previewMdrDocNumber(payload: {
  project_code: string;
  category: string;
  title_object: string;
  discipline_code: string;
  doc_type: string;
}): Promise<{ doc_number: string }> {
  return request<{ doc_number: string }>("/mdr/doc-number-preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listDocuments(): Promise<DocumentItem[]> {
  return request<DocumentItem[]>("/documents");
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

export function listComments(revisionId: number): Promise<CommentItem[]> {
  return request<CommentItem[]>(`/revisions/${revisionId}/comments`);
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
  company_type: CompanyType;
  role: UserRole;
  originator_code?: string;
  can_manage_mdr?: boolean;
  can_manage_project_members?: boolean;
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

export function updateUserPermissions(
  userId: number,
  payload: { originator_code?: string | null; can_manage_mdr: boolean; can_manage_project_members: boolean },
): Promise<User> {
  return request<User>(`/users/${userId}/permissions`, {
    method: "PUT",
    body: JSON.stringify(payload),
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

export function listProjects(): Promise<ProjectItem[]> {
  return request<ProjectItem[]>("/projects");
}

export function createProject(payload: {
  code: string;
  name: string;
  description?: string;
}): Promise<ProjectItem> {
  return request<ProjectItem>("/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteProject(projectId: number): Promise<void> {
  return request<void>(`/projects/${projectId}`, {
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

export function deleteProjectReference(referenceId: number): Promise<void> {
  return request<void>(`/projects/references/${referenceId}`, {
    method: "DELETE",
  });
}

export function bulkDeleteProjectReferences(ids: number[]): Promise<{ deleted_count: number }> {
  return request<{ deleted_count: number }>("/projects/references/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function resetDemoData(): Promise<{
  deleted_projects: number;
  deleted_project_members: number;
  deleted_project_references: number;
  deleted_mdr_records: number;
  deleted_documents: number;
  deleted_revisions: number;
  deleted_comments: number;
  deleted_notifications: number;
}> {
  return request("/projects/admin/reset-demo-data", {
    method: "POST",
  });
}
