from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import CommentStatus, CompanyType, ReviewCode, UserRole


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    company_type: CompanyType
    role: UserRole


class UserCreate(UserBase):
    password: str = Field(min_length=6)


class UserRead(UserBase):
    id: int
    is_active: bool
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
