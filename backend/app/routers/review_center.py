from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import (
    Comment,
    CommentStatus,
    Notification,
    ReviewCode,
    Revision,
    RevisionWorkflowEvent,
    User,
    UserRole,
)
from app.schemas import (
    ACRSRead,
    CRSCreate,
    CRSRead,
    CRSIssueCodeUpdate,
)

router = APIRouter()


def _ensure_revision(db: Session, revision_id: int) -> Revision:
    revision = db.query(Revision).filter(Revision.id == revision_id).first()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    return revision


def _ensure_can_issue_crs(user: User) -> None:
    if user.role not in {UserRole.admin, UserRole.owner_manager, UserRole.owner_reviewer}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions to issue CRS")


def _ensure_can_issue_acrs(user: User) -> None:
    if user.role not in {UserRole.admin, UserRole.contractor_manager, UserRole.contractor_author}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions to issue ACRS")


@router.post("/review/crs", response_model=CRSRead, status_code=status.HTTP_201_CREATED)
def issue_crs(
    payload: CRSCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_can_issue_crs(current_user)
    revision = _ensure_revision(db, payload.revision_id)

    comment = Comment(
        revision_id=payload.revision_id,
        parent_id=None,
        author_id=current_user.id,
        text=payload.text,
        status=CommentStatus.OPEN,
        page=payload.page,
        area_x=payload.area_x,
        area_y=payload.area_y,
        area_w=payload.area_w,
        area_h=payload.area_h,
    )
    db.add(comment)
    db.flush()

    revision.status = "IN_REVIEW"
    db.add(
        RevisionWorkflowEvent(
            revision_id=revision.id,
            actor_id=current_user.id,
            action="CRS_ISSUED",
            comment=f"CRS issued comment_id={comment.id}",
        )
    )

    contractor_receivers = (
        db.query(User)
        .filter(User.role.in_([UserRole.contractor_manager, UserRole.contractor_author]), User.is_active.is_(True))
        .all()
    )
    for receiver in contractor_receivers:
        db.add(
            Notification(
                user_id=receiver.id,
                event_type="CRS_ISSUED",
                message=f"New CRS for revision {revision.revision_code}",
            )
        )

    db.commit()
    db.refresh(comment)
    return comment


@router.get("/review/revisions/{revision_id}/crs", response_model=list[CRSRead])
def list_crs_items(
    revision_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    _ensure_revision(db, revision_id)
    return (
        db.query(Comment)
        .filter(Comment.revision_id == revision_id, Comment.parent_id.is_(None))
        .order_by(Comment.id.asc())
        .all()
    )


@router.put("/review/crs/{comment_id}/code", response_model=CRSRead)
def set_crs_review_code(
    comment_id: int,
    payload: CRSIssueCodeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_can_issue_crs(current_user)
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CRS item not found")

    revision = _ensure_revision(db, comment.revision_id)
    comment.status = payload.status
    revision.review_code = payload.review_code
    if payload.review_code == ReviewCode.AP:
        revision.status = "APPROVED"
        revision.reviewed_at = datetime.utcnow()
    elif payload.review_code == ReviewCode.RJ:
        revision.status = "REJECTED"
    else:
        revision.status = "COMMENTED"

    db.add(comment)
    db.add(revision)
    db.add(
        RevisionWorkflowEvent(
            revision_id=revision.id,
            actor_id=current_user.id,
            action="REVIEW_CODE_SET",
            comment=f"comment_id={comment.id}, code={payload.review_code}",
        )
    )
    db.commit()
    db.refresh(comment)
    return comment


@router.post("/review/acrs/{comment_id}", response_model=ACRSRead, status_code=status.HTTP_201_CREATED)
def issue_acrs(
    comment_id: int,
    payload: CRSCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_can_issue_acrs(current_user)
    parent = db.query(Comment).filter(Comment.id == comment_id).first()
    if parent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CRS item not found")

    revision = _ensure_revision(db, parent.revision_id)
    if not revision.file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ACRS must be sent together with corrected documentation (upload revision PDF first)",
        )

    response = Comment(
        revision_id=parent.revision_id,
        parent_id=parent.id,
        author_id=current_user.id,
        text=payload.text,
        status=payload.status,
    )
    parent.status = payload.status

    if payload.status == CommentStatus.RESOLVED:
        parent.resolved_at = datetime.utcnow()
        revision.status = "RE_REVIEW"

    db.add(response)
    db.add(parent)
    db.add(revision)
    db.add(
        RevisionWorkflowEvent(
            revision_id=revision.id,
            actor_id=current_user.id,
            action="ACRS_ISSUED",
            comment=f"response_to={parent.id}",
        )
    )

    owner_receivers = (
        db.query(User)
        .filter(User.role.in_([UserRole.owner_manager, UserRole.owner_reviewer]), User.is_active.is_(True))
        .all()
    )
    for receiver in owner_receivers:
        db.add(
            Notification(
                user_id=receiver.id,
                event_type="ACRS_ISSUED",
                message=f"ACRS submitted for revision {revision.revision_code}",
            )
        )

    db.commit()
    db.refresh(response)
    return response
