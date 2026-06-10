"""Внутренний роутер модуля Vendors (VQM) — /api/v1/mr/...

Доступен ТОЛЬКО аутентифицированным пользователям заказчика (JWT).
Гостевой портал подрядчика живёт в отдельном роутере (PR-3) и сюда
доступа не имеет.

PR-2: CRUD MR + теги + документы заказчика. Приглашения, гостевой портал,
Q&A и отчёт — в следующих PR.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models import (
    MaterialRequisition,
    MrDocument,
    MrStatus,
    MrTag,
    Project,
    User,
    UserRole,
    VendorInvitation,
)
from app.schemas import (
    MrCreate,
    MrDocumentRead,
    MrRead,
    MrTagCreate,
    MrTagRead,
    MrTagUpdate,
    MrUpdate,
    VendorInvitationCreate,
    VendorInvitationCreated,
    VendorInvitationRead,
)
from app.services import vendor_email, vendor_invitations
from app.services.vendor_security import (
    can_manage_mr,
    ensure_can_manage_mr,
    write_audit,
)

router = APIRouter()
settings = get_settings()

MR_UPLOAD_ROOT = Path(settings.vendor_uploads_root)
MAX_MR_DOC_BYTES = 50 * 1024 * 1024  # 50 MB на документ заказчика


def _get_mr_or_404(db: Session, mr_id: int) -> MaterialRequisition:
    mr = db.query(MaterialRequisition).filter(MaterialRequisition.id == mr_id).first()
    if mr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MR not found")
    return mr


def _mr_to_read(db: Session, mr: MaterialRequisition) -> MrRead:
    lr_name = None
    if mr.lr_user_id is not None:
        lr = db.query(User).filter(User.id == mr.lr_user_id).first()
        lr_name = lr.full_name if lr else None
    tags_count = db.query(MrTag).filter(MrTag.mr_id == mr.id).count()
    docs_count = db.query(MrDocument).filter(MrDocument.mr_id == mr.id).count()
    inv_count = db.query(VendorInvitation).filter(VendorInvitation.mr_id == mr.id).count()
    data = MrRead.model_validate(mr, from_attributes=True)
    data.lr_user_name = lr_name
    data.tags_count = tags_count
    data.documents_count = docs_count
    data.invitations_count = inv_count
    return data


# --------------------------------------------------------------------- MR list
@router.get("/mr", response_model=list[MrRead])
def list_mr(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Список MR, которыми текущий пользователь может управлять.
    Подрядчики (company_type=contractor) сюда не ходят — у них только
    гостевой портал по ссылке."""
    query = db.query(MaterialRequisition)
    if project_id is not None:
        query = query.filter(MaterialRequisition.project_id == project_id)
    items = query.order_by(MaterialRequisition.id.desc()).all()
    visible = [mr for mr in items if can_manage_mr(db, user=current_user, mr=mr)]
    return [_mr_to_read(db, mr) for mr in visible]


@router.get("/mr/{mr_id}", response_model=MrRead)
def get_mr(
    mr_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    return _mr_to_read(db, mr)


@router.post("/mr", response_model=MrRead, status_code=status.HTTP_201_CREATED)
def create_mr(
    payload: MrCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Создавать MR может admin или пользователь заказчика с правом управления
    # ревью-матрицей/публикации. Минимальный гейт: не подрядчик.
    if current_user.role != UserRole.admin and current_user.company_type and current_user.company_type.value == "contractor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Contractors cannot create MR")
    project = db.query(Project).filter(Project.id == payload.project_id).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    existing = db.query(MaterialRequisition).filter(MaterialRequisition.code == payload.code).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="MR code already exists")
    mr = MaterialRequisition(
        project_id=payload.project_id,
        code=payload.code.strip(),
        title=payload.title.strip(),
        description=payload.description,
        lr_user_id=payload.lr_user_id,
        deadline_at=payload.deadline_at,
        currency=(payload.currency or "RUB").strip().upper(),
        status=MrStatus.DRAFT,
        created_by_id=current_user.id,
    )
    db.add(mr)
    db.commit()
    db.refresh(mr)
    return _mr_to_read(db, mr)


