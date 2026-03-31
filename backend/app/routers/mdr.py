from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_permissions
from app.models import MDRRecord, Project, User
from app.schemas import MDRCreate, MDRRead, MDRUpdate

router = APIRouter()


class ComposeCipherPayload(BaseModel):
    project_code: str
    originator_code: str
    category: str
    title_object: str
    discipline_code: str
    doc_type: str
    serial_number: str


class ComposeCipherResponse(BaseModel):
    cipher: str
    rule: str


class CheckCipherResponse(BaseModel):
    exists: bool


def _compose_cipher(payload: ComposeCipherPayload) -> tuple[str, str]:
    category = payload.category.upper()
    base = [
        payload.project_code.upper(),
        payload.originator_code.upper(),
        category,
        payload.title_object.upper(),
    ]
    if category == "SE":
        # Инженерные изыскания: AAA-BBB-SE-DDDDDDD-EE-JJJ-NNNNN
        parts = [*base, payload.discipline_code.upper(), payload.doc_type.upper(), payload.serial_number.upper()]
        return "-".join(parts), "SE"
    if category in {"PD", "DD"}:
        # Проектная/рабочая документация: AAA-BBB-CC(C)-DDDDDDD-EE-JJJ-NNNNN
        parts = [*base, payload.discipline_code.upper(), payload.doc_type.upper(), payload.serial_number.upper()]
        return "-".join(parts), category
    parts = [*base, payload.discipline_code.upper(), payload.doc_type.upper(), payload.serial_number.upper()]
    return "-".join(parts), "GENERIC"


def _validate_weight_limit(
    db: Session,
    *,
    project_code: str,
    doc_type: str,
    new_weight: float,
    exclude_id: int | None = None,
) -> None:
    query = db.query(func.coalesce(func.sum(MDRRecord.doc_weight), 0.0)).filter(
        MDRRecord.project_code == project_code,
        MDRRecord.doc_type == doc_type,
    )
    if exclude_id is not None:
        query = query.filter(MDRRecord.id != exclude_id)
    current_total = float(query.scalar() or 0.0)
    if current_total + new_weight > 1000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Weight limit exceeded for {project_code}/{doc_type}: {current_total + new_weight:.2f} > 1000",
        )


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


@router.post("/compose-cipher", response_model=ComposeCipherResponse)
def compose_cipher(
    payload: ComposeCipherPayload,
    _: User = Depends(get_current_user),
):
    cipher, rule = _compose_cipher(payload)
    return ComposeCipherResponse(cipher=cipher, rule=rule)


@router.get("/check-cipher", response_model=CheckCipherResponse)
def check_cipher(
    project_code: str = Query(...),
    value: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    exists = (
        db.query(MDRRecord.id)
        .filter(MDRRecord.project_code == project_code, MDRRecord.doc_number == value)
        .first()
        is not None
    )
    return CheckCipherResponse(exists=exists)


@router.post("", response_model=MDRRead, status_code=status.HTTP_201_CREATED)
def create_mdr(
    payload: MDRCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions("can_create_mdr")),
):
    project = db.query(Project).filter(Project.code == payload.project_code).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown project_code")

    exists = db.query(MDRRecord).filter(MDRRecord.document_key == payload.document_key).first()
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="document_key already exists")

    exists_cipher = (
        db.query(MDRRecord.id)
        .filter(MDRRecord.project_code == payload.project_code, MDRRecord.doc_number == payload.doc_number)
        .first()
    )
    if exists_cipher:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="doc_number already exists in project")

    _validate_weight_limit(
        db,
        project_code=payload.project_code,
        doc_type=payload.doc_type,
        new_weight=payload.doc_weight,
    )

    mdr = MDRRecord(**payload.model_dump())
    db.add(mdr)
    db.commit()
    db.refresh(mdr)
    return mdr


@router.put("/{mdr_id}", response_model=MDRRead)
def update_mdr(
    mdr_id: int,
    payload: MDRUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions("can_create_mdr")),
):
    mdr = db.query(MDRRecord).filter(MDRRecord.id == mdr_id).first()
    if not mdr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MDR not found")

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(mdr, field, value)

    if "doc_weight" in changes or "doc_type" in changes:
        _validate_weight_limit(
            db,
            project_code=mdr.project_code,
            doc_type=mdr.doc_type,
            new_weight=mdr.doc_weight,
            exclude_id=mdr.id,
        )

    db.add(mdr)
    db.commit()
    db.refresh(mdr)
    return mdr
