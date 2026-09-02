from __future__ import annotations

import enum
from datetime import date, datetime
from typing import Optional

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
    user = "user"


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


class ContractorCommentStatus(str, enum.Enum):
    I = "I"
    A = "A"


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
    company_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    company_type: Mapped[CompanyType] = mapped_column(Enum(CompanyType), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    permissions: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class RegistrationRequest(Base):
    __tablename__ = "registration_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    company_type: Mapped[CompanyType] = mapped_column(Enum(CompanyType), nullable=False)
    requested_role: Mapped[Optional[UserRole]] = mapped_column(Enum(UserRole), nullable=True)
    status: Mapped[RegistrationRequestStatus] = mapped_column(
        Enum(RegistrationRequestStatus),
        default=RegistrationRequestStatus.PENDING,
        nullable=False,
    )
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    document_category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class CipherTemplate(Base):
    __tablename__ = "cipher_templates"
    __table_args__ = (UniqueConstraint("project_id", "category", name="uq_cipher_template_project_category"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class CipherTemplateField(Base):
    __tablename__ = "cipher_template_fields"
    __table_args__ = (UniqueConstraint("template_id", "field_key", name="uq_cipher_template_field_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("cipher_templates.id"), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    field_key: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)  # REFERENCE | CUSTOM_TEXT | AUTO_SERIAL | STATIC
    source_ref_type: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    static_value: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    uppercase: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    separator: Mapped[str] = mapped_column(String(5), default="-", nullable=False)
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
    """Назначение сотрудника заказчика на рассмотрение документов проекта.

    Строка адресуется парой «категория + раздел»: одна и та же дисциплина в
    разных категориях — это разные документы и разные люди (напр. концепции
    PF с дисциплиной SE и отчёты изысканий категории SE). category = NULL —
    легаси-строки и осознанное «все категории».
    """

    __tablename__ = "review_matrix_members"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "category",
            "discipline_code",
            "doc_type",
            "user_id",
            "level",
            name="uq_review_matrix_member",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    # NULL — строка покрывает документы любой категории (так вели матрицу до
    # 2026-09-01; новые строки заводятся с конкретной категорией).
    category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
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
    # Вложенный документ (напр. программа изысканий под финальным отчётом):
    # шифр = шифр родителя + "-" + порядковый; своя карточка и тот же цикл
    # рассмотрения. NULL — обычный документ верхнего уровня.
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("mdr_records.id"), nullable=True, index=True)

    doc_name: Mapped[str] = mapped_column(String(255), nullable=False)
    planned_dev_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    progress_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    doc_weight: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    issue_purpose: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    revision: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    revision_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    dates: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    trm_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    review_code: Mapped[Optional[ReviewCode]] = mapped_column(Enum(ReviewCode), nullable=True)
    status: Mapped[str] = mapped_column(String(60), default="DRAFT", nullable=False)

    contractor_responsible_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    owner_responsible_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    attachments: Mapped[list["DocumentAttachment"]] = relationship("DocumentAttachment", back_populates="document")


class Revision(Base):
    __tablename__ = "revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False)
    revision_code: Mapped[str] = mapped_column(String(20), nullable=False)
    issue_purpose: Mapped[str] = mapped_column(String(120), nullable=False)
    author_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(60), default="SUBMITTED", nullable=False)
    trm_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    review_code: Mapped[Optional[ReviewCode]] = mapped_column(Enum(ReviewCode), nullable=True)
    review_deadline: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # Номер CRS, выданный при согласовании без замечаний (AP): Comment там не
    # создаётся, а номер должен быть уникальным и видимым в переписке.
    ap_crs_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    document: Mapped["Document"] = relationship("Document", back_populates="revisions")
    comments: Mapped[list["Comment"]] = relationship("Comment", back_populates="revision")


class DocumentAttachment(Base):
    __tablename__ = "document_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), nullable=False, index=True)
    revision_id: Mapped[Optional[int]] = mapped_column(ForeignKey("revisions.id"), nullable=True, index=True)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    document: Mapped["Document"] = relationship("Document", back_populates="attachments")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    revision_id: Mapped[int] = mapped_column(ForeignKey("revisions.id"), nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("comments.id"), nullable=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[CommentStatus] = mapped_column(Enum(CommentStatus), default=CommentStatus.OPEN, nullable=False)
    review_code: Mapped[Optional[ReviewCode]] = mapped_column(Enum(ReviewCode), nullable=True)
    is_published_to_contractor: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    backlog_status: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    contractor_status: Mapped[Optional[ContractorCommentStatus]] = mapped_column(
        Enum(ContractorCommentStatus),
        nullable=True,
    )
    in_crs: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    crs_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    crs_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    # Уникальный «человеческий» номер замечания: {ПРОЕКТ}-RMK-000123.
    # Присваивается при создании и НЕ меняется никогда — по нему ищут историю
    # замечания (ревизия, CRS, ответ подрядчика, решение LR, carry-over).
    remark_number: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, index=True)
    carry_finalized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    area_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    area_y: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    area_w: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    area_h: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    revision: Mapped["Revision"] = relationship("Revision", back_populates="comments")


class CommentAttachment(Base):
    """Файл, приложенный к замечанию (опционально). Любой формат — исходники,
    сканы, фото. Признак наличия отражается во всех выгрузках."""

    __tablename__ = "comment_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    comment_id: Mapped[int] = mapped_column(ForeignKey("comments.id"), nullable=False, index=True)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class CarryOverDecision(Base):
    __tablename__ = "carry_over_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    target_revision_id: Mapped[int] = mapped_column(ForeignKey("revisions.id"), nullable=False, index=True)
    source_comment_id: Mapped[int] = mapped_column(ForeignKey("comments.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="OPEN")
    decided_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    decided_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class WorkflowStatus(Base):
    __tablename__ = "workflow_statuses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#1677ff", nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    editable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    project_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    document_num: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    revision_id: Mapped[Optional[int]] = mapped_column(ForeignKey("revisions.id"), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class ReviewEvent(Base):
    """Журнал действий рассмотрения по ревизии.

    Одна запись = одно событие цикла (кому улетело, кто рассмотрел, дедлайн).
    Питает: таймлайн истории на карточке ревизии, отчёт по действиям R/LR и
    разработчиков, напоминания о дедлайнах. Пишется в ключевых точках workflow
    без изменения самой бизнес-логики этих точек.

    event_type: SENT_TO_OWNER | R_NO_COMMENTS | R_COMMENTED | LR_COMMENTED |
                LR_SENT_TO_CONTRACTOR | AP_SET | DEADLINE_REMINDER
    actor_role: TDO | R | LR | CONTRACTOR | ADMIN | SYSTEM
    """

    __tablename__ = "review_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    revision_id: Mapped[int] = mapped_column(ForeignKey("revisions.id"), nullable=False, index=True)
    project_code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    document_num: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    discipline_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    revision_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    actor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    target_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    deadline: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class CommentAudit(Base):
    """Append-only снимок каждого замечания при создании и изменении.

    Физический журнал: даже если строку в `comments` потом изменят или удалят,
    здесь остаётся полная история (текст, автор, статус, даты, CRS) — можно
    восстановить данные. Пишется автоматически SQLAlchemy-хуком на любой
    insert/update Comment, без правки бизнес-логики эндпоинтов. Только запись,
    никогда не обновляется и не удаляется приложением.
    """

    __tablename__ = "comment_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    comment_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(10), nullable=False)  # INSERT | UPDATE
    revision_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    document_num: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, index=True)
    project_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    revision_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    author_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    author_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    review_code: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    contractor_status: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    in_crs: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    crs_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    is_published_to_contractor: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    comment_created_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class RevisionReviewerState(Base):
    """Текущее состояние конкретного ревьювера (R/LR) по ревизии.

    no_comments=True — ревьювер нажал «Рассмотрено, без замечаний» (NC).
    Если системная настройка review_nc_locks_commenting=true, после NC его
    комментирование по этой ревизии закрыто (открыть может только админ,
    сняв флаг глобально).
    """

    __tablename__ = "revision_reviewer_states"
    __table_args__ = (
        UniqueConstraint("revision_id", "user_id", name="uq_revision_reviewer_state"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    revision_id: Mapped[int] = mapped_column(ForeignKey("revisions.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    no_comments: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


# =====================================================================
#  Модуль Vendors (VQM) — отработка предложений подрядчиков по поставке
#  оборудования. Иерархия: Project → MR → Tag. Подрядчики приходят по
#  изолированным приглашениям (vendor_invitation), видят только свой MR.
# =====================================================================


class MrStatus(str, enum.Enum):
    DRAFT = "DRAFT"          # формируется заказчиком, подрядчикам не видна
    OPEN = "OPEN"            # приём заявок открыт (до дедлайна)
    CLOSED = "CLOSED"        # дедлайн прошёл / закрыта вручную, write запрещён
    AWARDED = "AWARDED"      # победитель выбран (этап отчёта)


class MrQuestionVisibility(str, enum.Enum):
    PRIVATE = "PRIVATE"      # видит только автор-подрядчик и заказчик
    PUBLIC = "PUBLIC"        # LR/admin сделал публичным — видят все подрядчики MR


class MaterialRequisition(Base):
    """MR — самостоятельная сущность со ссылкой на проект. Авторизация
    управления НЕ наследуется от проекта автоматически: явный lr_user_id +
    created_by_id + admin. Проверяется в _can_manage_mr()."""

    __tablename__ = "material_requisitions"
    __table_args__ = (UniqueConstraint("code", name="uq_mr_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Из шапки REQ: тип оборудования, № документа REQ, ревизия, дисциплина.
    equipment_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    req_number: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    req_rev: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    discipline_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    status: Mapped[MrStatus] = mapped_column(Enum(MrStatus), nullable=False, default=MrStatus.DRAFT)
    # Ответственный заказчика (LR по этой MR) — кому летят вопросы подрядчиков.
    lr_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    deadline_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="RUB")
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class MrTag(Base):
    """Позиция Material Summary List внутри MR (тег оборудования/поставки).
    Подрядчик проставляет цену именно по тегам."""

    __tablename__ = "mr_tags"
    __table_args__ = (UniqueConstraint("mr_id", "tag_code", name="uq_mr_tag_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mr_id: Mapped[int] = mapped_column(ForeignKey("material_requisitions.id"), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sr_no: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)   # Sr. No из таблицы
    item_no: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)  # Item No (HE-1001)
    tag_code: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class MrOwnerItemCategory(str, enum.Enum):
    CHECKLIST_FORM = "CHECKLIST_FORM"   # Bid Check List, Letter of Conformity
    RFD = "RFD"                         # Requirement for Documents (форма)
    SPARE = "SPARE"                     # Spare parts / SPIR
    INSPECTION = "INSPECTION"           # Scope of Inspection
    PROCEDURE = "PROCEDURE"             # Coordination / Numbering procedures
    DATASHEET = "DATASHEET"             # Технические даташиты (дисциплина)
    SPEC = "SPEC"                       # Спецификации (дисциплина)
    DRAWING = "DRAWING"                 # Чертежи (дисциплина)
    OTHER = "OTHER"


class MrOwnerItem(Base):
    """Слот чек-листа ЗАКАЗЧИКА (List of Attachments): что нужно загрузить
    для полноты MR. Карточка показывает «загружено X/Y». Файл(ы) — в
    MrOwnerFile."""

    __tablename__ = "mr_owner_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mr_id: Mapped[int] = mapped_column(ForeignKey("material_requisitions.id"), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    att_no: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    category: Mapped[MrOwnerItemCategory] = mapped_column(
        Enum(MrOwnerItemCategory), nullable=False, default=MrOwnerItemCategory.OTHER
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    doc_number: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    rev: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_questions: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Группа-заголовок (Technical Documents / Specifications / Drawings):
    # на неё нельзя грузить файл — это раздел, у которого есть дочерние
    # позиции (10 → 10.1, 10.2). Загрузка только на листовые пункты.
    is_group: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class MrOwnerFile(Base):
    """Загруженный заказчиком файл, привязан к слоту чек-листа MrOwnerItem.
    Один слот может иметь несколько файлов (многостраничные приложения)."""

    __tablename__ = "mr_owner_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_item_id: Mapped[int] = mapped_column(ForeignKey("mr_owner_items.id"), nullable=False, index=True)
    mr_id: Mapped[int] = mapped_column(ForeignKey("material_requisitions.id"), nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class MrVendorItemSection(str, enum.Enum):
    BID_INCLUSION = "BID_INCLUSION"   # Bid Check List п.1 «Включили в КП»
    BID_NOTES = "BID_NOTES"           # Bid Check List п.2 «Учли Requisition Notes»
    RFD = "RFD"                       # Requirement for Documents (строки)


class MrVendorItem(Base):
    """Строка чек-листа ПОДРЯДЧИКА (шаблон). Bid Check List (YES/NO/NA) и
    RFD-документы. Ответы подрядчиков — в VendorItemResponse (per invitation)."""

    __tablename__ = "mr_vendor_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mr_id: Mapped[int] = mapped_column(ForeignKey("material_requisitions.id"), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    section: Mapped[MrVendorItemSection] = mapped_column(Enum(MrVendorItemSection), nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)  # scheduling/quality/technical
    code: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)       # PN01, QC02, 1.1...
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    purpose: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)     # R/I/A (для RFD)
    with_bid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_questions: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class VendorItemAnswer(str, enum.Enum):
    YES = "YES"
    NO = "NO"
    NA = "NA"


class VendorItemResponse(Base):
    """Ответ конкретного подрядчика на пункт чек-листа MrVendorItem:
    YES/NO/NA + прикреплённый файл + примечание. Одна строка на пару
    (invitation, vendor_item)."""

    __tablename__ = "vendor_item_responses"
    __table_args__ = (
        UniqueConstraint("invitation_id", "vendor_item_id", name="uq_vendor_item_response"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    invitation_id: Mapped[int] = mapped_column(ForeignKey("vendor_invitations.id"), nullable=False, index=True)
    vendor_item_id: Mapped[int] = mapped_column(ForeignKey("mr_vendor_items.id"), nullable=False, index=True)
    answer: Mapped[Optional[VendorItemAnswer]] = mapped_column(Enum(VendorItemAnswer), nullable=True)
    upload_id: Mapped[Optional[int]] = mapped_column(ForeignKey("vendor_uploads.id"), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class VendorInvitation(Base):
    """Одно приглашение = один подрядчик на один MR. Сам токен НЕ хранится —
    только argon2/bcrypt-хэш. Изоляция подрядчиков строится на проверке
    invitation_id во ВСЕХ гостевых endpoint'ах."""

    __tablename__ = "vendor_invitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mr_id: Mapped[int] = mapped_column(ForeignKey("material_requisitions.id"), nullable=False, index=True)
    vendor_company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Email-код подтверждения (хэш) и срок его жизни — для входа подрядчика.
    email_code_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email_code_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_seen_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Финальная отправка предложения подрядчиком — после неё портал read-only.
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class VendorQuote(Base):
    """Цена подрядчика по конкретному тегу MR. Одна строка на пару
    (invitation, tag)."""

    __tablename__ = "vendor_quotes"
    __table_args__ = (UniqueConstraint("invitation_id", "tag_id", name="uq_vendor_quote"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    invitation_id: Mapped[int] = mapped_column(ForeignKey("vendor_invitations.id"), nullable=False, index=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("mr_tags.id"), nullable=False, index=True)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class VendorUpload(Base):
    """Документ, загруженный подрядчиком. Хранится в отдельном volume
    vendor_uploads, привязан к invitation (изоляция)."""

    __tablename__ = "vendor_uploads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    invitation_id: Mapped[int] = mapped_column(ForeignKey("vendor_invitations.id"), nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class MrQuestion(Base):
    """Вопрос подрядчика по MR / ответ заказчика. Ответы могут быть
    сделаны публичными (видны всем подрядчикам этого MR)."""

    __tablename__ = "mr_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mr_id: Mapped[int] = mapped_column(ForeignKey("material_requisitions.id"), nullable=False, index=True)
    # Автор-подрядчик (invitation). У ответа заказчика — parent_id заполнен.
    invitation_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("vendor_invitations.id"), nullable=True, index=True
    )
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("mr_questions.id"), nullable=True, index=True)
    # Привязка вопроса к конкретному пункту чек-листа: документу заказчика
    # (owner item) или требованию к подрядчику (vendor item). Оба опциональны
    # — может быть общий вопрос по MR.
    mr_owner_item_id: Mapped[Optional[int]] = mapped_column(ForeignKey("mr_owner_items.id"), nullable=True)
    mr_vendor_item_id: Mapped[Optional[int]] = mapped_column(ForeignKey("mr_vendor_items.id"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[MrQuestionVisibility] = mapped_column(
        Enum(MrQuestionVisibility), nullable=False, default=MrQuestionVisibility.PRIVATE
    )
    answered_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    answered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class VendorAuditLog(Base):
    """Аудит всех действий в модуле Vendors (guest + LR): кто, когда,
    с какого IP, что сделал. Для расследований и комплаенса."""

    __tablename__ = "vendor_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mr_id: Mapped[Optional[int]] = mapped_column(ForeignKey("material_requisitions.id"), nullable=True, index=True)
    invitation_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("vendor_invitations.id"), nullable=True, index=True
    )
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    payload_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


# =====================================================================
#  Модуль FEED — документация стадии FEED. Структура: Project →
#  Discipline → FeedDocument (шифр, RU/EN название, класс 1/1А) →
#  файлы (финальная ревизия; для класса 1А дополнительно ACRS).
#  Всё в БД + файлы в feed_storage volume — переживает апдейты.
# =====================================================================


class FeedDocClass(str, enum.Enum):
    C1 = "1"     # класс 1 — только финальная версия документа
    C1A = "1A"   # класс 1А — документ + ACRS


class FeedFileKind(str, enum.Enum):
    REVISION = "REVISION"  # файл ревизии документа
    ACRS = "ACRS"          # ACRS-приложение (для класса 1А)


class FeedFileLang(str, enum.Enum):
    RU = "RU"          # русская версия
    EN = "EN"          # английская версия
    BI = "BI"          # двуязычный документ
    NA = "NA"          # не определено


class FeedDocument(Base):
    __tablename__ = "feed_documents"
    __table_args__ = (UniqueConstraint("project_id", "doc_number", name="uq_feed_doc_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), nullable=False, index=True)
    discipline_code: Mapped[str] = mapped_column(String(20), nullable=False, index=True, default="00")
    # Шифр без суффикса ревизии: IMP-FD-00-00-HM-REQ-262
    doc_number: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    title_en: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    title_ru: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    doc_class: Mapped[FeedDocClass] = mapped_column(Enum(FeedDocClass), nullable=False, default=FeedDocClass.C1)
    doc_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)   # REQ/DSH/ESS/SDG...
    latest_rev: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    issue_purpose: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    rev_date: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # Извлечённый текст для полнотекстового/AI-поиска.
    search_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class FeedFile(Base):
    __tablename__ = "feed_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    feed_document_id: Mapped[int] = mapped_column(ForeignKey("feed_documents.id"), nullable=False, index=True)
    kind: Mapped[FeedFileKind] = mapped_column(Enum(FeedFileKind), nullable=False, default=FeedFileKind.REVISION)
    lang: Mapped[FeedFileLang] = mapped_column(Enum(FeedFileLang), nullable=False, default=FeedFileLang.NA)
    rev: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
