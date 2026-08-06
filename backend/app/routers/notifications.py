from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Document, Notification, Revision, User
from app.schemas import NotificationRead

router = APIRouter()


def _cleanup_stale_notifications(db: Session, user_id: int) -> None:
    """Идемпотентно гасит «мусор» у пользователя (для всех ролей): уведомления
    по УСТАРЕВШИМ ревизиям (не последняя ревизия документа), по ЗАВЕРШЁННЫМ
    документам (AFD+AP — делать нечего), и просрочки старта (DOC_OVERDUE), если
    документ уже имеет ревизию, а также их дубли. Вызывается при загрузке списка."""
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read.is_(False))
        .all()
    )
    if not unread:
        return
    to_read: set[int] = set()

    # Ревизии из уведомлений → их документы и последняя ревизия документа.
    rev_ids = {n.revision_id for n in unread if n.revision_id}
    doc_of_rev: dict[int, int] = {}
    latest_rev_by_doc: dict[int, int] = {}
    completed_docs: set[int] = set()
    if rev_ids:
        for r_id, d_id in db.query(Revision.id, Revision.document_id).filter(Revision.id.in_(rev_ids)).all():
            doc_of_rev[r_id] = d_id
        doc_ids = set(doc_of_rev.values())
        if doc_ids:
            for r_id, d_id, purpose, code in (
                db.query(Revision.id, Revision.document_id, Revision.issue_purpose, Revision.review_code)
                .filter(Revision.document_id.in_(doc_ids))
                .all()
            ):
                if d_id not in latest_rev_by_doc or r_id > latest_rev_by_doc[d_id]:
                    latest_rev_by_doc[d_id] = r_id
                code_val = code.value if hasattr(code, "value") else (str(code) if code is not None else None)
                if (purpose or "").upper() == "AFD" and code_val == "AP":
                    completed_docs.add(d_id)

    for n in unread:
        if n.revision_id and n.revision_id in doc_of_rev:
            d = doc_of_rev[n.revision_id]
            # уведомление по не-последней ревизии — устарело
            if latest_rev_by_doc.get(d) != n.revision_id:
                to_read.add(n.id)
            # документ завершён — задач по нему нет
            elif d in completed_docs:
                to_read.add(n.id)

    # Просрочки старта: гасим, если документ уже имеет ревизию; и дубли (по document_num).
    overdue = [n for n in unread if n.event_type == "DOC_OVERDUE_PLAN_START" and n.document_num]
    seen_docs: set[str] = set()
    for n in sorted(overdue, key=lambda x: x.id, reverse=True):
        has_rev = (
            db.query(Revision.id)
            .join(Document, Document.id == Revision.document_id)
            .filter(Document.document_num == n.document_num)
            .first()
            is not None
        )
        if has_rev or n.document_num in seen_docs:
            to_read.add(n.id)
        else:
            seen_docs.add(n.document_num)

    if to_read:
        db.query(Notification).filter(Notification.id.in_(to_read)).update(
            {Notification.is_read: True}, synchronize_session=False
        )
        db.commit()


@router.get("", response_model=list[NotificationRead])
def list_notifications(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        _cleanup_stale_notifications(db, current_user.id)
    except Exception:  # noqa: BLE001 — чистка не должна ронять список
        db.rollback()
    items = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.id.desc())
        .all()
    )
    result: list[NotificationRead] = []
    for item in items:
        deadline = None
        if item.revision_id is not None:
            rev = db.query(Revision).filter(Revision.id == item.revision_id).first()
            deadline = rev.review_deadline if rev else None
        result.append(
            NotificationRead.model_validate(item, from_attributes=True).model_copy(
                update={"task_deadline": deadline}
            )
        )
    return result


@router.put("/{notification_id}/read", response_model=NotificationRead)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    item.is_read = True
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read.is_(False))
        .update({Notification.is_read: True})
    )
    db.commit()
