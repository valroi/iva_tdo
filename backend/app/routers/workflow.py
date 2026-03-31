from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import User, UserRole, WorkflowStatus
from app.schemas import WorkflowStatusCreate, WorkflowStatusRead, WorkflowStatusUpdate

router = APIRouter()


@router.get("/statuses", response_model=list[WorkflowStatusRead])
def list_statuses(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(WorkflowStatus).order_by(WorkflowStatus.id.asc()).all()


@router.post("/statuses", response_model=WorkflowStatusRead, status_code=status.HTTP_201_CREATED)
def create_status(
    payload: WorkflowStatusCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
):
    existing = db.query(WorkflowStatus).filter(WorkflowStatus.code == payload.code).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Status code already exists")

    status_item = WorkflowStatus(**payload.model_dump())
    db.add(status_item)
    db.commit()
    db.refresh(status_item)
    return status_item


@router.put("/statuses/{status_id}", response_model=WorkflowStatusRead)
def update_status(
    status_id: int,
    payload: WorkflowStatusUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
):
    status_item = db.query(WorkflowStatus).filter(WorkflowStatus.id == status_id).first()
    if not status_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Status not found")

    if not status_item.editable:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status is locked")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(status_item, field, value)

    db.add(status_item)
    db.commit()
    db.refresh(status_item)
    return status_item
