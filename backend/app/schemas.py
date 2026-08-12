from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import (
    ContractorCommentStatus,
    CommentStatus,
    CompanyType,
    ProjectMemberRole,
    RegistrationRequestStatus,
    ReviewCode,
    UserRole,
)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str
    company_type: CompanyType
    requested_role: UserRole | None = None


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    company_code: str | None = None
    company_type: CompanyType
    role: UserRole


class UserCreate(UserBase):
    password: str = Field(min_length=6)
    permissions: dict[str, bool] | None = None


class UserRead(UserBase):
    id: int
    is_active: bool
    permissions: dict[str, bool]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectCreate(BaseModel):
    code: str
    name: str
    document_category: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    document_category: str | None = None
    description: str | None = None


class ProjectRead(BaseModel):
    id: int
    code: str
    name: str
    document_category: str | None
    description: str | None
    created_by_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectMemberCreate(BaseModel):
    user_id: int
    member_role: ProjectMemberRole


class ProjectMemberRead(BaseModel):
    id: int
    project_id: int
    user_id: int
    member_role: ProjectMemberRole
    can_manage_contractor_users: bool
    user_email: str | None = None
    user_full_name: str | None = None
    user_company_type: CompanyType | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectReferenceCreate(BaseModel):
    ref_type: str
    code: str
    value: str
    is_active: bool = True


class ProjectReferenceUpdate(BaseModel):
    value: str | None = None
    is_active: bool | None = None


class ProjectReferenceRead(BaseModel):
    id: int
    project_id: int
    ref_type: str
    code: str
    value: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CipherTemplateFieldBase(BaseModel):
    order_index: int = 0
    field_key: str
    label: str
    source_type: str = Field(pattern="^(REFERENCE|CUSTOM_TEXT|AUTO_SERIAL|STATIC)$")
    source_ref_type: str | None = None
    static_value: str | None = None
    length: int | None = Field(default=None, ge=1, le=40)
    required: bool = True
    uppercase: bool = True
    separator: str = "-"


class CipherTemplateFieldRead(CipherTemplateFieldBase):
    id: int


class CipherTemplateRead(BaseModel):
    id: int
    project_id: int
    project_code: str
    category: str
    fields: list[CipherTemplateFieldRead]
    created_at: datetime
    updated_at: datetime


class CipherTemplateUpsert(BaseModel):
    fields: list[CipherTemplateFieldBase]


class ReviewMatrixMemberCreate(BaseModel):
    user_id: int
    discipline_code: str
    doc_type: str
    level: int = Field(ge=1, le=2, default=1)
    state: str = Field(default="R", pattern="^(LR|R)$")


class ReviewMatrixMemberUpdate(BaseModel):
    discipline_code: str | None = None
    doc_type: str | None = None
    level: int | None = Field(default=None, ge=1, le=2)
    state: str | None = Field(default=None, pattern="^(LR|R)$")


class ReviewMatrixMemberRead(BaseModel):
    id: int
    project_id: int
    user_id: int
    discipline_code: str
    doc_type: str
    level: int
    state: str
    user_email: str | None = None
    user_full_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MDRBase(BaseModel):
    document_key: str
    project_code: str
    originator_code: str
    category: str
    title_object: str
    discipline_code: str
    doc_type: str
    serial_number: str
    doc_number: str
    doc_name: str
    planned_dev_start: date | None = None
    progress_percent: float = 0
    doc_weight: float = 0
    issue_purpose: str | None = None
    revision: str | None = None
    revision_date: date | None = None
    dates: dict = Field(default_factory=dict)
    trm_number: str | None = None
    review_code: ReviewCode | None = None
    status: str = "DRAFT"
    contractor_responsible_id: int | None = None
    owner_responsible_id: int | None = None
    note: str | None = None
    is_confidential: bool = False
    parent_id: int | None = None


class MDRCreate(MDRBase):
    pass


