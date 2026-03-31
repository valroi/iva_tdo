from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import (
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
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectRead(BaseModel):
    id: int
    code: str
    name: str
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


class ReviewMatrixMemberCreate(BaseModel):
    user_id: int
    discipline_code: str
    doc_type: str
    level: int = Field(ge=1, le=2, default=1)
    state: str = Field(default="R", pattern="^(LR|R)$")


class ReviewMatrixMemberUpdate(BaseModel):
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


class MDRCreate(MDRBase):
    pass


class MDRUpdate(BaseModel):
    doc_name: str | None = None
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

    model_config = ConfigDict(from_attributes=True)


class RevisionTdoDecision(BaseModel):
    action: str = Field(pattern="^(SEND_TO_OWNER|CANCELLED)$")
    note: str | None = None


class CommentCreate(BaseModel):
    revision_id: int
    text: str
    status: CommentStatus = CommentStatus.OPEN
    page: int | None = None
    area_x: float | None = None
    area_y: float | None = None
    area_w: float | None = None
    area_h: float | None = None


class CommentResponse(BaseModel):
    text: str
    status: CommentStatus = CommentStatus.IN_PROGRESS
    backlog_status: str | None = Field(default=None, pattern="^(IN_NEXT_REVISION|REJECTED)$")


class CommentOwnerDecision(BaseModel):
    action: str = Field(pattern="^(PUBLISH|REJECT)$")
    note: str | None = None


class CommentRead(BaseModel):
    id: int
    revision_id: int
    parent_id: int | None
    author_id: int
    text: str
    status: CommentStatus
    is_published_to_contractor: bool = False
    backlog_status: str | None = None
    page: int | None
    area_x: float | None
    area_y: float | None
    area_w: float | None
    area_h: float | None
    created_at: datetime
    resolved_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


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
    file_path: str | None
    author_id: int | None = None
    author_name: str | None = None
    author_email: str | None = None


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


class FileUploadResponse(BaseModel):
    file_name: str
    file_path: str
    content_type: str
    file_size: int
