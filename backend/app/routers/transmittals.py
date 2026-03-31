import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import (
    IncomingControlEvent,
    IncomingDecision,
    Notification,
    Revision,
    Transmittal,
    TransmittalItem,
    TransmittalStatus,
    User,
    UserRole,
)
from app.schemas import (
    IncomingControlDecision,
    IncomingControlEventRead,
    TransmittalCreate,
    TransmittalItemRead,
    TransmittalRead,
)

router = APIRouter()


def _next_trm_number(db: Session) -> str:
    # Simple sequential TRM number generator: TRM-00001, TRM-00002, ...
    max_seq = 0
    for (trm_number,) in db.query(Transmittal.trm_number).all():
        if not trm_number:
            continue
        value = trm_number.strip().upper()
        match = re.match(r"^TRM[-_]?(\d+)$", value)
        if match:
            max_seq = max(max_seq, int(match.group(1)))
    return f"TRM-{max_seq + 1:05d}"


@router.get("/transmittals", response_model=list[TransmittalRead])
def list_transmittals(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(Transmittal).order_by(Transmittal.id.desc()).all()


@router.get("/transmittals/next-number")
def get_next_transmittal_number(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return {"trm_number": _next_trm_number(db)}


@router.post("/transmittals", response_model=TransmittalRead, status_code=status.HTTP_201_CREATED)
def create_transmittal(
    payload: TransmittalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(
            UserRole.admin,
            UserRole.contractor,
            UserRole.contractor_manager,
            UserRole.contractor_author,
        )
    ),
):
    trm_number = payload.trm_number or _next_trm_number(db)
    existing = db.query(Transmittal).filter(Transmittal.trm_number == trm_number).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Transmittal number already exists")

    revisions = db.query(Revision).filter(Revision.id.in_(payload.revision_ids)).all()
    if len(revisions) != len(payload.revision_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more revisions not found")
    if any(not revision.file_path for revision in revisions):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="All revisions must have uploaded PDF")
    if any(revision.issue_purpose != payload.issue_purpose for revision in revisions):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All revisions in transmittal must have the same issue purpose",
        )

    transmittal = Transmittal(
        trm_number=trm_number,
        issue_purpose=payload.issue_purpose,
        channel=payload.channel,
        note=payload.note,
        status=TransmittalStatus.SENT,
        created_by_id=current_user.id,
        submitted_at=datetime.utcnow(),
    )
    db.add(transmittal)
    db.flush()

    for revision in revisions:
        revision.trm_number = trm_number
        revision.status = "IN_INCOMING_CHECK"
        db.add(revision)
        db.add(TransmittalItem(transmittal_id=transmittal.id, revision_id=revision.id))

    db.add(
        Notification(
            user_id=current_user.id,
            event_type="TRM_SUBMITTED",
            message=f"TRM {trm_number} submitted with {len(revisions)} revision(s)",
        )
    )
    db.commit()
    db.refresh(transmittal)
    return transmittal


@router.get("/transmittals/{transmittal_id}/items", response_model=list[TransmittalItemRead])
def list_transmittal_items(
    transmittal_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    transmittal = db.query(Transmittal).filter(Transmittal.id == transmittal_id).first()
    if transmittal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transmittal not found")
    return db.query(TransmittalItem).filter(TransmittalItem.transmittal_id == transmittal_id).all()


@router.post("/transmittals/{transmittal_id}/incoming-check", response_model=IncomingControlEventRead)
def incoming_check(
    transmittal_id: int,
    payload: IncomingControlDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_roles(
            UserRole.admin,
            UserRole.owner,
            UserRole.owner_manager,
            UserRole.owner_reviewer,
        )
    ),
):
    transmittal = db.query(Transmittal).filter(Transmittal.id == transmittal_id).first()
    if transmittal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transmittal not found")

    event = IncomingControlEvent(
        transmittal_id=transmittal.id,
        actor_id=current_user.id,
        decision=payload.decision,
        reason=payload.reason,
    )
    db.add(event)
    db.flush()

    revisions = (
        db.query(Revision)
        .join(TransmittalItem, TransmittalItem.revision_id == Revision.id)
        .filter(TransmittalItem.transmittal_id == transmittal.id)
        .all()
    )
    if payload.decision == IncomingDecision.ACCEPT:
        transmittal.status = TransmittalStatus.INCOMING_ACCEPTED
        for revision in revisions:
            revision.status = "IN_REVIEW"
            db.add(revision)
    else:
        transmittal.status = TransmittalStatus.INCOMING_REJECTED
        for revision in revisions:
            revision.status = "INCOMING_REJECTED"
            db.add(revision)

    db.add(transmittal)
    db.commit()
    db.refresh(event)
    return event