class MDRChildCreate(BaseModel):
    """Вложенный документ под родительским (напр. программа изысканий).
    Наследует шифровочные поля родителя; шифр = шифр родителя + "-" + номер."""
    doc_name: str
    doc_weight: float = 0
    planned_dev_start: date | None = None
    serial: str | None = None  # если пусто — авто (следующий среди детей)


class MDRUpdate(BaseModel):
    # Поля шифра: редактируемы, чтобы можно было исправить ошибочно
    # созданный документ (шифр пересобирается на фронте, бэк проверяет
    # уникальность и синхронизирует связанный Document).
    document_key: str | None = None
    originator_code: str | None = None
    category: str | None = None
    title_object: str | None = None
    discipline_code: str | None = None
    doc_type: str | None = None
    serial_number: str | None = None
    doc_number: str | None = None
    parent_id: int | None = None
    doc_name: str | None = None
    planned_dev_start: date | None = None
    progress_percent: float | None = None
    doc_weight: float | None = None
    issue_purpose: str | None = None
    revision: str | None = None
    revision_date: date | None = None
    dates: dict | None = None
    trm_number: str | None = None
    review_code: ReviewCode | None = None
    status: str | None = None
    contractor_responsible_id: int | None = None
    owner_responsible_id: int | None = None
    note: str | None = None
    is_confidential: bool | None = None


class MDRRead(MDRBase):
    id: int
    created_at: datetime
    updated_at: datetime
    # Эффективный код замечаний по последней ревизии документа (AN/CO/RJ/AP)
    # для отображения в реестре; None — если ревизий/замечаний ещё нет.
    latest_effective_review_code: str | None = None

    model_config = ConfigDict(from_attributes=True)


class DocumentCreate(BaseModel):
    mdr_id: int
    document_num: str
    title: str
    discipline: str
    weight: float = 0


class DocumentRead(BaseModel):
    id: int
    mdr_id: int
    document_num: str
    title: str
    discipline: str
    weight: float
    created_by_id: int
    latest_revision_code: str | None = None
    latest_revision_status: str | None = None
    latest_review_code: ReviewCode | None = None
    latest_issue_purpose: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RevisionCreate(BaseModel):
    document_id: int
    revision_code: str
    issue_purpose: str
    author_id: int | None = None
    status: str = "SUBMITTED"
    trm_number: str | None = None
    file_path: str | None = None
    review_deadline: date | None = None


class RevisionRead(BaseModel):
    id: int
    document_id: int
    revision_code: str
    issue_purpose: str
    author_id: int | None
    status: str
    trm_number: str | None
    file_path: str | None
    review_code: ReviewCode | None
    review_deadline: date | None
    created_at: datetime
    reviewed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class DocumentAttachmentRead(BaseModel):
    id: int
    document_id: int
    revision_id: int | None = None
    uploaded_by_id: int
    uploaded_by_name: str | None = None
    uploaded_by_email: str | None = None
    file_name: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RevisionTdoDecision(BaseModel):
    action: str = Field(pattern="^(SEND_TO_OWNER|CANCELLED)$")
    note: str | None = None


class RevisionTdoBulkDecision(BaseModel):
    revision_ids: list[int]
    action: str = Field(pattern="^(SEND_TO_OWNER|CANCELLED)$")
    note: str | None = None


class RevisionReviewCodeUpdate(BaseModel):
    review_code: ReviewCode = ReviewCode.AP


class CarryDecisionUpdate(BaseModel):
    source_comment_id: int
    status: str = Field(pattern="^(OPEN|CLOSED)$")


class CarryDecisionRead(BaseModel):
    id: int
    target_revision_id: int
    source_comment_id: int
    status: str
    decided_by_id: int
    decided_by_name: str | None = None
    decided_by_email: str | None = None
    decided_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CommentCreate(BaseModel):
    revision_id: int
    text: str
    status: CommentStatus = CommentStatus.OPEN
    review_code: ReviewCode | None = None
    page: int | None = None
    area_x: float | None = None
    area_y: float | None = None
    area_w: float | None = None
    area_h: float | None = None


