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
  status: "OPEN" | "CLOSED" | "R_OPEN" | "R_CLOSED";
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
  backlog_status: "IN_NEXT_REVISION" | "REJECTED" | "LR_FINAL_CONFIRM" | null;
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
  lr_reviewer_name?: string | null;
  developer_name?: string | null;
  revisions: Revision[];
  history: RevisionCommentThread[];
}

export interface RegistryRevisionCommentItem {
  id: number;
  text: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  review_code: "AP" | "AN" | "CO" | "RJ" | null;
  contractor_status: "I" | "A" | null;
  is_published_to_contractor: boolean;
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

// --- Модуль Vendors (VQM) ---
export type MrStatus = "DRAFT" | "OPEN" | "CLOSED" | "AWARDED";

export interface MrItem {
  id: number;
  project_id: number;
  code: string;
  title: string;
  description: string | null;
  status: MrStatus;
  lr_user_id: number | null;
  lr_user_name: string | null;
  deadline_at: string | null;
  currency: string;
  created_by_id: number;
  created_at: string;
  updated_at: string;
  equipment_type: string | null;
  req_number: string | null;
  req_rev: string | null;
  discipline_code: string | null;
  tags_count: number;
  owner_items_count: number;
  owner_items_filled: number;
  vendor_items_count: number;
  invitations_count: number;
}

export type MrOwnerCategory = "CHECKLIST_FORM"|"RFD"|"SPARE"|"INSPECTION"|"PROCEDURE"|"DATASHEET"|"SPEC"|"DRAWING"|"OTHER";

export interface MrOwnerFile { id:number; owner_item_id:number; file_name:string; mime:string|null; size_bytes:number|null; created_at:string; }
export interface MrOwnerItem {
  id:number; mr_id:number; order_index:number; att_no:string|null; category:MrOwnerCategory;
  title:string; doc_number:string|null; rev:string|null; is_required:boolean; allow_questions:boolean;
  is_group:boolean; created_at:string; files:MrOwnerFile[];
}
export type MrVendorSection = "BID_INCLUSION"|"BID_NOTES"|"RFD";
export interface MrVendorItem {
  id:number; mr_id:number; order_index:number; section:MrVendorSection; category:string|null;
  code:string|null; title:string; purpose:string|null; with_bid:boolean; is_required:boolean;
  allow_questions:boolean; created_at:string;
}
export interface ReqImportResult { mr_id:number; code:string; tags_created:number; owner_items_created:number; vendor_items_created:number; }

export interface MrTagItem {
  id: number;
  mr_id: number;
  order_index: number;
  sr_no: string | null;
  item_no: string | null;
  tag_code: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  created_at: string;
}

export interface MrDocumentItem {
  id: number;
  mr_id: number;
  title: string;
  file_name: string;
  mime: string | null;
  size_bytes: number | null;
  uploaded_by_id: number;
  created_at: string;
}

export interface VendorInvitationItem {
  id: number;
  mr_id: number;
  vendor_company_name: string;
  vendor_contact_email: string;
  expires_at: string | null;
  revoked_at: string | null;
  email_verified_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface VendorInvitationCreated extends VendorInvitationItem {
  invitation_link: string;
  token: string;
}

export interface VendorMrTagView {
  id: number;
  tag_code: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
}

export interface VendorMrDocumentView {
  id: number;
  title: string;
  file_name: string;
  size_bytes: number | null;
}
export interface VendorMrChecklistItem {
  id:number; section:MrVendorSection; category:string|null; code:string|null;
  title:string; purpose:string|null; with_bid:boolean; allow_questions:boolean;
}

export interface VendorMrView {
  mr_id: number;
  code: string;
  title: string;
  description: string | null;
  currency: string;
  deadline_at: string | null;
  status: MrStatus;
  is_open: boolean;
  vendor_company_name: string;
  tags: VendorMrTagView[];
  documents: VendorMrDocumentView[];
  checklist: VendorMrChecklistItem[];
  my_quotes: VendorMyQuote[];
  my_responses: VendorMyResponse[];
}

export type VendorAnswer = "YES" | "NO" | "NA";
export interface VendorMyQuote { tag_id:number; price:number|null; currency:string|null; note:string|null; }
export interface VendorMyResponse { vendor_item_id:number; answer:VendorAnswer|null; note:string|null; file_name:string|null; upload_id:number|null; }

export interface VendorReportVendor { invitation_id:number; company_name:string; submitted:boolean; total_price:number|null; }
export interface VendorReportCell { invitation_id:number; price:number|null; note:string|null; }
export interface VendorReportRow { tag_id:number; sr_no:string|null; item_no:string|null; name:string; quantity:number|null; unit:string|null; cells:VendorReportCell[]; min_invitation_id:number|null; }
export interface VendorReport { mr_id:number; code:string; currency:string; vendors:VendorReportVendor[]; rows:VendorReportRow[]; }

export interface MrQuestionReply { id:number; body:string; is_owner:boolean; author_label:string; created_at:string; }
export interface MrQuestionItem {
  id:number; body:string; author_label:string; is_public:boolean;
  mr_owner_item_id:number|null; mr_vendor_item_id:number|null; created_at:string; replies:MrQuestionReply[];
}
