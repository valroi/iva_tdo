import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, is_main_admin
from app.models import Document, MDRRecord, Project, ProjectMember, ProjectReference, User, UserPermission, UserRole
from app.schemas import (
    MDRCreate,
    MDRDocNumberPreviewRequest,
    MDRDocNumberPreviewResponse,
    MDRRead,
    MDRUpdate,
)

router = APIRouter()
TSC_LIKE_DOC_TYPES = {"TSC", "TEA"}

def _normalize_segment(field_name: str, value: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9-]+", "", value.strip().upper().replace(" ", "-"))
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid value for {field_name}",
        )
    return cleaned


def _normalize_category(category: str) -> str:
    return _normalize_segment("category", category)


def _mask_kind(category: str, doc_type: str) -> str:
    normalized_category = _normalize_category(category)
    normalized_doc_type = _normalize_segment("doc_type", doc_type)

    if normalized_category == "SE":
        return "SE"
    if normalized_category == "PD":
        return "PD"
    if normalized_doc_type in TSC_LIKE_DOC_TYPES:
        return "TSC"

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Only SE, PD and TSC/TEA masks are supported in current release",
    )


def _next_sequence_number(
    db: Session,
    *,
    project_code: str,
    category: str,
    discipline_code: str,
    doc_type: str,
    exclude_mdr_id: int | None = None,
) -> str:
    regex = re.compile(rf"^{re.escape(project_code)}-[A-Z0-9]+-{re.escape(category)}-[A-Z0-9]+-{re.escape(discipline_code)}-{re.escape(doc_type)}-(\d{{5}})$")
    max_seq = 0
    query = db.query(MDRRecord.doc_number).filter(
        MDRRecord.project_code == project_code,
        MDRRecord.category == category,
        MDRRecord.discipline_code == discipline_code,
        MDRRecord.doc_type == doc_type,
    )
    if exclude_mdr_id is not None:
        query = query.filter(MDRRecord.id != exclude_mdr_id)
    rows = query.all()
    for row in rows:
        if not row.doc_number:
            continue
        match = regex.match(row.doc_number)
        if match:
            max_seq = max(max_seq, int(match.group(1)))
    return f"{max_seq + 1:05d}"


def _build_doc_number(
    *,
    project_code: str,
    originator_code: str,
    category: str,
    title_object: str,
    discipline_code: str,
    doc_type: str,
    serial_number: str,
) -> str:
    normalized_project = _normalize_segment("project_code", project_code)
    normalized_originator = _normalize_segment("originator_code", originator_code)
    normalized_category = _normalize_category(category)
    normalized_title = _normalize_segment("title_object", title_object)
    normalized_discipline = _normalize_segment("discipline_code", discipline_code)
    normalized_doc_type = _normalize_segment("doc_type", doc_type)

    mask_kind = _mask_kind(normalized_category, normalized_doc_type)
    if mask_kind == "PD":
        return "-".join(
            [
                normalized_project,
                normalized_originator,
                normalized_category,
                normalized_title,
                normalized_doc_type,
            ]
        )

    return "-".join(
        [
            normalized_project,
            normalized_originator,
            normalized_category,
            normalized_title,
            normalized_discipline,
            normalized_doc_type,
            serial_number,
        ]
    )


def _ensure_unique_doc_number(
    db: Session,
    doc_number: str,
    *,
    exclude_mdr_id: int | None = None,
) -> None:
    query = db.query(MDRRecord).filter(MDRRecord.doc_number == doc_number)
    if exclude_mdr_id is not None:
        query = query.filter(MDRRecord.id != exclude_mdr_id)
    if query.first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Generated doc_number is not unique")


def _current_user_permission(db: Session, user_id: int) -> UserPermission | None:
    return db.query(UserPermission).filter(UserPermission.user_id == user_id).first()


def _resolve_originator_code(db: Session, user: User, payload_originator_code: str | None) -> str:
    if payload_originator_code:
        return _normalize_segment("originator_code", payload_originator_code)
    permission = _current_user_permission(db, user.id)
    if permission is None or not permission.originator_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="originator_code is not configured")
    return _normalize_segment("originator_code", permission.originator_code)


def _has_project_access(db: Session, project_code: str, user: User) -> bool:
    if user.role == UserRole.admin:
        return True
    project = db.query(Project).filter(Project.code == project_code).first()
    if project is None:
        return False
    member = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project.id, ProjectMember.user_id == user.id)
        .first()
    )
    return member is not None