@router.patch("/mr/{mr_id}", response_model=MrRead)
def update_mr(
    mr_id: int,
    payload: MrUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    if payload.title is not None:
        mr.title = payload.title.strip()
    if payload.description is not None:
        mr.description = payload.description
    if payload.lr_user_id is not None:
        mr.lr_user_id = payload.lr_user_id
    if payload.deadline_at is not None:
        mr.deadline_at = payload.deadline_at
    if payload.currency is not None:
        mr.currency = payload.currency.strip().upper()
    if payload.status is not None:
        mr.status = payload.status
    db.commit()
    db.refresh(mr)
    return _mr_to_read(db, mr)


@router.delete("/mr/{mr_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mr(
    mr_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    # Удалять можно только черновик без приглашений (не было контакта с
    # подрядчиками). Это защищает историю тендера.
    has_invitations = db.query(VendorInvitation).filter(VendorInvitation.mr_id == mr.id).first() is not None
    if mr.status != MrStatus.DRAFT or has_invitations:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a DRAFT MR without invitations can be deleted",
        )
    db.query(MrTag).filter(MrTag.mr_id == mr.id).delete()
    db.query(MrDocument).filter(MrDocument.mr_id == mr.id).delete()
    db.delete(mr)
    db.commit()
    return None


# --------------------------------------------------------------------- Tags
@router.get("/mr/{mr_id}/tags", response_model=list[MrTagRead])
def list_tags(
    mr_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    items = (
        db.query(MrTag)
        .filter(MrTag.mr_id == mr.id)
        .order_by(MrTag.order_index.asc(), MrTag.id.asc())
        .all()
    )
    return [MrTagRead.model_validate(item, from_attributes=True) for item in items]


@router.post("/mr/{mr_id}/tags", response_model=MrTagRead, status_code=status.HTTP_201_CREATED)
def create_tag(
    mr_id: int,
    payload: MrTagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    dup = (
        db.query(MrTag)
        .filter(MrTag.mr_id == mr.id, MrTag.tag_code == payload.tag_code.strip())
        .first()
    )
    if dup is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag code already exists in this MR")
    tag = MrTag(
        mr_id=mr.id,
        tag_code=payload.tag_code.strip(),
        name=payload.name.strip(),
        quantity=payload.quantity,
        unit=payload.unit,
        note=payload.note,
        order_index=payload.order_index,
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return MrTagRead.model_validate(tag, from_attributes=True)


@router.patch("/mr/{mr_id}/tags/{tag_id}", response_model=MrTagRead)
def update_tag(
    mr_id: int,
    tag_id: int,
    payload: MrTagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    tag = db.query(MrTag).filter(MrTag.id == tag_id, MrTag.mr_id == mr.id).first()
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    if payload.tag_code is not None:
        tag.tag_code = payload.tag_code.strip()
    if payload.name is not None:
        tag.name = payload.name.strip()
    if payload.quantity is not None:
        tag.quantity = payload.quantity
    if payload.unit is not None:
        tag.unit = payload.unit
    if payload.note is not None:
        tag.note = payload.note
    if payload.order_index is not None:
        tag.order_index = payload.order_index
    db.commit()
    db.refresh(tag)
    return MrTagRead.model_validate(tag, from_attributes=True)


@router.delete("/mr/{mr_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    mr_id: int,
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    tag = db.query(MrTag).filter(MrTag.id == tag_id, MrTag.mr_id == mr.id).first()
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    db.delete(tag)
    db.commit()
    return None


# --------------------------------------------------------------------- Documents
@router.get("/mr/{mr_id}/documents", response_model=list[MrDocumentRead])
def list_documents(
    mr_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    items = db.query(MrDocument).filter(MrDocument.mr_id == mr.id).order_by(MrDocument.id.asc()).all()
    return [MrDocumentRead.model_validate(item, from_attributes=True) for item in items]


@router.post("/mr/{mr_id}/documents", response_model=MrDocumentRead, status_code=status.HTTP_201_CREATED)
def upload_document(
    mr_id: int,
    title: str | None = None,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    raw = file.file.read()
    if len(raw) > MAX_MR_DOC_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")
    original_name = file.filename or "document"
    safe_name = f"{uuid4().hex}_{Path(original_name).name.replace(' ', '_')}"
    destination_dir = MR_UPLOAD_ROOT / "mr_docs" / str(mr.id)
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / safe_name
    destination.write_bytes(raw)
    doc = MrDocument(
        mr_id=mr.id,
        title=(title or original_name).strip(),
        file_path=str(destination),
        file_name=original_name,
        mime=file.content_type,
        size_bytes=len(raw),
        uploaded_by_id=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return MrDocumentRead.model_validate(doc, from_attributes=True)


@router.delete("/mr/{mr_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    mr_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    doc = db.query(MrDocument).filter(MrDocument.id == doc_id, MrDocument.mr_id == mr.id).first()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    try:
        Path(doc.file_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(doc)
    db.commit()
    return None


# --------------------------------------------------------------------- Invitations
@router.get("/mr/{mr_id}/invitations", response_model=list[VendorInvitationRead])
def list_invitations(
    mr_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    items = (
        db.query(VendorInvitation)
        .filter(VendorInvitation.mr_id == mr.id)
        .order_by(VendorInvitation.id.asc())
        .all()
    )
    return [VendorInvitationRead.model_validate(i, from_attributes=True) for i in items]


@router.post(
    "/mr/{mr_id}/invitations",
    response_model=VendorInvitationCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_invitation(
    mr_id: int,
    payload: VendorInvitationCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    # Бизнес-ограничение: не больше N подрядчиков на MR.
    active_count = (
        db.query(VendorInvitation)
        .filter(VendorInvitation.mr_id == mr.id, VendorInvitation.revoked_at.is_(None))
        .count()
    )
    if active_count >= settings.vendor_max_invitations_per_mr:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Maximum {settings.vendor_max_invitations_per_mr} vendors per MR",
        )
    token = vendor_invitations.generate_invitation_token()
    inv = VendorInvitation(
        mr_id=mr.id,
        vendor_company_name=payload.vendor_company_name.strip(),
        vendor_contact_email=payload.vendor_contact_email.strip().lower(),
        token_hash=vendor_invitations.hash_secret(token),
        expires_at=payload.expires_at or mr.deadline_at,
        created_by_id=current_user.id,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    link = vendor_invitations.build_invitation_link(inv.id, token)
    # Письмо-приглашение со ссылкой (код придёт отдельно при входе).
    try:
        vendor_email.send_invitation_link(
            to=inv.vendor_contact_email,
            company_name=inv.vendor_company_name,
            mr_code=mr.code,
            link=link,
        )
    except Exception:  # noqa: BLE001 — письмо не должно ронять создание
        pass
    write_audit(
        db,
        action="invitation_created",
        mr_id=mr.id,
        invitation_id=inv.id,
        actor_user_id=current_user.id,
        request=request,
        summary=f"vendor={inv.vendor_company_name}",
    )

    base = VendorInvitationRead.model_validate(inv, from_attributes=True)
    return VendorInvitationCreated(**base.model_dump(), invitation_link=link, token=token)


@router.post("/mr/{mr_id}/invitations/{invitation_id}/revoke", response_model=VendorInvitationRead)
def revoke_invitation(
    mr_id: int,
    invitation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from datetime import datetime as _dt

    mr = _get_mr_or_404(db, mr_id)
    ensure_can_manage_mr(db, user=current_user, mr=mr)
    inv = (
        db.query(VendorInvitation)
        .filter(VendorInvitation.id == invitation_id, VendorInvitation.mr_id == mr.id)
        .first()
    )
    if inv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    inv.revoked_at = _dt.utcnow()
    db.commit()
    db.refresh(inv)
    write_audit(
        db,
        action="invitation_revoked",
        mr_id=mr.id,
        invitation_id=inv.id,
        actor_user_id=current_user.id,
        request=request,
    )
    return VendorInvitationRead.model_validate(inv, from_attributes=True)
