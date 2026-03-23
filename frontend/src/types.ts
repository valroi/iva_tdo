export type UserRole =
  | "admin"
  | "owner_manager"
  | "owner_reviewer"
  | "contractor_manager"
  | "contractor_author"
  | "viewer";

export interface User {
  id: number;
  email: string;
  full_name: string;
  company_type: "admin" | "owner" | "contractor";
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface MDRRecord {
  id: number;
  document_key: string;
  project_code: string;
  doc_number: string;
  doc_name: string;
  discipline_code: string;
  doc_type: string;
  progress_percent: number;
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  status: string;
  created_at: string;
}

export interface DocumentItem {
  id: number;
  mdr_id: number;
  document_num: string;
  title: string;
  discipline: string;
  weight: number;
  created_by_id: number;
  created_at: string;
}

export interface Revision {
  id: number;
  document_id: number;
  revision_code: string;
  issue_purpose: string;
  status: string;
  trm_number: string | null;
  file_path: string | null;
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  review_deadline: string | null;
  created_at: string;
}

export interface CommentItem {
  id: number;
  revision_id: number;
  parent_id: number | null;
  author_id: number;
  text: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  page: number | null;
  area_x: number | null;
  area_y: number | null;
  area_w: number | null;
  area_h: number | null;
  created_at: string;
  resolved_at: string | null;
}

export interface NotificationItem {
  id: number;
  user_id: number;
  event_type: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface WorkflowStatus {
  id: number;
  code: string;
  name: string;
  color: string;
  description: string | null;
  is_final: boolean;
  editable: boolean;
  created_at: string;
}