def _require_mdr_write_access(db: Session, user: User, project_code: str) -> None:
    if is_main_admin(user):
        return
    permission = _current_user_permission(db, user.id)
    if permission is None or not permission.can_manage_mdr:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="MDR write permission required")
    if not _has_project_access(db, project_code, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")


def _project_ref_exists(db: Session, project_id: int, ref_type: str, code: str) -> bool:
    return (
        db.query(ProjectReference.id)
        .filter(
            ProjectReference.project_id == project_id,
            ProjectReference.ref_type == ref_type,
            ProjectReference.code == code,
            ProjectReference.is_active.is_(True),
        )
        .first()
        is not None
    )


def _ensure_mdr_reference_codes(
    db: Session,
    *,
    project: Project,
    category: str,
    discipline_code: str,
    doc_type: str,
    title_object: str,
) -> None:
    normalized_category = _normalize_category(category)
    normalized_doc_type = _normalize_segment("doc_type", doc_type)
    mask_kind = _mask_kind(normalized_category, normalized_doc_type)

    if not _project_ref_exists(db, project.id, "document_category", normalized_category):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown category for project")
    if not _project_ref_exists(db, project.id, "facility_title", title_object):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown title object for project")

    if mask_kind == "SE":
        if not _project_ref_exists(db, project.id, "discipline", discipline_code):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown discipline for project")
        if not _project_ref_exists(db, project.id, "se_reporting_type", normalized_doc_type):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="For SE category doc_type must be selected from se_reporting_type",
            )
        return

    if mask_kind == "PD":
        if not _project_ref_exists(db, project.id, "pd_book", normalized_doc_type):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="For PD category doc_type must be selected from pd_book",
            )
        return

    # TSC/TEA mask.
    if not _project_ref_exists(db, project.id, "discipline", discipline_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown discipline for project")
    if not _project_ref_exists(db, project.id, "document_type", normalized_doc_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown document type for project",
        )
    if normalized_doc_type not in TSC_LIKE_DOC_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only TSC/TEA types use this mask")


def _validate_category_weight_limit(
    db: Session,
    *,
    project_code: str,
    category: str,
    candidate_weight: float,
    exclude_mdr_id: int | None = None,
) -> None:
    query = db.query(MDRRecord).filter(MDRRecord.project_code == project_code, MDRRecord.category == category)
    if exclude_mdr_id is not None:
        query = query.filter(MDRRecord.id != exclude_mdr_id)
    existing_sum = sum(item.doc_weight for item in query.all())
    if existing_sum + candidate_weight > 100.0 + 1e-9:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Total weight for project/category cannot exceed 100%",
        )


