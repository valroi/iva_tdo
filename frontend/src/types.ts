export type UserRole =
  | "admin"
  | "owner_manager"
  | "owner_reviewer"
  | "contractor_manager"
  | "contractor_author"
  | "viewer";

export type CompanyType = "admin" | "owner" | "contractor";

export interface User {
  id: number;
  email: string;
  full_name: string;
  company_type: CompanyType;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  originator_code?: string | null;
  can_manage_mdr?: boolean;
  can_manage_project_members?: boolean;
}

export interface MDRRecord {
  id: number;
  document_key: string;
  project_code: string;
  category: string;
  title_object?: string;
  doc_number: string;
  originator_code?: string;
  serial_number?: string;
  doc_name: string;
  discipline_code: string;
  doc_type: string;
  doc_weight?: number;
  progress_percent: number;
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  status: string;
  contractor_responsible_id?: number | null;
  owner_responsible_id?: number | null;
  note?: string | null;
  is_confidential?: boolean;
  created_at: string;
}

export interface MDRBulkRow {
  document_key: string;
  title_object: string;
  discipline_code: string;
  doc_type: string;
  doc_name: string;
  doc_weight?: number;
  progress_percent?: number;
  status?: string;
  note?: string;
  is_confidential?: boolean;
  contractor_responsible_id?: number | null;
  owner_responsible_id?: number | null;
}

export interface MDRImportError {
  row: number;
  error: string;
}

export interface MDRBulkImportResponse {
  created_count: number;
  failed_count: number;
  created_ids: number[];
  errors: MDRImportError[];
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

export interface RegistrationRequest {
  id: number;
  email: string;
  full_name: string;
  company_type: CompanyType;
  requested_role: UserRole | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  review_note: string | null;
  reviewed_by_id: number | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface QuickDemoSetupResult {
  contractor_email: string;
  owner_email: string;
  password: string;
  mdr_id: number;
  document_id: number;
  revision_id: number;
  comment_id: number;
}

export type ProjectMemberRole =
  | "main_admin"
  | "participant"
  | "observer";

export interface ProjectItem {
  id: number;
  code: string;
  name: string;
  description: string | null;
  created_by_id: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: number;
  project_id: number;
  user_id: number;
  member_role: ProjectMemberRole;
  can_manage_contractor_users: boolean;
  created_at: string;
}

export interface ProjectReference {
  id: number;
  project_id: number;
  ref_type: string;
  code: string;
  value: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectReferenceSelectionItem extends ProjectReference {
  project_code: string;
  project_name: string;
}

export interface AdminDataResetResult {
  deleted_projects: number;
  deleted_project_members: number;
  deleted_project_references: number;
  deleted_mdr_records: number;
  deleted_documents: number;
  deleted_revisions: number;
  deleted_comments: number;
  deleted_notifications: number;
}