class CommentResponse(BaseModel):
    text: str
    status: CommentStatus = CommentStatus.IN_PROGRESS
    backlog_status: str | None = Field(default=None, pattern="^(IN_NEXT_REVISION|REJECTED|LR_FINAL_CONFIRM)$")
    contractor_status: ContractorCommentStatus | None = None


class CommentOwnerDecision(BaseModel):
    action: str = Field(pattern="^(PUBLISH|REJECT|WITHDRAW|UPDATE|FINAL_CONFIRM|REOPEN)$")
    review_code: ReviewCode | None = None
    note: str | None = None
    text: str | None = None


class CommentRead(BaseModel):
    id: int
    revision_id: int
    parent_id: int | None
    author_id: int
    author_name: str | None = None
    author_email: str | None = None
    text: str
    status: CommentStatus
    review_code: ReviewCode | None = None
    is_published_to_contractor: bool = False
    backlog_status: str | None = None
    contractor_status: ContractorCommentStatus | None = None
    contractor_response_text: str | None = None
    contractor_response_at: datetime | None = None
    in_crs: bool = False
    crs_sent_at: datetime | None = None
    crs_number: str | None = None
    remark_number: str | None = None
    carry_finalized: bool = False
    page: int | None
    area_x: float | None
    area_y: float | None
    area_w: float | None
    area_h: float | None
    created_at: datetime
    resolved_at: datetime | None
    attachment_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class RemarkHistoryEvent(BaseModel):
    """Шаг жизненного цикла замечания для карточки по номеру."""
    at: datetime
    kind: str          # CREATED | CRS_SENT | CONTRACTOR_REPLY | LR_DECISION | CARRY_OVER
    title: str
    actor: str | None = None
    detail: str | None = None


class RemarkCardRead(BaseModel):
    id: int
    remark_number: str | None = None
    project_code: str
    document_num: str
    document_title: str
    revision_id: int
    revision_code: str
    issue_purpose: str
    page: int | None = None
    review_code: ReviewCode | None = None
    status: CommentStatus
    contractor_status: ContractorCommentStatus | None = None
    text: str
    author_name: str | None = None
    author_email: str | None = None
    created_at: datetime
    crs_number: str | None = None
    crs_sent_at: datetime | None = None
    is_published_to_contractor: bool = False
    attachments: list["CommentAttachmentRead"] = Field(default_factory=list)
    history: list[RemarkHistoryEvent] = Field(default_factory=list)


class CommentAttachmentRead(BaseModel):
    id: int
    comment_id: int
    uploaded_by_id: int
    uploaded_by_name: str | None = None
    uploaded_by_email: str | None = None
    file_name: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RevisionRegistryCommentRead(BaseModel):
    id: int
    parent_id: int | None = None
    remark_number: str | None = None
    text: str
    status: CommentStatus
    review_code: ReviewCode | None = None
    in_crs: bool = False
    contractor_status: ContractorCommentStatus | None = None
    is_published_to_contractor: bool = False
    author_id: int
    created_at: datetime
    carry_finalized: bool = False


class RevisionRegistryRead(BaseModel):
    id: int
    revision_code: str
    issue_purpose: str
    status: str
    review_code: ReviewCode | None = None
    trm_number: str | None = None
    trm_flag: bool = False
    author_id: int | None = None
    author_name: str | None = None
    created_at: datetime
    comments_count: int = 0
    open_comments_count: int = 0
    comments: list[RevisionRegistryCommentRead] = Field(default_factory=list)


class DocumentRegistryRead(BaseModel):
    document_id: int
    project_code: str
    category: str
    discipline_code: str
    document_num: str
    document_title: str
    latest_revision_code: str | None = None
    latest_revision_status: str | None = None
    latest_issue_purpose: str | None = None
    latest_review_code: ReviewCode | None = None
    latest_author_name: str | None = None
    planned_dev_start: date | None = None
    development_date: datetime | None = None
    first_upload_date: datetime | None = None
    is_overdue: bool = False
    total_comments_count: int = 0
    open_comments_count: int = 0
    revisions: list[RevisionRegistryRead] = Field(default_factory=list)


