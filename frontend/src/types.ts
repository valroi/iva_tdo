export type UserRole =
  | "admin"
  | "user";

export interface UserPermissions {
  can_manage_users: boolean;
  can_manage_projects: boolean;
  can_edit_project_references: boolean;
  can_manage_review_matrix: boolean;
  can_view_reporting: boolean;
  can_create_mdr: boolean;
  can_upload_files: boolean;
  can_comment: boolean;
  can_raise_comments: boolean;
  can_respond_comments: boolean;
  can_publish_comments: boolean;
  can_edit_workflow_statuses: boolean;
  can_process_tdo_queue: boolean;
}

export type CompanyType = "admin" | "owner" | "contractor";

export interface User {
  id: number;
  email: string;
  full_name: string;
  company_code?: string | null;
  company_type: CompanyType;
  role: UserRole;
  permissions: UserPermissions;
  is_active: boolean;
  created_at: string;
}

export interface UserSession {
  id: number;
  user_id: number;
  ip_address: string | null;
  country: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  is_active: boolean;
}

export interface MDRRecord {
  id: number;
  document_key: string;
  project_code: string;
  category: string;
  title_object: string;
  serial_number: string;
  doc_number: string;
  doc_name: string;
  planned_dev_start?: string | null;
  discipline_code: string;
  doc_type: string;
  progress_percent: number;
  doc_weight: number;
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  status: string;
  dates?: Record<string, unknown>;
  created_at: string;
}

export interface MdrImportError {
  row: number;
  message: string;
}

export interface MdrImportResult {
  dry_run?: boolean;
  imported: number;
  skipped: number;
  errors: MdrImportError[];
}

export interface DocumentItem {
  id: number;
  mdr_id: number;
  document_num: string;
  title: string;
  discipline: string;
  weight: number;
  latest_revision_code?: string | null;
  latest_revision_status?: string | null;
  latest_review_code?: "AP" | "AN" | "CO" | "RJ" | null;
  latest_issue_purpose?: string | null;
  created_by_id: number;
  created_at: string;
}

export interface DocumentAttachmentItem {
  id: number;
  document_id: number;
  uploaded_by_id: number;
  uploaded_by_name?: string | null;
  uploaded_by_email?: string | null;
  file_name: string;
  created_at: string;
}

export interface CarryDecisionItem {
  id: number;
  target_revision_id: number;
  source_comment_id: number;
  status: "OPEN" | "CLOSED";
  decided_by_id: number;
  decided_by_name?: string | null;
  decided_by_email?: string | null;
  decided_at: string;
}

export interface Revision {
  id: number;
  document_id: number;
  revision_code: string;
  issue_purpose: string;
  author_id: number | null;
  status: string;
  trm_number: string | null;
  file_path: string | null;
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  review_deadline: string | null;
  created_at: string;
  reviewed_at?: string | null;
}

export interface CommentItem {
  id: number;
  revision_id: number;
  parent_id: number | null;
  author_id: number;
  author_name?: string | null;
  author_email?: string | null;
  text: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  is_published_to_contractor: boolean;
  backlog_status: "IN_NEXT_REVISION" | "REJECTED" | null;
  contractor_status: "I" | "A" | null;
  contractor_response_text?: string | null;
  contractor_response_at?: string | null;
  in_crs: boolean;
  crs_sent_at: string | null;
  crs_number?: string | null;
  carry_finalized?: boolean;
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
  project_code?: string | null;
  document_num?: string | null;
  revision_id?: number | null;
  task_deadline?: string | null;
  is_read: boolean;
  created_at: string;
}

export interface TdoQueueItem {
  revision_id: number;
  project_code: string;
  document_num: string;
  document_title: string;
  revision_code: string;
  issue_purpose: string;
  status: string;
  created_at: string;
  review_deadline: string | null;
  trm_number: string | null;
  file_path: string | null;
  can_publish_to_contractor: boolean;
  author_id?: number | null;
  author_name?: string | null;
  author_email?: string | null;
}

export interface RevisionOverviewItem {
  revision_id: number;
  project_code: string;
  document_num: string;
  document_title: string;
  revision_code: string;
  issue_purpose: string;
  status: string;
  trm_number: string | null;
  review_deadline: string | null;
  file_path: string | null;
  author_id?: number | null;
  author_name?: string | null;
  author_email?: string | null;
  created_at: string;
}

export interface CsrQueueItem {
  comment_id: number;
  trm_number: string | null;
  crs_number?: string | null;
  document_num: string;
  revision_id: number;
  revision_code: string;
  comment_text: string;
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  comment_status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  in_crs: boolean;
  crs_sent_at: string | null;
}

export interface RevisionCommentThread {
  revision_id: number;
  revision_code: string;
  status: string;
  created_at: string;
  comments: CommentItem[];
}

export interface RevisionCard {
  revision_id: number;
  project_code: string;
  document_num: string;
  document_title: string;
  discipline_code: string;
  doc_type: string;
  category: string;
  current_revision_code: string;
  current_status: string;
  planned_dev_start?: string | null;
  planned_issue_date?: string | null;
  actual_first_upload_date?: string | null;
  actual_latest_issue_date?: string | null;
  actual_progress_percent?: number;
  can_current_user_raise_comments: boolean;
  current_user_matrix_role: string | null;
  revisions: Revision[];
  history: RevisionCommentThread[];
}

export interface RegistryRevisionCommentItem {
  id: number;
  text: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  author_id: number;
  created_at: string;
  carry_finalized?: boolean;
}

export interface RegistryRevisionItem {
  id: number;
  revision_code: string;
  issue_purpose: string;
  status: string;
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  trm_number: string | null;
  trm_flag: boolean;
  author_id: number | null;
  author_name: string | null;
  created_at: string;
  comments_count: number;
  open_comments_count: number;
  comments: RegistryRevisionCommentItem[];
}

export interface DocumentRegistryItem {
  document_id: number;
  project_code: string;
  category: string;
  discipline_code: string;
  document_num: string;
  document_title: string;
  latest_revision_code: string | null;
  latest_revision_status: string | null;
  latest_issue_purpose: string | null;
  latest_review_code: "AP" | "AN" | "CO" | "RJ" | null;
  latest_author_name: string | null;
  planned_dev_start?: string | null;
  development_date: string | null;
  first_upload_date: string | null;
  is_overdue?: boolean;
  total_comments_count: number;
  open_comments_count: number;
  revisions: RegistryRevisionItem[];
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
  | "contractor_tdo_lead"
  | "contractor_member"
  | "owner_member"
  | "observer";

export interface ProjectItem {
  id: number;
  code: string;
  name: string;
  document_category: string | null;
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
  user_email?: string | null;
  user_full_name?: string | null;
  user_company_type?: CompanyType | null;
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

export type CipherFieldSourceType = "REFERENCE" | "CUSTOM_TEXT" | "AUTO_SERIAL" | "STATIC";

export interface CipherTemplateField {
  id?: number;
  order_index: number;
  field_key: string;
  label: string;
  source_type: CipherFieldSourceType;
  source_ref_type?: string | null;
  static_value?: string | null;
  length?: number | null;
  required: boolean;
  uppercase: boolean;
  separator: string;
}

export interface CipherTemplate {
  id: number;
  project_id: number;
  project_code: string;
  category: string;
  fields: CipherTemplateField[];
  created_at: string;
  updated_at: string;
}

export interface ReviewMatrixMember {
  id: number;
  project_id: number;
  user_id: number;
  discipline_code: string;
  doc_type: string;
  level: 1 | 2;
  state: "LR" | "R";
  user_email?: string | null;
  user_full_name?: string | null;
  created_at: string;
}
