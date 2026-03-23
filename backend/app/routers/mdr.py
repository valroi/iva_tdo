from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import MDRRecord, Project, User, UserRole
from app.schemas import MDRCreate, MDRRead, MDRUpdate

router = APIRouter()


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
