from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Notification, Revision, User
from app.schemas import NotificationRead

router = APIRouter()


@router.get("", response_model=list[NotificationRead])
def list_notifications(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
