from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.config import get_settings
from app.database import get_db
from app.deps import is_main_admin, require_main_admin, require_user_manager
from app.models import (
    Comment,
    CommentStatus,
    CompanyType,
    Document,
    MDRRecord,
    Notification,
    ProjectMember,
    RegistrationRequest,
    RegistrationRequestStatus,
    Revision,
    User,
    UserPermission,
    UserRole,
)
from app.schemas import (
    QuickDemoSetupRequest,
    QuickDemoSetupResponse,
    RegistrationApprovePayload,
    RegistrationRejectPayload,
    RegistrationRequestRead,
    UserActivationUpdate,
    UserCreate,
    UserPermissionUpdate,
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


def _next_available_email(db: Session, base_email: str) -> str:
    email = base_email.lower()
    if db.query(User).filter(User.email == email).first() is None:
        return email

    local_part, domain = email.split("@", 1)
    suffix = 1
    while True:
        candidate = f"{local_part}+{suffix}@{domain}"
        exists = db.query(User).filter(User.email == candidate).first()
        if exists is None:
            return candidate
        suffix += 1


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
    db.flush()

    db.add(
        UserPermission(
            user_id=user.id,
            originator_code=(payload.originator_code or "").strip().upper() or None,
            can_manage_mdr=payload.can_manage_mdr,
            can_manage_project_members=payload.can_manage_project_members,
        )
    )
    db.commit()
    db.refresh(user)
    return user


@router.post("/quick-demo-setup", response_model=QuickDemoSetupResponse, status_code=status.HTTP_201_CREATED)
def quick_demo_setup(
    payload: QuickDemoSetupRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    contractor_email = _next_available_email(db, payload.contractor_email)
    owner_email = _next_available_email(
        db,
        payload.owner_email if payload.owner_email.lower() != contractor_email else f"owner+1@{payload.owner_email.split('@', 1)[1]}",
    )

    contractor = User(
        email=contractor_email,
        hashed_password=get_password_hash(payload.password),
        full_name="Demo Contractor",
        company_type=CompanyType.contractor,
        role=UserRole.contractor_manager,
        is_active=True,
    )
    owner = User(
        email=owner_email,
        hashed_password=get_password_hash(payload.password),
        full_name="Demo Owner",
        company_type=CompanyType.owner,
        role=UserRole.owner_reviewer,
        is_active=True,
    )
    db.add(contractor)
    db.add(owner)
    db.flush()
    db.add(
        UserPermission(
            user_id=contractor.id,
            originator_code="CTR",
            can_manage_mdr=True,
            can_manage_project_members=False,
        )
    )
    db.add(
        UserPermission(
            user_id=owner.id,
            originator_code=None,
            can_manage_mdr=False,
            can_manage_project_members=False,
        )
    )

    suffix = datetime.utcnow().strftime("%y%m%d%H%M%S%f")
    doc_number = f"DEM-CTR-SE-1100000-SE-IGD-{suffix[-5:]}"
    mdr = MDRRecord(
        document_key=f"DEMO-{suffix[-10:]}",
        project_code="DEMO",
        originator_code="CTR",
        category="SE",
        title_object="1100000",
        discipline_code="SE",
        doc_type="IGD",
        serial_number=suffix[-4:],
        doc_number=doc_number,
        doc_name="Demo drawing for workflow",
        progress_percent=70.0,
        doc_weight=1.0,
        issue_purpose="IFR",
        revision="A",
        dates={},
        status="IN_REVIEW",
        contractor_responsible_id=contractor.id,
        owner_responsible_id=owner.id,
        is_confidential=False,
    )
    db.add(mdr)
    db.flush()

    document = Document(
        mdr_id=mdr.id,
        document_num=doc_number,
        title="Demo drawing",
        discipline="Piping",
        weight=1.0,
        created_by_id=contractor.id,
    )
    db.add(document)
    db.flush()

    revision = Revision(
        document_id=document.id,
        revision_code="A",
        issue_purpose="IFR",
        status="SUBMITTED",
        trm_number=f"TRM-DEMO-{suffix[-6:]}",
        file_path=f"DEMO/{doc_number}/A/demo.pdf",
    )
    db.add(revision)
    db.flush()

    comment = Comment(
        revision_id=revision.id,
        author_id=owner.id,
        text="Please verify demo dimensions on page 2",
        status=CommentStatus.IN_PROGRESS,
        page=2,
        area_x=120,
        area_y=180,
        area_w=260,
        area_h=80,
    )
    db.add(comment)
    db.flush()

    response = Comment(
        revision_id=revision.id,
        parent_id=comment.id,
        author_id=contractor.id,
        text="Corrected in next revision draft",
        status=CommentStatus.IN_PROGRESS,
    )
    db.add(response)

    db.commit()

    return QuickDemoSetupResponse(
        contractor_email=contractor.email,
        owner_email=owner.email,
        password=payload.password,
        mdr_id=mdr.id,
        document_id=document.id,
        revision_id=revision.id,
        comment_id=comment.id,
    )


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
        UserPermission(
            user_id=user.id,
            originator_code=None,
            can_manage_mdr=False,
            can_manage_project_members=False,
        )
    )

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


@router.put("/{user_id}/permissions", response_model=UserRead)
def update_user_permissions(
    user_id: int,
    payload: UserPermissionUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    permission = db.query(UserPermission).filter(UserPermission.user_id == user.id).first()
    if permission is None:
        permission = UserPermission(user_id=user.id)

    permission.originator_code = (payload.originator_code or "").strip().upper() or None
    permission.can_manage_mdr = payload.can_manage_mdr
    permission.can_manage_project_members = payload.can_manage_project_members

    db.add(permission)
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

    db.query(ProjectMember).filter(ProjectMember.user_id == user.id).delete()
    db.query(UserPermission).filter(UserPermission.user_id == user.id).delete()
    db.query(Notification).filter(Notification.user_id == user.id).delete()
    db.query(RegistrationRequest).filter(RegistrationRequest.reviewed_by_id == user.id).update(
        {RegistrationRequest.reviewed_by_id: None}
    )
    db.query(MDRRecord).filter(MDRRecord.contractor_responsible_id == user.id).update(
        {MDRRecord.contractor_responsible_id: None}
    )
    db.query(MDRRecord).filter(MDRRecord.owner_responsible_id == user.id).update(
        {MDRRecord.owner_responsible_id: None}
    )

    try:
        db.delete(user)
        db.commit()
    except IntegrityError:
        db.rollback()
        user.is_active = False
        if "(архив)" not in user.full_name:
            user.full_name = f"{user.full_name} (архив)"
        db.add(user)
        db.commit()
