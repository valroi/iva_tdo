import enum
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CompanyType(str, enum.Enum):
    contractor = "contractor"
    owner = "owner"
    admin = "admin"


class UserRole(str, enum.Enum):
    admin = "admin"
    owner_manager = "owner_manager"
    owner_reviewer = "owner_reviewer"
    contractor_manager = "contractor_manager"
    contractor_author = "contractor_author"
    viewer = "viewer"


class ReviewCode(str, enum.Enum):
    AP = "AP"
    AN = "AN"
    CO = "CO"
    RJ = "RJ"


class CommentStatus(str, enum.Enum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    REJECTED = "REJECTED"


class RegistrationRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class ProjectMemberRole(str, enum.Enum):
    main_admin = "main_admin"
    contractor_tdo_lead = "contractor_tdo_lead"
    contractor_member = "contractor_member"
    owner_member = "owner_member"
    observer = "observer"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    company_type: Mapped[CompanyType] = mapped_column(Enum(CompanyType), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class RegistrationRequest(Base):
    __tablename__ = "registration_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    company_type: Mapped[CompanyType] = mapped_column(Enum(CompanyType), nullable=False)
    requested_role: Mapped[UserRole | None] = mapped_column(Enum(UserRole), nullable=True)
    status: Mapped[RegistrationRequestStatus] = mapped_column(
        Enum(RegistrationRequestStatus),
        default=RegistrationRequestStatus.PENDING,
        nullable=False,
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    member_role: Mapped[ProjectMemberRole] = mapped_column(Enum(ProjectMemberRole), nullable=False)
    can_manage_contractor_users: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class ProjectReference(Base):
    __tablename__ = "project_references"
    __table_args__ = (UniqueConstraint("project_id", "ref_type", "code", name="uq_project_ref"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    ref_type: Mapped[str] = mapped_column(String(60), nullable=False)
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class ReviewMatrixMember(Base):
    __tablename__ = "review_matrix_members"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "discipline_code",
            "doc_type",
            "user_id",
            "level",
            name="uq_review_matrix_member",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    discipline_code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    doc_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    state: Mapped[str] = mapped_column(String(2), nullable=False, default="R")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class MDRRecord(Base):
    __tablename__ = "mdr_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    document_key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    project_code: Mapped[str] = mapped_column(String(50), nullable=False)
    originator_code: Mapped[str] = mapped_column(String(50), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    title_object: Mapped[str] = mapped_column(String(255), nullable=False)
    discipline_code: Mapped[str] = mapped_column(String(50), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(50), nullable=False)
    serial_number: Mapped[str] = mapped_column(String(50), nullable=False)
    doc_number: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)

    doc_name: Mapped[str] = mapped_column(String(255), nullable=False)
    progress_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    doc_weight: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    issue_purpose: Mapped[str | None] = mapped_column(String(120), nullable=True)
    revision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    revision_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    dates: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    trm_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    review_code: Mapped[ReviewCode | None] = mapped_column(Enum(ReviewCode), nullable=True)
    status: Mapped[str] = mapped_column(String(60), default="DRAFT", nullable=False)

    contractor_responsible_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    owner_responsible_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_confidential: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    documents: Mapped[list["Document"]] = relationship("Document", back_populates="mdr")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mdr_id: Mapped[int] = mapped_column(ForeignKey("mdr_records.id"), nullable=False)
    document_num: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    discipline: Mapped[str] = mapped_column(String(80), nullable=False)
    weight: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    mdr: Mapped["MDRRecord"] = relationship("MDRRecord", back_populates="documents")
    revisions: Mapped[list["Revision"]] = relationship("Revision", back_populates="document")


class Revision(Base):
    __tablename__ = "revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False)
    revision_code: Mapped[str] = mapped_column(String(20), nullable=False)
    issue_purpose: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(60), default="SUBMITTED", nullable=False)
    trm_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    review_code: Mapped[ReviewCode | None] = mapped_column(Enum(ReviewCode), nullable=True)
    review_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    document: Mapped["Document"] = relationship("Document", back_populates="revisions")
    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="revision")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    revision_id: Mapped[int] = mapped_column(ForeignKey("revisions.id"), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("comments.id"), nullable=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[CommentStatus] = mapped_column(Enum(CommentStatus), default=CommentStatus.OPEN, nullable=False)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    area_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    area_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    area_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    area_h: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    revision: Mapped["Revision"] = relationship("Revision", back_populates="comments")


class WorkflowStatus(Base):
    __tablename__ = "workflow_statuses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#1677ff", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    editable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
