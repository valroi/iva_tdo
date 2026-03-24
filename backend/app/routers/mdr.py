import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import MDRRecord, Project, User, UserRole
from app.schemas import (
    MDRCreate,
    MDRDocNumberPreviewRequest,
    MDRDocNumberPreviewResponse,
    MDRRead,
    MDRUpdate,
)

router = APIRouter()


def _normalize_segment(field_name: str, value: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9-]+", "", value.strip().upper().replace(" ", "-"))
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid value for {field_name}",
        )
    return cleaned


def _base_doc_number(
    *,
    project_code: str,
    originator_code: str,
    category: str,
    title_object: str,
    discipline_code: str,
    doc_type: str,
    serial_number: str,
) -> str:
    segments = [
        _normalize_segment("project_code", project_code),
        _normalize_segment("originator_code", originator_code),
        _normalize_segment("category", category),
        _normalize_segment("title_object", title_object),
        _normalize_segment("discipline_code", discipline_code),
        _normalize_segment("doc_type", doc_type),
        _normalize_segment("serial_number", serial_number),
    ]
    return "-".join(segments)


def _next_available_doc_number(
    db: Session,
    base_number: str,
    *,
    exclude_mdr_id: int | None = None,
) -> str:
    candidate = base_number
    suffix = 2
    while True:
        query = db.query(MDRRecord).filter(MDRRecord.doc_number == candidate)
        if exclude_mdr_id is not None:
            query = query.filter(MDRRecord.id != exclude_mdr_id)
        if query.first() is None:
            return candidate
        candidate = f"{base_number}-{suffix:02d}"
        suffix += 1


@router.post("/doc-number-preview", response_model=MDRDocNumberPreviewResponse)
def preview_mdr_doc_number(
    payload: MDRDocNumberPreviewRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    base_number = _base_doc_number(**payload.model_dump())
    return MDRDocNumberPreviewResponse(doc_number=_next_available_doc_number(db, base_number))


@router.get("", response_model=list[MDRRead])
def list_mdr(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    project_code: str | None = Query(default=None),
):
    query = db.query(MDRRecord)
    if project_code:
        query = query.filter(MDRRecord.project_code == project_code)
    return query.order_by(MDRRecord.id.desc()).all()


@router.get("/{mdr_id}", response_model=MDRRead)
def get_mdr(
    mdr_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    mdr = db.query(MDRRecord).filter(MDRRecord.id == mdr_id).first()
    if not mdr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")
    return mdr


@router.post("", response_model=MDRRead, status_code=status.HTTP_201_CREATED)
def create_mdr(
    payload: MDRCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin, UserRole.contractor_manager)),
):
    project = db.query(Project).filter(Project.code == payload.project_code).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown project_code")

    exists = db.query(MDRRecord).filter(MDRRecord.document_key == payload.document_key).first()
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="document_key already exists")

    payload_data = payload.model_dump()
    provided_doc_number = payload_data.get("doc_number")
    if provided_doc_number:
        provided_doc_number = provided_doc_number.strip()
        conflict = db.query(MDRRecord).filter(MDRRecord.doc_number == provided_doc_number).first()
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="doc_number already exists")
        payload_data["doc_number"] = provided_doc_number
    else:
        base_number = _base_doc_number(
            project_code=payload.project_code,
            originator_code=payload.originator_code,
            category=payload.category,
            title_object=payload.title_object,
            discipline_code=payload.discipline_code,
            doc_type=payload.doc_type,
            serial_number=payload.serial_number,
        )
        payload_data["doc_number"] = _next_available_doc_number(db, base_number)

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
    _: User = Depends(require_roles(UserRole.admin, UserRole.contractor_manager)),
):
    mdr = db.query(MDRRecord).filter(MDRRecord.id == mdr_id).first()
    if not mdr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(mdr, field, value)

    db.add(mdr)
    db.commit()
    db.refresh(mdr)
    return mdr
