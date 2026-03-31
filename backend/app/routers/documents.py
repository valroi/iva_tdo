from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permissions, users_by_company_types
from app.models import (
    Comment,
    Document,
    MDRRecord,
    Notification,
    CompanyType,
    Project,
    ProjectMember,
    ProjectMemberRole,
    ReviewMatrixMember,
    ProjectReference,
    Revision,
    SystemSetting,
    User,
)
from app.schemas import (
    CommentCreate,
    CommentOwnerDecision,
    CommentRead,
    CommentResponse,
    DocumentCreate,
    DocumentRead,
    FileUploadResponse,
    PublishCommentsResult,
    RevisionCreate,
    RevisionCardRead,
    RevisionCommentThreadRead,
    RevisionRead,
    RevisionTdoDecision,
    RevisionOverviewRead,
    TdoQueueItem,
)

router = APIRouter()
UPLOAD_ROOT = Path("/tmp/tdo_uploads")


def _is_project_tdo_lead(db: Session, project_id: int, user_id: int) -> bool:
    member = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
        .first()
    )
    if member is None:
        return False
    return member.member_role == ProjectMemberRole.contractor_tdo_lead or member.can_manage_contractor_users


@router.get("/revisions/tdo-queue", response_model=list[TdoQueueItem])
def list_tdo_queue(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    memberships = (
        db.query(ProjectMember)
        .filter(
            ProjectMember.user_id == current_user.id,
            (ProjectMember.member_role == ProjectMemberRole.contractor_tdo_lead)
            | (ProjectMember.can_manage_contractor_users.is_(True)),
        )
        .all()
    )
    project_ids = [item.project_id for item in memberships]
    if not project_ids:
        return []
    projects = db.query(Project).filter(Project.id.in_(project_ids)).all()
    project_code_to_id = {item.code: item.id for item in projects}
    allowed_codes = set(project_code_to_id.keys())
    if not allowed_codes:
        return []
    rows = (
        db.query(Revision, Document, MDRRecord, User)
        .join(Document, Document.id == Revision.document_id)
        .join(MDRRecord, MDRRecord.id == Document.mdr_id)
        .outerjoin(User, User.id == Revision.author_id)
        .filter(MDRRecord.project_code.in_(allowed_codes), Revision.status == "UPLOADED_WAITING_TDO")
        .order_by(Revision.created_at.asc())
        .all()
    )
    result: list[TdoQueueItem] = []
    for revision, document, mdr, author in rows:
        result.append(
            TdoQueueItem(
                revision_id=revision.id,
                project_code=mdr.project_code,
                document_num=document.document_num,
                document_title=document.title,
                revision_code=revision.revision_code,
                issue_purpose=revision.issue_purpose,
                status=revision.status,
                created_at=revision.created_at,
                review_deadline=revision.review_deadline,
                file_path=revision.file_path,
                author_id=revision.author_id,
                author_name=author.full_name if author else None,
                author_email=author.email if author else None,
            )
        )
    return result


@router.get("/revisions/overview", response_model=list[RevisionOverviewRead])
def list_revisions_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        db.query(Revision, Document, MDRRecord, User)
        .join(Document, Document.id == Revision.document_id)
        .join(MDRRecord, MDRRecord.id == Document.mdr_id)
        .outerjoin(User, User.id == Revision.author_id)
    )
    if current_user.role.value != "admin":
        allowed_codes = (
            db.query(Project.code)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .filter(ProjectMember.user_id == current_user.id)
            .all()
        )
        allowed_project_codes = [row[0] for row in allowed_codes]
        if not allowed_project_codes:
            return []
        query = query.filter(MDRRecord.project_code.in_(allowed_project_codes))
    rows = query.order_by(Revision.created_at.desc()).all()
    return [
        RevisionOverviewRead(
            revision_id=revision.id,
            project_code=mdr.project_code,
            document_num=document.document_num,
            document_title=document.title,
            revision_code=revision.revision_code,
            issue_purpose=revision.issue_purpose,
            status=revision.status,
            trm_number=revision.trm_number,
            review_deadline=revision.review_deadline,
            file_path=revision.file_path,
            author_id=revision.author_id,
            author_name=author.full_name if author else None,
            author_email=author.email if author else None,
            created_at=revision.created_at,
        )
        for revision, document, mdr, author in rows
    ]