class WorkflowStatusCreate(BaseModel):
    code: str
    name: str
    color: str = "#1677ff"
    description: str | None = None
    is_final: bool = False
    editable: bool = True


class WorkflowStatusUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    description: str | None = None
    is_final: bool | None = None
    editable: bool | None = None


class WorkflowStatusRead(BaseModel):
    id: int
    code: str
    name: str
    color: str
    description: str | None
    is_final: bool
    editable: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationRead(BaseModel):
    id: int
    user_id: int
    event_type: str
    message: str
    project_code: str | None = None
    document_num: str | None = None
    revision_id: int | None = None
    task_deadline: date | None = None
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserRoleUpdate(BaseModel):
    role: UserRole


class UserActivationUpdate(BaseModel):
    is_active: bool


class UserPermissionsUpdate(BaseModel):
    permissions: dict[str, bool]


class UserPasswordUpdate(BaseModel):
    new_password: str = Field(min_length=6)


class MyPasswordUpdate(BaseModel):
    # Самостоятельная смена пароля: текущий пароль обязателен, чтобы
    # оставленную без присмотра сессию нельзя было превратить в захват аккаунта.
    current_password: str
    new_password: str = Field(min_length=6)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    company_code: str | None = None
    company_type: CompanyType | None = None
    is_active: bool | None = None


class UserSessionRead(BaseModel):
    id: int
    user_id: int
    ip_address: str | None
    country: str | None
    user_agent: str | None
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    is_active: bool = False

    model_config = ConfigDict(from_attributes=True)


