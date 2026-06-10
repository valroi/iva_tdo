"""Гостевой роутер модуля Vendors — /api/v1/public/vendor/...

ПОЛНОСТЬЮ изолирован от пользовательского API: использует require_vendor_session
(vendor-токен), НЕ импортирует get_current_user. Подрядчик видит только свой
MR по своему приглашению.

Поток входа:
  1. POST /request-code  {token}        — проверяем токен приглашения, шлём
                                           6-значный код на email подрядчика.
  2. POST /verify        {token, code}  — проверяем код, выдаём гостевую сессию.
  3. GET  /me                            — состав MR (read-only) по сессии.

PR-3: вход + просмотр MR. Цены, загрузки, вопросы — PR-4.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import create_vendor_session_token
from app.database import get_db
from app.models import (
    MaterialRequisition,
    MrOwnerFile,
    MrOwnerItem,
    MrStatus,
    MrTag,
    MrVendorItem,
    VendorInvitation,
)
from app.schemas import (
    VendorMrDocumentView,
    VendorMrTagView,
    VendorMrView,
    VendorRequestCode,
    VendorSessionResponse,
    VendorVerify,
)
from app.services import vendor_email, vendor_invitations
from app.services.vendor_security import require_vendor_session, write_audit

router = APIRouter()


def _load_invitation(db: Session, invitation_id: int) -> VendorInvitation:
    inv = db.query(VendorInvitation).filter(VendorInvitation.id == invitation_id).first()
    # 404 на всё — не подтверждаем существование id внешнему наблюдателю.
    if inv is None or not vendor_invitations.is_active(inv):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return inv


def _ensure_mr_accepting(db: Session, mr_id: int) -> MaterialRequisition:
    """Портал подрядчика доступен ТОЛЬКО пока MR в статусе OPEN и дедлайн не
    прошёл. В любом другом статусе (черновик/закрыт/победитель выбран) ссылка
    не открывается — вход и просмотр запрещены."""
    mr = db.query(MaterialRequisition).filter(MaterialRequisition.id == mr_id).first()
    if mr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    accepting = mr.status == MrStatus.OPEN and (mr.deadline_at is None or datetime.utcnow() <= mr.deadline_at)
    if not accepting:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="MR is not accepting submissions")
    return mr


@router.post("/public/vendor/{invitation_id}/request-code")
def request_code(
    invitation_id: int,
    payload: VendorRequestCode,
    request: Request,
    db: Session = Depends(get_db),
):
    """Шаг 1: подрядчик пришёл по ссылке (token в query). Проверяем токен,
    генерируем код и шлём на привязанный email. Защита от перебора —
    failed_attempts + lockout."""
    inv = _load_invitation(db, invitation_id)
    _ensure_mr_accepting(db, inv.mr_id)
    if vendor_invitations.is_locked(inv):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts, try later",
        )
    if not vendor_invitations.verify_secret(payload.token, inv.token_hash):
        vendor_invitations.register_failed_attempt(inv)
        db.commit()
        write_audit(db, action="vendor_token_failed", mr_id=inv.mr_id, invitation_id=inv.id, request=request)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    code = vendor_invitations.generate_email_code()
    vendor_invitations.set_email_code(inv, code)
    vendor_invitations.reset_attempts(inv)
    db.commit()

    mr = db.query(MaterialRequisition).filter(MaterialRequisition.id == inv.mr_id).first()
    try:
        vendor_email.send_invitation_code(
            to=inv.vendor_contact_email,
            company_name=inv.vendor_company_name,
            mr_code=mr.code if mr else "—",
            code=code,
        )
    except Exception:  # noqa: BLE001
        pass
    write_audit(db, action="vendor_code_requested", mr_id=inv.mr_id, invitation_id=inv.id, request=request)
    # Не раскрываем код в ответе — он ушёл на email.
    return {"status": "code_sent", "email_masked": _mask_email(inv.vendor_contact_email)}


@router.post("/public/vendor/{invitation_id}/verify", response_model=VendorSessionResponse)
def verify_code(
    invitation_id: int,
    payload: VendorVerify,
    request: Request,
    db: Session = Depends(get_db),
):
    """Шаг 2: проверяем токен + email-код, выдаём гостевую сессию."""
    inv = _load_invitation(db, invitation_id)
    _ensure_mr_accepting(db, inv.mr_id)
    if vendor_invitations.is_locked(inv):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts, try later")
    token_ok = vendor_invitations.verify_secret(payload.token, inv.token_hash)
    code_ok = vendor_invitations.email_code_valid(inv, payload.code)
    if not (token_ok and code_ok):
        vendor_invitations.register_failed_attempt(inv)
        db.commit()
        write_audit(db, action="vendor_verify_failed", mr_id=inv.mr_id, invitation_id=inv.id, request=request)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid code")

    inv.email_verified_at = datetime.utcnow()
    inv.email_code_hash = None
    inv.email_code_expires_at = None
    vendor_invitations.reset_attempts(inv)
    db.commit()

    mr = db.query(MaterialRequisition).filter(MaterialRequisition.id == inv.mr_id).first()
    session_token = create_vendor_session_token(inv.id)
    write_audit(db, action="vendor_logged_in", mr_id=inv.mr_id, invitation_id=inv.id, request=request)
    return VendorSessionResponse(
        session_token=session_token,
        mr_code=mr.code if mr else "—",
        mr_title=mr.title if mr else "—",
    )


@router.get("/public/vendor/me", response_model=VendorMrView)
def vendor_me(
    db: Session = Depends(get_db),
    inv: VendorInvitation = Depends(require_vendor_session),
):
    """Состав MR глазами подрядчика: теги + документы (read-only) + дедлайн.
    Цены/вопросы/загрузки — PR-4."""
    mr = _ensure_mr_accepting(db, inv.mr_id)
    tags = (
        db.query(MrTag)
        .filter(MrTag.mr_id == mr.id)
        .order_by(MrTag.order_index.asc(), MrTag.id.asc())
        .all()
    )
    # Документы заказчика = загруженные файлы по слотам чек-листа (read-only).
    owner_items = {it.id: it for it in db.query(MrOwnerItem).filter(MrOwnerItem.mr_id == mr.id).all()}
    owner_files = db.query(MrOwnerFile).filter(MrOwnerFile.mr_id == mr.id).order_by(MrOwnerFile.id.asc()).all()
    documents = [
        VendorMrDocumentView(
            id=f.id,
            title=(owner_items.get(f.owner_item_id).title if owner_items.get(f.owner_item_id) else f.file_name),
            file_name=f.file_name,
            size_bytes=f.size_bytes,
        )
        for f in owner_files
    ]
    # Чек-лист, который подрядчик должен заполнить (шаблон). Ответы — PR-4.
    from app.schemas import VendorMrChecklistItem

    vendor_items = (
        db.query(MrVendorItem)
        .filter(MrVendorItem.mr_id == mr.id)
        .order_by(MrVendorItem.order_index.asc(), MrVendorItem.id.asc())
        .all()
    )
    checklist = [
        VendorMrChecklistItem(
            id=v.id, section=v.section.value, category=v.category, code=v.code,
            title=v.title, purpose=v.purpose, with_bid=v.with_bid, allow_questions=v.allow_questions,
        )
        for v in vendor_items
    ]
    is_open = mr.status == MrStatus.OPEN and (mr.deadline_at is None or datetime.utcnow() <= mr.deadline_at)
    return VendorMrView(
        mr_id=mr.id,
        code=mr.code,
        title=mr.title,
        description=mr.description,
        currency=mr.currency,
        deadline_at=mr.deadline_at,
        status=mr.status,
        is_open=is_open,
        vendor_company_name=inv.vendor_company_name,
        tags=[VendorMrTagView.model_validate(t, from_attributes=True) for t in tags],
        documents=documents,
        checklist=checklist,
    )


def _mask_email(email: str) -> str:
    try:
        local, domain = email.split("@", 1)
        if len(local) <= 2:
            masked = local[0] + "*"
        else:
            masked = local[0] + "*" * (len(local) - 2) + local[-1]
        return f"{masked}@{domain}"
    except ValueError:
        return "***"