@router.get("/revisions/owner-review-queue", response_model=list[TdoQueueItem])
def list_owner_review_queue(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    memberships = db.query(ProjectMember).filter(ProjectMember.user_id == current_user.id).all()
    if not memberships:
        return []
    project_ids = [item.project_id for item in memberships]
    projects = db.query(Project).filter(Project.id.in_(project_ids)).all()
    allowed_codes = {item.code for item in projects}
    if not allowed_codes:
        return []
    rows = (
        db.query(Revision, Document, MDRRecord, User)
        .join(Document, Document.id == Revision.document_id)
        .join(MDRRecord, MDRRecord.id == Document.mdr_id)
        .outerjoin(User, User.id == Revision.author_id)
        .filter(MDRRecord.project_code.in_(allowed_codes), Revision.status == "UNDER_REVIEW")
        .order_by(Revision.created_at.asc())
        .all()
    )
    result: list[TdoQueueItem] = []
    for revision, document, mdr, author in rows:
        has_matrix_assignment = (
            db.query(ReviewMatrixMember.id)
            .join(Project, Project.id == ReviewMatrixMember.project_id)
            .filter(
                Project.code == mdr.project_code,
                ReviewMatrixMember.user_id == current_user.id,
                ReviewMatrixMember.discipline_code == mdr.discipline_code,
                ReviewMatrixMember.doc_type == mdr.doc_type,
                ReviewMatrixMember.level == 1,
            )
            .first()
            is not None
        )
        if not has_matrix_assignment and current_user.role.value != "admin":
            continue
        result.append(
            TdoQueueItem(
                revision_id=revision.id,
                project_code=mdr.project_code,
                document_num=document.document_num,
                document_title=document.title,
                revision_code=revision.revision_code,
                issue_purpose=revision.issue_purpose,
                status=revision.status,
                created_at=revision.created_at,
                review_deadline=revision.review_deadline,
                file_path=revision.file_path,
                author_id=revision.author_id,
                author_name=author.full_name if author else None,
                author_email=author.email if author else None,
            )
        )
    return result


def _next_trm_number(db: Session, *, project_code: str, originator_code: str, reviewing_party_code: str = "IVA") -> str:
    prefix = f"{project_code.upper()}-{originator_code.upper()}-{reviewing_party_code.upper()}-TRM-"
    matches = (
        db.query(Revision.trm_number)
        .filter(Revision.trm_number.isnot(None), Revision.trm_number.like(f"{prefix}%"))
        .all()
    )
    max_seq = 0
    for (value,) in matches:
        if not value:
            continue
        match = re.match(rf"^{re.escape(prefix)}(\d{{5}})$", value)
        if match:
            max_seq = max(max_seq, int(match.group(1)))
    next_seq = max_seq + 1
    return f"{prefix}{next_seq:05d}"


def _sla_days_for_revision(
    db: Session,
    *,
    project_id: int,
    category: str,
    issue_purpose: str,
    is_initial_revision: bool,
) -> int:
    revision_kind = "INITIAL" if is_initial_revision else "NEXT"
    keys = [
        f"{category.upper()}:{issue_purpose.upper()}:{revision_kind}",
        f"{category.upper()}:*:{revision_kind}",
        f"*:{issue_purpose.upper()}:{revision_kind}",
        f"*:*:{revision_kind}",
    ]
    refs = (
        db.query(ProjectReference)
        .filter(
            ProjectReference.project_id == project_id,
            ProjectReference.ref_type == "review_sla_days",
            ProjectReference.is_active.is_(True),
        )
        .all()
    )
    by_code = {item.code.upper(): item.value for item in refs}
    for key in keys:
        raw = by_code.get(key)
        if raw is None:
            continue
        try:
            days = int(str(raw).strip())
            if days > 0:
                return days
        except ValueError:
            continue
    fallback_key = "review_sla_default_initial_days" if is_initial_revision else "review_sla_default_next_days"
    setting = db.query(SystemSetting).filter(SystemSetting.key == fallback_key).first()
    if setting is not None:
        try:
            parsed = int(str(setting.value).strip())
            if parsed > 0:
                return parsed
        except ValueError:
            pass
    return 14 if is_initial_revision else 7


def _setting_days(db: Session, key: str, default: float) -> float:
    item = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if item is None:
        return default
    try:
        value = float(str(item.value).strip())
        return value if value > 0 else default
    except ValueError:
        return default


@router.get("/documents", response_model=list[DocumentRead])
def list_documents(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    docs = db.query(Document).order_by(Document.id.desc()).all()
    result: list[DocumentRead] = []
    for doc in docs:
        latest = (
            db.query(Revision)
            .filter(Revision.document_id == doc.id)
            .order_by(Revision.created_at.desc(), Revision.id.desc())
            .first()
        )
        result.append(
            DocumentRead.model_validate(doc, from_attributes=True).model_copy(
                update={
                    "latest_revision_code": latest.revision_code if latest else None,
                    "latest_revision_status": latest.status if latest else None,
                    "latest_review_code": latest.review_code if latest else None,
                }
            )
        )
    return result


@router.get("/documents/{document_id}", response_model=DocumentRead)
def get_document(document_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    latest = (
        db.query(Revision)
        .filter(Revision.document_id == doc.id)
        .order_by(Revision.created_at.desc(), Revision.id.desc())
        .first()
    )
    return DocumentRead.model_validate(doc, from_attributes=True).model_copy(
        update={
            "latest_revision_code": latest.revision_code if latest else None,
            "latest_revision_status": latest.status if latest else None,
            "latest_review_code": latest.review_code if latest else None,
        }
    )


@router.post("/documents", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def create_document(
    payload: DocumentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions("can_create_mdr")),
):
    mdr = db.query(MDRRecord).filter(MDRRecord.id == payload.mdr_id).first()
    if not mdr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")

    doc = Document(
        **payload.model_dump(),
        created_by_id=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return DocumentRead.model_validate(doc, from_attributes=True).model_copy(
        update={
            "latest_revision_code": None,
            "latest_revision_status": None,
            "latest_review_code": None,
        }
    )


@router.post("/documents/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
def upload_document_file(
    file: UploadFile = File(...),
    revision_id: int | None = Form(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions("can_upload_files")),
):
    revision: Revision | None = None
    if revision_id is not None:
        revision = db.query(Revision).filter(Revision.id == revision_id).first()
        if revision is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")

    original_name = file.filename or "document.pdf"
    extension = Path(original_name).suffix.lower()
    if extension != ".pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF files are allowed")

    day_folder = datetime.utcnow().strftime("%Y%m%d")
    destination_dir = UPLOAD_ROOT / day_folder
    destination_dir.mkdir(parents=True, exist_ok=True)

    safe_name = f"{uuid4().hex}_{Path(original_name).name.replace(' ', '_')}"
    destination = destination_dir / safe_name

    file_bytes = file.file.read()
    destination.write_bytes(file_bytes)

    storage_path = str(destination)

    if revision is not None:
        revision.file_path = storage_path
        revision.status = "UPLOADED_WAITING_TDO"

        doc = db.query(Document).filter(Document.id == revision.document_id).first()
        if doc is not None:
            mdr = db.query(MDRRecord).filter(MDRRecord.id == doc.mdr_id).first()
            if mdr is not None:
                project = db.query(Project).filter(Project.code == mdr.project_code).first()
                if project is not None:
                    lead_members = (
                        db.query(ProjectMember)
                        .filter(
                            ProjectMember.project_id == project.id,
                            ProjectMember.member_role == ProjectMemberRole.contractor_tdo_lead,
                        )
                        .all()
                    )
                    for lead in lead_members:
                        db.add(
                            Notification(
                                user_id=lead.user_id,
                                event_type="REVISION_UPLOADED_FOR_TDO",
                                message=(
                                    f"Загружен PDF для документа {doc.document_num}, ревизия {revision.revision_code}. "
                                    "Требуется решение ТДО (TRM/отклонить)."
                                ),
                                project_code=mdr.project_code,
                                document_num=doc.document_num,
                                revision_id=revision.id,
                            )
                        )
        db.add(revision)
        db.commit()

    return FileUploadResponse(
        file_name=original_name,
        file_path=storage_path,
        content_type=file.content_type or "application/pdf",
        file_size=len(file_bytes),
    )


@router.get("/revisions/{revision_id}/file")
def get_revision_file(
    revision_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    revision = db.query(Revision).filter(Revision.id == revision_id).first()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    if not revision.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF file is not attached")

    path = Path(revision.file_path).resolve()
    upload_root = UPLOAD_ROOT.resolve()
    if upload_root not in path.parents:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid file path")
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    if path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF preview supported")

    return FileResponse(path=path, media_type="application/pdf", filename=path.name)


@router.get("/documents/{document_id}/revisions", response_model=list[RevisionRead])
def list_revisions(
    document_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    return (
        db.query(Revision)
        .filter(Revision.document_id == document_id)
        .order_by(Revision.id.desc())
        .all()
    )


@router.get("/revisions/{revision_id}", response_model=RevisionRead)
def get_revision(revision_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rev = db.query(Revision).filter(Revision.id == revision_id).first()
    if not rev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    return rev


@router.post("/revisions", response_model=RevisionRead, status_code=status.HTTP_201_CREATED)
def create_revision(
    payload: RevisionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == payload.document_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    latest = (
        db.query(Revision)
        .filter(Revision.document_id == payload.document_id)
        .order_by(Revision.created_at.desc(), Revision.id.desc())
        .first()
    )
    allow_same_code_after_rj = (
        latest is not None
        and latest.review_code == ReviewCode.RJ
        and payload.revision_code == latest.revision_code
        and payload.issue_purpose.upper() == latest.issue_purpose.upper()
    )
    duplicate = (
        db.query(Revision.id)
        .filter(Revision.document_id == payload.document_id, Revision.revision_code == payload.revision_code)
        .first()
    )
    if duplicate is not None and not allow_same_code_after_rj:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Revision code already exists for document")

    if latest is not None and latest.review_code is not None:
        prev_purpose = (latest.issue_purpose or "").upper()
        next_purpose = (payload.issue_purpose or "").upper()
        if latest.review_code in {ReviewCode.AN, ReviewCode.CO} and prev_purpose != next_purpose:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="For AN/CO review code, next revision must keep same issue purpose",
            )
        if latest.review_code == ReviewCode.AP and prev_purpose == next_purpose:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="For AP review code, next revision must change issue purpose",
            )
        if latest.review_code == ReviewCode.RJ and not allow_same_code_after_rj:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="For RJ review code, document must be reissued with same revision code and issue purpose",
            )
    if latest is not None and latest.status in {"REVISION_CREATED", "UPLOADED_WAITING_TDO", "UNDER_REVIEW", "SUBMITTED"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot create new revision while previous revision is in progress: {latest.status}",
        )

    mdr = db.query(MDRRecord).filter(MDRRecord.id == doc.mdr_id).first()
    if mdr is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MDR link not found for document")
    project = db.query(Project).filter(Project.code == mdr.project_code).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Project not found for document")

    existing_count = db.query(Revision.id).filter(Revision.document_id == payload.document_id).count()
    is_initial_revision = existing_count == 0
    payload_data = payload.model_dump()
    payload_data["author_id"] = payload.author_id or current_user.id
    payload_data["trm_number"] = _next_trm_number(
        db,
        project_code=mdr.project_code,
        originator_code=mdr.originator_code,
    )
    payload_data["status"] = "REVISION_CREATED"
    sla_days = _sla_days_for_revision(
        db,
        project_id=project.id,
        category=mdr.category,
        issue_purpose=payload.issue_purpose,
        is_initial_revision=is_initial_revision,
    )
    payload_data["review_deadline"] = (datetime.utcnow() + timedelta(days=sla_days)).date()
    rev = Revision(**payload_data)
    db.add(rev)
    db.flush()

    lead_members = (
        db.query(ProjectMember)
        .filter(
            ProjectMember.project_id == project.id,
            ProjectMember.member_role == ProjectMemberRole.contractor_tdo_lead,
        )
        .all()
    )
    lead_ids = {item.user_id for item in lead_members}
    if lead_ids:
        receiver_ids = lead_ids
    else:
        matrix_level_1 = (
        db.query(ReviewMatrixMember)
        .filter(
            ReviewMatrixMember.project_id == project.id,
            ReviewMatrixMember.discipline_code == mdr.discipline_code,
            ReviewMatrixMember.doc_type == mdr.doc_type,
            ReviewMatrixMember.level == 1,
        )
        .all()
        )
        if matrix_level_1:
            receiver_ids = {item.user_id for item in matrix_level_1}
        else:
            fallback = users_by_company_types(
                db,
                company_types=[CompanyType.owner],
            )
            receiver_ids = {user.id for user in fallback}

    for receiver_id in receiver_ids:
        event_type = "NEW_REVISION_FOR_TDO" if lead_ids else "NEW_REVISION"
        db.add(
            Notification(
                user_id=receiver_id,
                event_type=event_type,
                message=(
                    f"Выпущен документ {doc.document_num}, ревизия {rev.revision_code}. "
                    f"Дисциплина: {mdr.discipline_code}, тип: {mdr.doc_type}"
                ),
                project_code=mdr.project_code,
                document_num=doc.document_num,
                revision_id=rev.id,
            )
        )

    db.commit()
    db.refresh(rev)
    return rev


@router.post("/revisions/{revision_id}/tdo-decision", response_model=RevisionRead)
def make_tdo_decision(
    revision_id: int,
    payload: RevisionTdoDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    revision = db.query(Revision).filter(Revision.id == revision_id).first()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    doc = db.query(Document).filter(Document.id == revision.document_id).first()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    mdr = db.query(MDRRecord).filter(MDRRecord.id == doc.mdr_id).first()
    if mdr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")
    project = db.query(Project).filter(Project.code == mdr.project_code).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if not _is_project_tdo_lead(db, project.id, current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only contractor TDO lead can process queue")

    note = (payload.note or "").strip()
    if payload.action == "SEND_TO_OWNER":
        revision.status = "UNDER_REVIEW"
        owner_review_days = (
            _setting_days(db, "review_sla_owner_dcc_incoming_days", 1)
            + _setting_days(db, "review_sla_owner_specialist_review_days", 7)
            + _setting_days(db, "review_sla_owner_lr_approval_days", 1)
        )
        revision.review_deadline = (datetime.utcnow() + timedelta(days=owner_review_days)).date()
        matrix_level_1 = (
            db.query(ReviewMatrixMember)
            .filter(
                ReviewMatrixMember.project_id == project.id,
                ReviewMatrixMember.discipline_code == mdr.discipline_code,
                ReviewMatrixMember.doc_type == mdr.doc_type,
                ReviewMatrixMember.level == 1,
            )
            .all()
        )
        if matrix_level_1:
            receiver_ids = {item.user_id for item in matrix_level_1}
        else:
            fallback = users_by_company_types(db, company_types=[CompanyType.owner])
            receiver_ids = {user.id for user in fallback}
        for receiver_id in receiver_ids:
            db.add(
                Notification(
                    user_id=receiver_id,
                    event_type="TDO_SENT_TO_OWNER",
                    message=(
                        f"Ревизия {revision.revision_code} по документу {doc.document_num} "
                        f"направлена на рассмотрение заказчика."
                    ),
                    project_code=mdr.project_code,
                    document_num=doc.document_num,
                    revision_id=revision.id,
                )
            )
    else:
        revision.status = "CANCELLED_BY_TDO"
        cancel_message = (
            f"Загрузка ревизии {revision.revision_code} по документу {doc.document_num} отменена руководителем ТДО."
        )
        if note:
            cancel_message += f" Причина: {note}"
        db.add(
            Notification(
                user_id=doc.created_by_id,
                event_type="TDO_CANCELLED_REVISION",
                message=cancel_message,
                project_code=mdr.project_code,
                document_num=doc.document_num,
                revision_id=revision.id,
            )
        )

    db.add(revision)
    db.commit()
    db.refresh(revision)
    return revision


@router.get("/revisions/{revision_id}/comments", response_model=list[CommentRead])
def list_comments(
    revision_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rev = db.query(Revision).filter(Revision.id == revision_id).first()
    if not rev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")

    query = db.query(Comment).filter(Comment.revision_id == revision_id)
    if _.company_type == CompanyType.contractor:
        query = query.filter((Comment.is_published_to_contractor.is_(True)) | (Comment.author_id == _.id))
    return query.order_by(Comment.id.asc()).all()


@router.post("/comments", response_model=CommentRead, status_code=status.HTTP_201_CREATED)
def create_comment(
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions("can_raise_comments")),
):
    rev = db.query(Revision).filter(Revision.id == payload.revision_id).first()
    if not rev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")

    document = db.query(Document).filter(Document.id == rev.document_id).first()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    mdr = db.query(MDRRecord).filter(MDRRecord.id == document.mdr_id).first()
    if mdr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")
    project = db.query(Project).filter(Project.code == mdr.project_code).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if current_user.company_type == CompanyType.owner and current_user.role.value != "admin":
        matrix_match = (
            db.query(ReviewMatrixMember.id)
            .filter(
                ReviewMatrixMember.project_id == project.id,
                ReviewMatrixMember.user_id == current_user.id,
                ReviewMatrixMember.discipline_code == mdr.discipline_code,
                ReviewMatrixMember.doc_type == mdr.doc_type,
            )
            .first()
        )
        if matrix_match is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No matrix assignment for this document")

    comment = Comment(**payload.model_dump(), author_id=current_user.id, is_published_to_contractor=False)
    db.add(comment)
    db.flush()

    recipients = {document.created_by_id}
    lr_rows = (
        db.query(ReviewMatrixMember)
        .filter(
            ReviewMatrixMember.project_id == project.id,
            ReviewMatrixMember.discipline_code == mdr.discipline_code,
            ReviewMatrixMember.doc_type == mdr.doc_type,
            ReviewMatrixMember.level == 1,
            ReviewMatrixMember.state == "LR",
        )
        .all()
    )
    for row in lr_rows:
        if row.user_id != current_user.id:
            recipients.add(row.user_id)

    for receiver_id in recipients:
        db.add(
            Notification(
                user_id=receiver_id,
                event_type="OWNER_COMMENT_CREATED" if current_user.company_type == CompanyType.owner else "NEW_COMMENT",
                message=f"New comment on revision {rev.revision_code}",
                project_code=mdr.project_code,
                document_num=document.document_num,
                revision_id=rev.id,
            )
        )

    db.commit()
    db.refresh(comment)
    return comment


@router.post("/comments/{comment_id}/response", response_model=CommentRead)
def respond_comment(
    comment_id: int,
    payload: CommentResponse,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions("can_respond_comments")),
):
    parent = db.query(Comment).filter(Comment.id == comment_id).first()
    if not parent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if parent.author_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot respond to own comment")
    if current_user.company_type == CompanyType.contractor and not parent.is_published_to_contractor:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Comment is not yet published to contractor")

    response = Comment(
        revision_id=parent.revision_id,
        parent_id=parent.id,
        author_id=current_user.id,
        text=payload.text,
        status=payload.status,
    )
    parent.status = payload.status
    if payload.backlog_status:
        parent.backlog_status = payload.backlog_status

    db.add(response)
    db.add(parent)

    owner_receivers = users_by_company_types(
        db,
        company_types=[CompanyType.owner],
    )
    for receiver in owner_receivers:
        db.add(
            Notification(
                user_id=receiver.id,
                event_type="COMMENT_RESPONSE",
                message=f"Response received for comment #{parent.id}",
            )
        )

    db.commit()
    db.refresh(response)
    return response


@router.post("/comments/{comment_id}/publish", response_model=CommentRead)
def publish_comment_to_contractor(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions("can_publish_comments")),
):
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    revision = db.query(Revision).filter(Revision.id == comment.revision_id).first()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    document = db.query(Document).filter(Document.id == revision.document_id).first()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    mdr = db.query(MDRRecord).filter(MDRRecord.id == document.mdr_id).first()
    if mdr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")
    comment.is_published_to_contractor = True
    db.add(comment)
    target_author_id = revision.author_id or document.created_by_id
    db.add(
        Notification(
            user_id=target_author_id,
            event_type="OWNER_COMMENT_PUBLISHED",
            message=f"Новое замечание по документу {document.document_num}, ревизия {revision.revision_code}",
            project_code=mdr.project_code,
            document_num=document.document_num,
            revision_id=revision.id,
        )
    )
    db.commit()
    db.refresh(comment)
    return comment


@router.post("/comments/{comment_id}/owner-decision", response_model=CommentRead)
def owner_comment_decision(
    comment_id: int,
    payload: CommentOwnerDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions("can_publish_comments")),
):
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.parent_id.is_(None)).first()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if payload.action == "PUBLISH":
        comment.is_published_to_contractor = True
    else:
        comment.status = CommentStatus.REJECTED
        comment.backlog_status = "REJECTED"
        if payload.note:
            db.add(
                Comment(
                    revision_id=comment.revision_id,
                    parent_id=comment.id,
                    author_id=current_user.id,
                    text=f"[LR_REJECT] {payload.note}",
                    status=CommentStatus.REJECTED,
                )
            )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.post("/revisions/{revision_id}/comments/publish-all", response_model=PublishCommentsResult)
def publish_revision_comments_to_contractor(
    revision_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permissions("can_publish_comments")),
):
    revision = db.query(Revision).filter(Revision.id == revision_id).first()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    document = db.query(Document).filter(Document.id == revision.document_id).first()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    mdr = db.query(MDRRecord).filter(MDRRecord.id == document.mdr_id).first()
    if mdr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")

    comments = (
        db.query(Comment)
        .filter(Comment.revision_id == revision_id, Comment.parent_id.is_(None), Comment.is_published_to_contractor.is_(False))
        .all()
    )
    for comment in comments:
        comment.is_published_to_contractor = True
        db.add(comment)

    if comments:
        target_author_id = revision.author_id or document.created_by_id
        db.add(
            Notification(
                user_id=target_author_id,
                event_type="OWNER_COMMENTS_PUBLISHED",
                message=f"Замечания заказчика переданы подрядчику: {document.document_num}, ревизия {revision.revision_code}",
                project_code=mdr.project_code,
                document_num=document.document_num,
                revision_id=revision.id,
            )
        )
    db.commit()
    return PublishCommentsResult(revision_id=revision_id, published_count=len(comments))


@router.get("/revisions/{revision_id}/card", response_model=RevisionCardRead)
def get_revision_card(
    revision_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    revision = db.query(Revision).filter(Revision.id == revision_id).first()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    document = db.query(Document).filter(Document.id == revision.document_id).first()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    mdr = db.query(MDRRecord).filter(MDRRecord.id == document.mdr_id).first()
    if mdr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")

    revisions = (
        db.query(Revision)
        .filter(Revision.document_id == document.id)
        .order_by(Revision.created_at.asc(), Revision.id.asc())
        .all()
    )
    history: list[RevisionCommentThreadRead] = []
    for item in revisions:
        comments = (
            db.query(Comment)
            .filter(Comment.revision_id == item.id)
            .order_by(Comment.created_at.asc(), Comment.id.asc())
            .all()
        )
        history.append(
            RevisionCommentThreadRead(
                revision_id=item.id,
                revision_code=item.revision_code,
                status=item.status,
                created_at=item.created_at,
                comments=[CommentRead.model_validate(comment, from_attributes=True) for comment in comments],
            )
        )
    return RevisionCardRead(
        revision_id=revision.id,
        project_code=mdr.project_code,
        document_num=document.document_num,
        document_title=document.title,
        discipline_code=mdr.discipline_code,
        doc_type=mdr.doc_type,
        category=mdr.category,
        current_revision_code=revision.revision_code,
        current_status=revision.status,
        revisions=[RevisionRead.model_validate(item, from_attributes=True) for item in revisions],
        history=history,
    )