@router.post("/doc-number-preview", response_model=MDRDocNumberPreviewResponse)
def preview_mdr_doc_number(
    payload: MDRDocNumberPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(Project.code == payload.project_code).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown project_code")
    _ensure_mdr_reference_codes(
        db,
        project=project,
        category=payload.category,
        discipline_code=payload.discipline_code,
        doc_type=payload.doc_type,
        title_object=payload.title_object,
    )
    originator_code = _resolve_originator_code(db, current_user, None)
    normalized_category = _normalize_category(payload.category)
    normalized_discipline = _normalize_segment("discipline_code", payload.discipline_code)
    normalized_doc_type = _normalize_segment("doc_type", payload.doc_type)
    mask_kind = _mask_kind(normalized_category, normalized_doc_type)

    serial = (
        "00000"
        if mask_kind == "PD"
        else _next_sequence_number(
            db,
            project_code=_normalize_segment("project_code", payload.project_code),
            category=normalized_category,
            discipline_code=normalized_discipline,
            doc_type=normalized_doc_type,
        )
    )
    doc_number = _build_doc_number(
        project_code=payload.project_code,
        originator_code=originator_code,
        category=normalized_category,
        title_object=payload.title_object,
        discipline_code=normalized_discipline,
        doc_type=normalized_doc_type,
        serial_number=serial,
    )
    return MDRDocNumberPreviewResponse(doc_number=doc_number)


@router.get("", response_model=list[MDRRead])
def list_mdr(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project_code: str | None = Query(default=None),
):
    query = db.query(MDRRecord)
    if project_code:
        if not _has_project_access(db, project_code, current_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")
        query = query.filter(MDRRecord.project_code == project_code)
    elif current_user.role != UserRole.admin:
        project_codes = (
            db.query(Project.code)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .filter(ProjectMember.user_id == current_user.id)
            .all()
        )
        query = query.filter(MDRRecord.project_code.in_([code for (code,) in project_codes] or ["__none__"]))
    return query.order_by(MDRRecord.id.desc()).all()


@router.get("/{mdr_id}", response_model=MDRRead)
def get_mdr(
    mdr_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mdr = db.query(MDRRecord).filter(MDRRecord.id == mdr_id).first()
    if not mdr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")
    if not _has_project_access(db, mdr.project_code, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")
    return mdr


@router.post("", response_model=MDRRead, status_code=status.HTTP_201_CREATED)
def create_mdr(
    payload: MDRCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_mdr_write_access(db, current_user, payload.project_code)
    project = db.query(Project).filter(Project.code == payload.project_code).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown project_code")

    exists = db.query(MDRRecord).filter(MDRRecord.document_key == payload.document_key).first()
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="document_key already exists")

    _ensure_mdr_reference_codes(
        db,
        project=project,
        category=payload.category,
        discipline_code=payload.discipline_code,
        doc_type=payload.doc_type,
        title_object=payload.title_object,
    )

    payload_data = payload.model_dump()
    payload_data["originator_code"] = _resolve_originator_code(db, current_user, payload.originator_code)
    payload_data["category"] = _normalize_category(payload.category)
    payload_data["discipline_code"] = _normalize_segment("discipline_code", payload.discipline_code)
    payload_data["doc_type"] = _normalize_segment("doc_type", payload.doc_type)
    payload_data["title_object"] = _normalize_segment("title_object", payload.title_object)

    _validate_category_weight_limit(
        db,
        project_code=payload.project_code,
        category=payload.category,
        candidate_weight=payload.doc_weight,
    )

    provided_doc_number = payload_data.get("doc_number")
    if provided_doc_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="doc_number is generated automatically and must not be provided",
        )

    mask_kind = _mask_kind(payload_data["category"], payload_data["doc_type"])
    serial = (
        "00000"
        if mask_kind == "PD"
        else _next_sequence_number(
            db,
            project_code=_normalize_segment("project_code", payload.project_code),
            category=payload_data["category"],
            discipline_code=payload_data["discipline_code"],
            doc_type=payload_data["doc_type"],
        )
    )
    payload_data["serial_number"] = serial
    payload_data["doc_number"] = _build_doc_number(
        project_code=payload.project_code,
        originator_code=payload_data["originator_code"],
        category=payload_data["category"],
        title_object=payload_data["title_object"],
        discipline_code=payload_data["discipline_code"],
        doc_type=payload_data["doc_type"],
        serial_number=serial,
    )
    _ensure_unique_doc_number(db, payload_data["doc_number"])

    payload_data.pop("pd_book", None)
    mdr = MDRRecord(**payload_data)
    db.add(mdr)
    db.commit()
    db.refresh(mdr)
    return mdr


@router.put("/{mdr_id}", response_model=MDRRead)
def update_mdr(
    mdr_id: int,
    payload: MDRUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mdr = db.query(MDRRecord).filter(MDRRecord.id == mdr_id).first()
    if not mdr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")
    _require_mdr_write_access(db, current_user, mdr.project_code)

    updates = payload.model_dump(exclude_unset=True)
    if "originator_code" in updates or "doc_number" in updates or "serial_number" in updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="originator_code/doc_number/serial_number are managed automatically")

    next_category = updates.get("category", mdr.category)
    _validate_category_weight_limit(
        db,
        project_code=mdr.project_code,
        category=next_category,
        candidate_weight=updates.get("doc_weight", mdr.doc_weight),
        exclude_mdr_id=mdr.id,
    )

    for field, value in updates.items():
        setattr(mdr, field, value)

    if any(key in updates for key in {"category", "title_object", "discipline_code", "doc_type"}):
        mdr.category = _normalize_category(mdr.category)
        mdr.title_object = _normalize_segment("title_object", mdr.title_object)
        mdr.discipline_code = _normalize_segment("discipline_code", mdr.discipline_code)
        mdr.doc_type = _normalize_segment("doc_type", mdr.doc_type)
        group_changed = any(key in updates for key in {"category", "discipline_code", "doc_type"})
        mask_kind = _mask_kind(mdr.category, mdr.doc_type)
        if mask_kind == "PD":
            mdr.serial_number = "00000"
        elif group_changed:
            mdr.serial_number = _next_sequence_number(
                db,
                project_code=_normalize_segment("project_code", mdr.project_code),
                category=mdr.category,
                discipline_code=mdr.discipline_code,
                doc_type=mdr.doc_type,
                exclude_mdr_id=mdr.id,
            )
        elif not mdr.serial_number:
            mdr.serial_number = _next_sequence_number(
                db,
                project_code=_normalize_segment("project_code", mdr.project_code),
                category=mdr.category,
                discipline_code=mdr.discipline_code,
                doc_type=mdr.doc_type,
                exclude_mdr_id=mdr.id,
            )
        mdr.doc_number = _build_doc_number(
            project_code=mdr.project_code,
            originator_code=mdr.originator_code,
            category=mdr.category,
            title_object=mdr.title_object,
            discipline_code=mdr.discipline_code,
            doc_type=mdr.doc_type,
            serial_number=mdr.serial_number,
        )
        _ensure_unique_doc_number(db, mdr.doc_number, exclude_mdr_id=mdr.id)

    db.add(mdr)
    db.commit()
    db.refresh(mdr)
    return mdr


@router.delete("/{mdr_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mdr(
    mdr_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mdr = db.query(MDRRecord).filter(MDRRecord.id == mdr_id).first()
    if not mdr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")
    _require_mdr_write_access(db, current_user, mdr.project_code)

    has_documents = db.query(Document.id).filter(Document.mdr_id == mdr.id).first() is not None
    if has_documents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete MDR record with linked documents. Delete linked documents first.",
        )

    db.delete(mdr)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete MDR record because linked data exists.",
        ) from None
