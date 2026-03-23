import type {
  CommentItem,
  DocumentItem,
  MDRRecord,
  NotificationItem,
  Revision,
  User,
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
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${PREFIX}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
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
