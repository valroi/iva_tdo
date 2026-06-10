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
from pathlib import Path
from uuid import uuid4

from fastapi import File, UploadFile

from app.config import get_settings
from app.models import (
    MaterialRequisition,
    MrOwnerFile,
    MrOwnerItem,
    MrQuestion,
    MrQuestionVisibility,
    MrStatus,
    MrTag,
    MrVendorItem,
    Notification,
    VendorInvitation,
    VendorItemResponse,
    VendorQuote,
    VendorUpload,
)
from app.schemas import (
    MrQuestionRead,
    MrQuestionReply,
    VendorChecklistAnswerSet,
    VendorMrDocumentView,
    VendorMrTagView,
    VendorMrView,
    VendorMyQuote,
    VendorMyResponse,
    VendorQuestionCreate,
    VendorQuoteSet,
    VendorRequestCode,
    VendorSessionResponse,
    VendorSubmitResult,
    VendorVerify,
)
from app.services import vendor_email, vendor_invitations
from app.services.vendor_security import ensure_mr_open, require_vendor_session, write_audit

_settings = get_settings()
_VENDOR_ROOT = Path(_settings.vendor_uploads_root)
_MAX_VENDOR_FILE = 50 * 1024 * 1024

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


def _ensure_not_submitted(inv: VendorInvitation) -> None:
    """После финальной отправки предложение нельзя менять."""
    if inv.submitted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already submitted — locked")


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
    # Сохранённые ответы ЭТОГО подрядчика (изоляция по invitation_id).
    my_quotes = [
        VendorMyQuote(tag_id=q.tag_id, price=q.price, currency=q.currency, note=q.note)
        for q in db.query(VendorQuote).filter(VendorQuote.invitation_id == inv.id).all()
    ]
    uploads = {u.id: u for u in db.query(VendorUpload).filter(VendorUpload.invitation_id == inv.id).all()}
    my_responses = [
        VendorMyResponse(
            vendor_item_id=r.vendor_item_id,
            answer=r.answer,
            note=r.note,
            upload_id=r.upload_id,
            file_name=(uploads.get(r.upload_id).file_name if r.upload_id and uploads.get(r.upload_id) else None),
        )
        for r in db.query(VendorItemResponse).filter(VendorItemResponse.invitation_id == inv.id).all()
    ]
    submitted = inv.submitted_at is not None
    # Редактировать можно пока приём открыт И предложение ещё не отправлено.
    is_open = (
        mr.status == MrStatus.OPEN
        and (mr.deadline_at is None or datetime.utcnow() <= mr.deadline_at)
        and not submitted
    )
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
        submitted=submitted,
        tags=[VendorMrTagView.model_validate(t, from_attributes=True) for t in tags],
        documents=documents,
        checklist=checklist,
        my_quotes=my_quotes,
        my_responses=my_responses,
    )


# ------------------------------------------------- PR-4b: ответы подрядчика
@router.post("/public/vendor/quote")
def set_quote(
    payload: VendorQuoteSet,
    request: Request,
    db: Session = Depends(get_db),
    inv: VendorInvitation = Depends(require_vendor_session),
):
    """Подрядчик ставит/обновляет цену по тегу. Только в статусе приёма."""
    mr = _ensure_mr_accepting(db, inv.mr_id)
    ensure_mr_open(mr)
    _ensure_not_submitted(inv)
    tag = db.query(MrTag).filter(MrTag.id == payload.tag_id, MrTag.mr_id == mr.id).first()
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    quote = (
        db.query(VendorQuote)
        .filter(VendorQuote.invitation_id == inv.id, VendorQuote.tag_id == tag.id)
        .first()
    )
    if quote is None:
        quote = VendorQuote(invitation_id=inv.id, tag_id=tag.id)
        db.add(quote)
    quote.price = payload.price
    quote.currency = (payload.currency or mr.currency)
    quote.note = payload.note
    db.commit()
    write_audit(db, action="vendor_quote_set", mr_id=mr.id, invitation_id=inv.id, request=request, summary=f"tag={tag.id}")
    return {"status": "ok"}


