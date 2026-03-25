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
    company_type: CompanyType
    role: UserRole


class UserCreate(UserBase):
    password: str = Field(min_length=6)
    originator_code: str | None = None
    can_manage_mdr: bool = False
    can_manage_project_members: bool = False


class UserRead(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    originator_code: str | None = None
    can_manage_mdr: bool = False
    can_manage_project_members: bool = False

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
    member_role: ProjectMemberRole = ProjectMemberRole.observer


class ProjectMemberRead(BaseModel):
    id: int
    project_id: int
    user_id: int
    member_role: ProjectMemberRole
    can_manage_contractor_users: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectReferenceCreate(BaseModel):
    ref_type: str
    code: str
    value: str
    is_active: bool = True


class ProjectReferenceUpdate(BaseModel):
    ref_type: str | None = None
    code: str | None = None
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


class ProjectReferenceBulkDeleteRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=2000)


class ProjectReferenceBulkDeleteResponse(BaseModel):
    deleted_count: int


class AdminDataResetResponse(BaseModel):
    deleted_project_references: int
    deleted_project_members: int
    deleted_comments: int
    deleted_revisions: int
    deleted_documents: int
    deleted_mdr_records: int
    deleted_projects: int
    deleted_notifications: int
    deleted_registration_requests: int
    deleted_users: int


class MDRBase(BaseModel):
    document_key: str
    project_code: str
    category: str
    title_object: str
    discipline_code: str
    doc_type: str
    originator_code: str | None = None
    serial_number: str | None = None
    doc_number: str | None = None
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
    pd_book: str | None = None


class MDRUpdate(BaseModel):
    category: str | None = None
    title_object: str | None = None
    discipline_code: str | None = None
    doc_type: str | None = None
    pd_book: str | None = None
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


class MDRBulkRow(BaseModel):
    document_key: str
    title_object: str
    discipline_code: str
    doc_type: str
    doc_name: str
    doc_weight: float = 0
    progress_percent: float = 0
    status: str = "DRAFT"
    note: str | None = None
    is_confidential: bool = False
    contractor_responsible_id: int | None = None
    owner_responsible_id: int | None = None


class MDRBulkCreate(BaseModel):
    project_code: str
    category: str
    rows: list[MDRBulkRow] = Field(min_length=1, max_length=1000)


class MDRRead(MDRBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MDRDocNumberPreviewRequest(BaseModel):
    project_code: str
    category: str
    title_object: str
    discipline_code: str
    doc_type: str
    pd_book: str | None = None


class MDRDocNumberPreviewResponse(BaseModel):
    doc_number: str


class MDRBulkCreateRequest(BaseModel):
    items: list[MDRCreate] = Field(min_length=1, max_length=1000)


class MDRImportError(BaseModel):
    row: int
    error: str


class MDRBulkImportResponse(BaseModel):
    created_count: int
    failed_count: int
    created_ids: list[int]
    errors: list[MDRImportError]


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
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RevisionCreate(BaseModel):
    document_id: int
    revision_code: str
    issue_purpose: str
    status: str = "SUBMITTED"
    trm_number: str | None = None
    file_path: str | None = None
    review_deadline: date | None = None


class RevisionRead(BaseModel):
    id: int
    document_id: int
    revision_code: str
    issue_purpose: str
    status: str
    trm_number: str | None
    file_path: str | None
    review_code: ReviewCode | None
    review_deadline: date | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


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


class CommentRead(BaseModel):
    id: int
    revision_id: int
    parent_id: int | None
    author_id: int
    text: str
    status: CommentStatus
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
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserRoleUpdate(BaseModel):
    role: UserRole


class UserActivationUpdate(BaseModel):
    is_active: bool


class UserPermissionUpdate(BaseModel):
    originator_code: str | None = None
    can_manage_mdr: bool
    can_manage_project_members: bool


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
    role: UserRole = UserRole.viewer
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


class FileUploadResponse(BaseModel):
    file_name: str
    file_path: str
    content_type: str
    file_size: int


class DataResetResponse(BaseModel):
    message: str
    deleted: dict[str, int]
    kept_admin_emails: list[EmailStr]