class RegistrationRequestRead(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    company_type: CompanyType
    requested_role: UserRole | None
    status: RegistrationRequestStatus
    review_note: str | None
    reviewed_by_id: int | None
    created_at: datetime
    reviewed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class RegistrationApprovePayload(BaseModel):
    role: UserRole = UserRole.user
    company_type: CompanyType | None = None
    is_active: bool = True


class RegistrationRejectPayload(BaseModel):
    review_note: str | None = None


class QuickDemoSetupRequest(BaseModel):
    contractor_email: EmailStr = "contractor.demo@ivamaris.io"
    owner_email: EmailStr = "owner.demo@ivamaris.io"
    password: str = Field(default="DemoPass123!", min_length=6)


class QuickDemoSetupResponse(BaseModel):
    contractor_email: EmailStr
    owner_email: EmailStr
    password: str
    mdr_id: int
    document_id: int
    revision_id: int
    comment_id: int


class TdoQueueItem(BaseModel):
    revision_id: int
    project_code: str
    document_num: str
    document_title: str
    revision_code: str
    issue_purpose: str
    status: str
    created_at: datetime
    review_deadline: date | None
    trm_number: str | None = None
    file_path: str | None
    can_publish_to_contractor: bool = False
    author_id: int | None = None
    author_name: str | None = None
    author_email: str | None = None


class CsrQueueItem(BaseModel):
    comment_id: int
    trm_number: str | None = None
    crs_number: str | None = None
    document_num: str
    revision_id: int
    revision_code: str
    comment_text: str
    review_code: ReviewCode | None = None
    comment_status: CommentStatus
    in_crs: bool
    crs_sent_at: datetime | None = None


class CsrSendPayload(BaseModel):
    comment_ids: list[int] = Field(default_factory=list)


class RevisionOverviewRead(BaseModel):
    revision_id: int
    project_code: str
    document_num: str
    document_title: str
    revision_code: str
    issue_purpose: str
    status: str
    trm_number: str | None
    review_deadline: date | None
    file_path: str | None
    author_id: int | None = None
    author_name: str | None = None
    author_email: str | None = None
    created_at: datetime


class TrmRevisionItem(BaseModel):
    revision_id: int
    document_num: str
    document_title: str
    revision_code: str
    issue_purpose: str
    status: str
    review_code: ReviewCode | None = None
    created_at: datetime


class TrmListItem(BaseModel):
    trm_number: str
    project_code: str
    document_count: int
    last_status: str | None = None
    review_deadline: date | None = None
    revisions: list[TrmRevisionItem] = Field(default_factory=list)


class PublishCommentsResult(BaseModel):
    revision_id: int
    published_count: int


class RevisionCommentThreadRead(BaseModel):
    revision_id: int
    revision_code: str
    status: str
    created_at: datetime
    comments: list[CommentRead]


class RevisionCardRead(BaseModel):
    revision_id: int
    project_code: str
    document_num: str
    document_title: str
    discipline_code: str
    doc_type: str
    category: str
    current_revision_code: str
    current_status: str
    planned_dev_start: date | None = None
    planned_issue_date: date | None = None
    actual_first_upload_date: datetime | None = None
    actual_latest_issue_date: datetime | None = None
    actual_progress_percent: float = 0
    can_current_user_raise_comments: bool = True
    current_user_matrix_role: str | None = None
    is_observer: bool = False
    lr_reviewer_name: str | None = None
    developer_name: str | None = None
    revisions: list[RevisionRead]
    history: list[RevisionCommentThreadRead]


class AdminReviewSlaSettingsRead(BaseModel):
    initial_days: float
    next_days: float
    owner_dcc_incoming_days: float
    owner_specialist_review_days: float
    owner_lr_approval_days: float
    contractor_consideration_days: float
    contractor_ap_issue_days: float
    contractor_an_issue_days: float
    contractor_co_rj_issue_days: float
    owner_final_approval_days: float
    owner_stamp_days: float


class AdminReviewSlaSettingsUpdate(BaseModel):
    initial_days: float = Field(ge=0.1, le=365)
    next_days: float = Field(ge=0.1, le=365)
    owner_dcc_incoming_days: float = Field(ge=0.1, le=60)
    owner_specialist_review_days: float = Field(ge=0.1, le=60)
    owner_lr_approval_days: float = Field(ge=0.1, le=60)
    contractor_consideration_days: float = Field(ge=0.1, le=60)
    contractor_ap_issue_days: float = Field(ge=0.1, le=60)
    contractor_an_issue_days: float = Field(ge=0.1, le=60)
    contractor_co_rj_issue_days: float = Field(ge=0.1, le=60)
    owner_final_approval_days: float = Field(ge=0.1, le=60)
    owner_stamp_days: float = Field(ge=0.1, le=60)


class ReviewEventRead(BaseModel):
    id: int
    revision_id: int
    project_code: str
    document_num: str
    discipline_code: str | None = None
    revision_code: str | None = None
    actor_id: int | None = None
    actor_name: str | None = None
    actor_role: str
    event_type: str
    target_user_id: int | None = None
    target_name: str | None = None
    deadline: date | None = None
    note: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReviewerStateRead(BaseModel):
    user_id: int
    full_name: str
    email: str
    role: str  # LR | R
    no_comments: bool
    has_comments: bool
    decided_at: datetime | None = None


class RevisionReviewerSummary(BaseModel):
    revision_id: int
    reviewers: list[ReviewerStateRead]
    all_reviewers_no_comments: bool
    approved: bool = False
    nc_locks_commenting: bool
    my_locked: bool


class ReviewFlagsRead(BaseModel):
    nc_locks_commenting: bool


class ReviewFlagsUpdate(BaseModel):
    nc_locks_commenting: bool


class ReviewReportRow(BaseModel):
    document_num: str
    revision_code: str | None = None
    discipline_code: str | None = None
    reviewer_name: str
    reviewer_role: str  # LR | R
    assigned_at: datetime
    deadline: date | None = None
    acted_at: datetime | None = None
    action_label: str  # что сделал (или «не рассмотрено»)
    status: str  # DONE_ON_TIME | DONE_LATE | OPEN_ON_TIME | OVERDUE
    days_overdue: int | None = None


class FileUploadResponse(BaseModel):
    file_name: str
    file_path: str
    content_type: str
    file_size: int


# =====================================================================
#  Модуль Vendors (VQM)
# =====================================================================

from app.models import MrStatus, MrQuestionVisibility  # noqa: E402


class MrCreate(BaseModel):
    project_id: int
    code: str
    title: str
    description: str | None = None
    lr_user_id: int | None = None
    deadline_at: datetime | None = None
    currency: str = "RUB"


class MrUpdate(BaseModel):
    title: str | None = None
    equipment_type: str | None = None
    description: str | None = None
    lr_user_id: int | None = None
    deadline_at: datetime | None = None
    currency: str | None = None
    status: MrStatus | None = None


class MrRead(BaseModel):
    id: int
    project_id: int
    code: str
    title: str
    description: str | None
    status: MrStatus
    lr_user_id: int | None
    lr_user_name: str | None = None
    deadline_at: datetime | None
    currency: str
    created_by_id: int
    created_at: datetime
    updated_at: datetime
    equipment_type: str | None = None
    req_number: str | None = None
    req_rev: str | None = None
    discipline_code: str | None = None
    tags_count: int = 0
    owner_items_count: int = 0
    owner_items_filled: int = 0
    vendor_items_count: int = 0
    invitations_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class MrTagCreate(BaseModel):
    sr_no: str | None = None
    item_no: str | None = None
    tag_code: str
    name: str
    quantity: float | None = None
    unit: str | None = None
    note: str | None = None
    order_index: int = 0


class MrTagUpdate(BaseModel):
    tag_code: str | None = None
    name: str | None = None
    quantity: float | None = None
    unit: str | None = None
    note: str | None = None
    order_index: int | None = None


class MrTagRead(BaseModel):
    id: int
    mr_id: int
    order_index: int
    sr_no: str | None
    item_no: str | None
    tag_code: str
    name: str
    quantity: float | None
    unit: str | None
    note: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


from app.models import MrOwnerItemCategory, MrVendorItemSection, VendorItemAnswer  # noqa: E402


# --- Чек-лист заказчика (owner items + files) ---
class MrOwnerFileRead(BaseModel):
    id: int
    owner_item_id: int
    file_name: str
    mime: str | None
    size_bytes: int | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MrOwnerItemCreate(BaseModel):
    att_no: str | None = None
    category: MrOwnerItemCategory = MrOwnerItemCategory.OTHER
    title: str
    doc_number: str | None = None
    rev: str | None = None
    is_required: bool = True
    allow_questions: bool = False
    is_group: bool = False
    order_index: int = 0


class MrOwnerItemUpdate(BaseModel):
    att_no: str | None = None
    category: MrOwnerItemCategory | None = None
    title: str | None = None
    doc_number: str | None = None
    rev: str | None = None
    is_required: bool | None = None
    allow_questions: bool | None = None
    order_index: int | None = None


class MrOwnerItemRead(BaseModel):
    id: int
    mr_id: int
    order_index: int
    att_no: str | None
    category: MrOwnerItemCategory
    title: str
    doc_number: str | None
    rev: str | None
    is_required: bool
    allow_questions: bool
    is_group: bool = False
    created_at: datetime
    files: list[MrOwnerFileRead] = []

    model_config = ConfigDict(from_attributes=True)


# --- Чек-лист подрядчика (vendor items — шаблон) ---
class MrVendorItemCreate(BaseModel):
    section: MrVendorItemSection
    category: str | None = None
    code: str | None = None
    title: str
    purpose: str | None = None
    with_bid: bool = False
    is_required: bool = True
    allow_questions: bool = False
    order_index: int = 0


class MrVendorItemUpdate(BaseModel):
    section: MrVendorItemSection | None = None
    category: str | None = None
    code: str | None = None
    title: str | None = None
    purpose: str | None = None
    with_bid: bool | None = None
    is_required: bool | None = None
    allow_questions: bool | None = None
    order_index: int | None = None


class MrVendorItemRead(BaseModel):
    id: int
    mr_id: int
    order_index: int
    section: MrVendorItemSection
    category: str | None
    code: str | None
    title: str
    purpose: str | None
    with_bid: bool
    is_required: bool
    allow_questions: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Импорт REQ (.docx → структура MR) ---
class ReqImportPreview(BaseModel):
    title: str
    equipment_type: str | None
    req_number: str | None
    discipline_code: str | None
    tags: list[dict]
    owner_items: list[dict]
    vendor_items: list[dict]


class ReqImportResult(BaseModel):
    mr_id: int
    code: str
    tags_created: int
    owner_items_created: int
    vendor_items_created: int


# --- VQM: приглашения и гостевой портал ---

class VendorInvitationCreate(BaseModel):
    vendor_company_name: str
    vendor_contact_email: EmailStr
    expires_at: datetime | None = None


class VendorInvitationRead(BaseModel):
    id: int
    mr_id: int
    vendor_company_name: str
    vendor_contact_email: str
    expires_at: datetime | None
    revoked_at: datetime | None
    email_verified_at: datetime | None
    last_seen_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VendorInvitationCreated(VendorInvitationRead):
    # Одноразовая выдача ссылки и токена — только при создании.
    invitation_link: str
    token: str
    email_sent: bool = False          # письмо реально ушло через SMTP
    email_note: str | None = None     # причина, если не ушло


class VendorRequestCode(BaseModel):
    token: str


class VendorVerify(BaseModel):
    token: str
    code: str


class VendorSessionResponse(BaseModel):
    session_token: str
    mr_code: str
    mr_title: str


# Гостевое представление MR (read-only состав, без чужих данных).
class VendorMrTagView(BaseModel):
    id: int
    tag_code: str
    name: str
    quantity: float | None
    unit: str | None
    note: str | None

    model_config = ConfigDict(from_attributes=True)


class VendorMrDocumentView(BaseModel):
    id: int
    title: str
    file_name: str
    size_bytes: int | None

    model_config = ConfigDict(from_attributes=True)


class VendorMrChecklistItem(BaseModel):
    id: int
    section: str
    category: str | None
    code: str | None
    title: str
    purpose: str | None
    with_bid: bool
    allow_questions: bool


class VendorMrView(BaseModel):
    mr_id: int
    code: str
    title: str
    description: str | None
    currency: str
    deadline_at: datetime | None
    status: MrStatus
    is_open: bool
    vendor_company_name: str
    submitted: bool = False
    tags: list[VendorMrTagView]
    documents: list[VendorMrDocumentView]
    checklist: list[VendorMrChecklistItem] = []
    my_quotes: list[VendorMyQuote] = []
    my_responses: list[VendorMyResponse] = []


class VendorSubmitResult(BaseModel):
    status: str
    missing_prices: list[str] = []      # коды тегов без цены
    missing_required: list[str] = []    # требования без ответа/файла


# --- VQM PR-4b: ответы подрядчика (цены + чек-лист) ---
class VendorQuoteSet(BaseModel):
    tag_id: int
    price: float | None = None
    currency: str | None = None
    note: str | None = None


class VendorChecklistAnswerSet(BaseModel):
    vendor_item_id: int
    answer: VendorItemAnswer | None = None
    note: str | None = None


class VendorMyQuote(BaseModel):
    tag_id: int
    price: float | None
    currency: str | None
    note: str | None


class VendorMyResponse(BaseModel):
    vendor_item_id: int
    answer: VendorItemAnswer | None
    note: str | None
    file_name: str | None = None
    upload_id: int | None = None


# --- VQM PR-5: сводный отчёт теги × подрядчики × цены ---
class VendorReportVendor(BaseModel):
    invitation_id: int
    company_name: str
    submitted: bool          # вошёл ли (email_verified) — есть ли участие
    total_price: float | None


class VendorReportCell(BaseModel):
    invitation_id: int
    price: float | None
    note: str | None


class VendorReportRow(BaseModel):
    tag_id: int
    sr_no: str | None
    item_no: str | None
    name: str
    quantity: float | None
    unit: str | None
    cells: list[VendorReportCell]
    min_invitation_id: int | None    # подрядчик с минимальной ценой (подсветка)


class VendorReport(BaseModel):
    mr_id: int
    code: str
    currency: str
    vendors: list[VendorReportVendor]
    rows: list[VendorReportRow]


# --- VQM PR-4c: вопросы/ответы (Q&A) ---
class VendorQuestionCreate(BaseModel):
    body: str
    mr_owner_item_id: int | None = None
    mr_vendor_item_id: int | None = None


class QuestionAnswerCreate(BaseModel):
    body: str


class QuestionVisibilitySet(BaseModel):
    public: bool


class MrQuestionReply(BaseModel):
    id: int
    body: str
    is_owner: bool                 # ответ заказчика (LR) или реплика подрядчика
    author_label: str              # «Заказчик» / название компании / «Поставщик»
    created_at: datetime


class MrQuestionRead(BaseModel):
    id: int
    body: str
    author_label: str
    is_public: bool
    mr_owner_item_id: int | None
    mr_vendor_item_id: int | None
    created_at: datetime
    replies: list[MrQuestionReply] = []


# =====================================================================
#  Модуль FEED
# =====================================================================

from app.models import FeedDocClass, FeedFileKind, FeedFileLang  # noqa: E402


class FeedFileRead(BaseModel):
    id: int
    feed_document_id: int
    kind: FeedFileKind
    lang: FeedFileLang
    rev: str | None
    file_name: str
    mime: str | None
    size_bytes: int | None
    created_at: datetime
    is_master: bool = False    # PDF-ревизия — главная (финальная) версия
    is_editable: bool = False  # не-PDF (docx/xls…) — редактируемый, не главный

    model_config = ConfigDict(from_attributes=True)


class FeedDocumentRead(BaseModel):
    id: int
    project_id: int
    discipline_code: str
    doc_number: str
    title_en: str | None
    title_ru: str | None
    doc_class: FeedDocClass
    doc_type: str | None
    latest_rev: str | None
    issue_purpose: str | None
    rev_date: str | None
    created_at: datetime
    updated_at: datetime
    files: list[FeedFileRead] = []
    has_acrs: bool = False
    master_langs: list[str] = []        # языки главных (PDF) версий
    incomplete: bool = False            # не хватает обязательной версии
    incomplete_reason: str | None = None

    model_config = ConfigDict(from_attributes=True)


class FeedDocumentUpdate(BaseModel):
    discipline_code: str | None = None
    doc_number: str | None = None
    title_en: str | None = None
    title_ru: str | None = None
    doc_class: FeedDocClass | None = None
    doc_type: str | None = None
    latest_rev: str | None = None
    issue_purpose: str | None = None


class FeedUploadItemResult(BaseModel):
    file_name: str
    status: str                 # created | updated | duplicate | failed
    doc_number: str | None = None
    document_id: int | None = None
    detected_from: str | None = None  # stamp | filename | none
    message: str | None = None


class FeedUploadResult(BaseModel):
    items: list[FeedUploadItemResult]
    created: int
    updated: int
    failed: int
    duplicate: int = 0


class FeedSearchHit(BaseModel):
    document_id: int
    doc_number: str
    title_en: str | None
    title_ru: str | None
    discipline_code: str
    latest_rev: str | None
    snippet: str | None


class FeedAskResult(BaseModel):
    answer: str
    mode: str                    # ai | keyword
    sources: list[FeedSearchHit] = []


class MrFeedLink(BaseModel):
    owner_item_id: int
    owner_doc_number: str
    owner_rev: str | None
    feed_document_id: int | None
    feed_latest_rev: str | None
    feed_file_id: int | None = None   # основной файл из FEED для скачивания
    feed_file_name: str | None = None
    rev_mismatch: bool