@router.post("/public/vendor/checklist")
def set_checklist_answer(
    payload: VendorChecklistAnswerSet,
    request: Request,
    db: Session = Depends(get_db),
    inv: VendorInvitation = Depends(require_vendor_session),
):
    """Подрядчик отвечает на пункт чек-листа (YES/NO/NA + примечание)."""
    mr = _ensure_mr_accepting(db, inv.mr_id)
    ensure_mr_open(mr)
    _ensure_not_submitted(inv)
    item = db.query(MrVendorItem).filter(MrVendorItem.id == payload.vendor_item_id, MrVendorItem.mr_id == mr.id).first()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    resp = (
        db.query(VendorItemResponse)
        .filter(VendorItemResponse.invitation_id == inv.id, VendorItemResponse.vendor_item_id == item.id)
        .first()
    )
    if resp is None:
        resp = VendorItemResponse(invitation_id=inv.id, vendor_item_id=item.id)
        db.add(resp)
    resp.answer = payload.answer
    resp.note = payload.note
    db.commit()
    write_audit(db, action="vendor_checklist_answer", mr_id=mr.id, invitation_id=inv.id, request=request, summary=f"item={item.id}")
    return {"status": "ok"}


@router.post("/public/vendor/checklist/{vendor_item_id}/file")
def upload_checklist_file(
    vendor_item_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    inv: VendorInvitation = Depends(require_vendor_session),
):
    """Подрядчик прикрепляет документ к пункту чек-листа (RFD-документ и т.п.)."""
    mr = _ensure_mr_accepting(db, inv.mr_id)
    ensure_mr_open(mr)
    _ensure_not_submitted(inv)
    item = db.query(MrVendorItem).filter(MrVendorItem.id == vendor_item_id, MrVendorItem.mr_id == mr.id).first()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    raw = file.file.read()
    if len(raw) > _MAX_VENDOR_FILE:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")
    safe = f"{uuid4().hex}_{Path(file.filename or 'doc').name.replace(' ', '_')}"
    dest_dir = _VENDOR_ROOT / "vendor_files" / str(inv.id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / safe
    dest.write_bytes(raw)
    import hashlib

    upload = VendorUpload(
        invitation_id=inv.id,
        file_path=str(dest),
        file_name=file.filename or "doc",
        mime=file.content_type,
        size_bytes=len(raw),
        sha256=hashlib.sha256(raw).hexdigest(),
    )
    db.add(upload)
    db.flush()
    resp = (
        db.query(VendorItemResponse)
        .filter(VendorItemResponse.invitation_id == inv.id, VendorItemResponse.vendor_item_id == item.id)
        .first()
    )
    if resp is None:
        resp = VendorItemResponse(invitation_id=inv.id, vendor_item_id=item.id)
        db.add(resp)
    resp.upload_id = upload.id
    db.commit()
    write_audit(db, action="vendor_file_uploaded", mr_id=mr.id, invitation_id=inv.id, request=request, summary=f"item={item.id}")
    return {"status": "ok", "file_name": upload.file_name}


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


# ------------------------------------------------- PR-4c: вопросы подрядчика
def _question_replies(db, q) -> list:
    rows = (
        db.query(MrQuestion)
        .filter(MrQuestion.parent_id == q.id)
        .order_by(MrQuestion.id.asc())
        .all()
    )
    out = []
    for r in rows:
        is_owner = r.invitation_id is None
        out.append(
            MrQuestionReply(
                id=r.id,
                body=r.body,
                is_owner=is_owner,
                author_label=("Заказчик" if is_owner else "Поставщик"),
                created_at=r.created_at,
            )
        )
    return out


@router.get("/public/vendor/questions", response_model=list[MrQuestionRead])
def vendor_list_questions(
    db: Session = Depends(get_db),
    inv: VendorInvitation = Depends(require_vendor_session),
):
    """Вопросы, видимые этому подрядчику: свои (любые) + публичные от других.
    Чужие приватные не видны. Авторы чужих публичных — анонимны."""
    mr = _ensure_mr_accepting(db, inv.mr_id)
    questions = (
        db.query(MrQuestion)
        .filter(MrQuestion.mr_id == mr.id, MrQuestion.parent_id.is_(None))
        .order_by(MrQuestion.id.desc())
        .all()
    )
    out = []
    for q in questions:
        mine = q.invitation_id == inv.id
        is_public = q.visibility == MrQuestionVisibility.PUBLIC
        if not (mine or is_public):
            continue
        out.append(
            MrQuestionRead(
                id=q.id,
                body=q.body,
                author_label=("Вы" if mine else "Поставщик"),
                is_public=is_public,
                mr_owner_item_id=q.mr_owner_item_id,
                mr_vendor_item_id=q.mr_vendor_item_id,
                created_at=q.created_at,
                replies=_question_replies(db, q),
            )
        )
    return out


@router.post("/public/vendor/questions", response_model=MrQuestionRead, status_code=status.HTTP_201_CREATED)
def vendor_create_question(
    payload: VendorQuestionCreate,
    request: Request,
    db: Session = Depends(get_db),
    inv: VendorInvitation = Depends(require_vendor_session),
):
    """Подрядчик задаёт вопрос (общий или по конкретному пункту). Уведомление
    уходит ответственному LR этой MR."""
    mr = _ensure_mr_accepting(db, inv.mr_id)
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty question")
    q = MrQuestion(
        mr_id=mr.id,
        invitation_id=inv.id,
        parent_id=None,
        mr_owner_item_id=payload.mr_owner_item_id,
        mr_vendor_item_id=payload.mr_vendor_item_id,
        body=body,
        visibility=MrQuestionVisibility.PRIVATE,
    )
    db.add(q)
    db.flush()
    # Уведомление LR (если назначен).
    if mr.lr_user_id:
        db.add(
            Notification(
                user_id=mr.lr_user_id,
                event_type="VENDOR_QUESTION",
                message=f"Вопрос поставщика по MR {mr.code}: {body[:120]}",
            )
        )
    db.commit()
    write_audit(db, action="vendor_question", mr_id=mr.id, invitation_id=inv.id, request=request)
    return MrQuestionRead(
        id=q.id, body=q.body, author_label="Вы", is_public=False,
        mr_owner_item_id=q.mr_owner_item_id, mr_vendor_item_id=q.mr_vendor_item_id,
        created_at=q.created_at, replies=[],
    )


@router.get("/public/vendor/owner-files/{file_id}")
def vendor_download_owner_file(
    file_id: int,
    db: Session = Depends(get_db),
    inv: VendorInvitation = Depends(require_vendor_session),
):
    """Скачивание документа заказчика подрядчиком. Только файлы СВОЕЙ MR
    (изоляция) и только пока приём открыт. Отдаётся как attachment."""
    from fastapi.responses import FileResponse

    mr = _ensure_mr_accepting(db, inv.mr_id)
    f = db.query(MrOwnerFile).filter(MrOwnerFile.id == file_id, MrOwnerFile.mr_id == mr.id).first()
    if f is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if not Path(f.file_path).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing")
    return FileResponse(f.file_path, filename=f.file_name, media_type="application/octet-stream")


@router.post("/public/vendor/submit", response_model=VendorSubmitResult)
def vendor_submit(
    request: Request,
    db: Session = Depends(get_db),
    inv: VendorInvitation = Depends(require_vendor_session),
):
    """Финальная отправка предложения подрядчиком. Автопроверка: все теги
    с ценой, все обязательные пункты чек-листа отвечены/с файлом. Если чего-то
    не хватает — возвращаем списки недостающего и НЕ отправляем. Иначе —
    фиксируем submitted_at, портал становится read-only, уведомляем LR."""
    mr = _ensure_mr_accepting(db, inv.mr_id)
    _ensure_not_submitted(inv)

    tags = db.query(MrTag).filter(MrTag.mr_id == mr.id).all()
    quotes = {q.tag_id: q for q in db.query(VendorQuote).filter(VendorQuote.invitation_id == inv.id).all()}
    missing_prices = [
        (t.item_no or t.tag_code) for t in tags
        if not quotes.get(t.id) or quotes[t.id].price is None
    ]

    required_items = (
        db.query(MrVendorItem)
        .filter(MrVendorItem.mr_id == mr.id, MrVendorItem.is_required.is_(True))
        .all()
    )
    responses = {
        r.vendor_item_id: r
        for r in db.query(VendorItemResponse).filter(VendorItemResponse.invitation_id == inv.id).all()
    }
    missing_required = []
    for item in required_items:
        r = responses.get(item.id)
        ok = bool(r and (r.answer is not None or r.upload_id is not None))
        if not ok:
            missing_required.append(item.code or item.title[:40])

    if missing_prices or missing_required:
        return VendorSubmitResult(status="incomplete", missing_prices=missing_prices, missing_required=missing_required)

    inv.submitted_at = datetime.utcnow()
    if mr.lr_user_id:
        db.add(
            Notification(
                user_id=mr.lr_user_id,
                event_type="VENDOR_SUBMITTED",
                message=f"Подрядчик {inv.vendor_company_name} отправил предложение по MR {mr.code}",
            )
        )
    db.commit()
    write_audit(db, action="vendor_submitted", mr_id=mr.id, invitation_id=inv.id, request=request)
    return VendorSubmitResult(status="submitted")
