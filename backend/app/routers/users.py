from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.config import get_settings
from app.database import get_db
from app.deps import is_main_admin, require_main_admin, require_user_manager
from app.models import (
    CompanyType,
    Notification,
    RegistrationRequest,
    RegistrationRequestStatus,
    User,
    UserRole,
)
from app.schemas import (
    RegistrationApprovePayload,
    RegistrationRejectPayload,
    RegistrationRequestRead,
    UserActivationUpdate,
    UserCreate,
    UserRead,
    UserRoleUpdate,
)

router = APIRouter()
settings = get_settings()


def _validate_admin_constraints(actor: User, role: UserRole, company_type: CompanyType) -> None:
    if role == UserRole.admin and not is_main_admin(actor):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only main admin can grant admin role",
        )

    if role == UserRole.admin and company_type != CompanyType.admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin role requires company_type=admin",
        )


@router.get("", response_model=list[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_user_manager),
):
    return db.query(User).order_by(User.id.asc()).all()


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user_manager),
):
    email = payload.email.lower()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    _validate_admin_constraints(current_user, payload.role, payload.company_type)

    user = User(
        email=email,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        company_type=payload.company_type,
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/registration-requests", response_model=list[RegistrationRequestRead])
def list_registration_requests(
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    return db.query(RegistrationRequest).order_by(RegistrationRequest.id.desc()).all()


@router.post(
    "/registration-requests/{request_id}/approve",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
)
def approve_registration_request(
    request_id: int,
    payload: RegistrationApprovePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_main_admin),
):
    request_item = db.query(RegistrationRequest).filter(RegistrationRequest.id == request_id).first()
    if request_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")

    if request_item.status != RegistrationRequestStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is already processed")

    existing_user = db.query(User).filter(User.email == request_item.email).first()
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    target_role = payload.role or request_item.requested_role or UserRole.viewer
    target_company_type = payload.company_type or request_item.company_type

    _validate_admin_constraints(current_user, target_role, target_company_type)

    user = User(
        email=request_item.email,
        hashed_password=request_item.hashed_password,
        full_name=request_item.full_name,
        company_type=target_company_type,
        role=target_role,
        is_active=payload.is_active,
    )

    request_item.status = RegistrationRequestStatus.APPROVED
    request_item.reviewed_by_id = current_user.id
    request_item.reviewed_at = datetime.utcnow()

    db.add(user)
    db.add(request_item)
    db.flush()

    db.add(
        Notification(
            user_id=user.id,
            event_type="REGISTRATION_APPROVED",
            message="Your registration request has been approved",
        )
    )

    db.commit()
    db.refresh(user)
    return user


@router.post("/registration-requests/{request_id}/reject", response_model=RegistrationRequestRead)
def reject_registration_request(
    request_id: int,
    payload: RegistrationRejectPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_main_admin),
):
    request_item = db.query(RegistrationRequest).filter(RegistrationRequest.id == request_id).first()
    if request_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")

    if request_item.status != RegistrationRequestStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is already processed")

    request_item.status = RegistrationRequestStatus.REJECTED
    request_item.review_note = payload.review_note
    request_item.reviewed_by_id = current_user.id
    request_item.reviewed_at = datetime.utcnow()

    db.add(request_item)
    db.commit()
    db.refresh(request_item)
    return request_item


@router.put("/{user_id}/role", response_model=UserRead)
def update_user_role(
    user_id: int,
    payload: UserRoleUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.email.lower() == settings.main_admin_email.lower() and payload.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Main admin cannot lose admin role",
        )

    if payload.role == UserRole.admin:
        user.company_type = CompanyType.admin

    user.role = payload.role
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}/active", response_model=UserRead)
def set_user_active(
    user_id: int,
    payload: UserActivationUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.email.lower() == settings.main_admin_email.lower() and not payload.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Main admin cannot be deactivated",
        )

    user.is_active = payload.is_active
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.email.lower() == settings.main_admin_email.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Main admin cannot be deleted",
        )

    db.delete(user)
    db.commit()
