from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.config import get_settings
from app.database import get_db
from app.seed import seed_default_data
from app.deps import (
    default_permissions_for_role,
    get_effective_permissions,
    is_main_admin,
    require_main_admin,
    require_user_manager,
)
from app.models import (
    Comment,
    CommentStatus,
    CompanyType,
    Document,
    MDRRecord,
    Notification,
    Project,
    ProjectMember,
    ProjectReference,
    RegistrationRequest,
    RegistrationRequestStatus,
    ReviewMatrixMember,
    Revision,
    SystemSetting,
    User,
    UserSession,
    UserRole,
)
from app.schemas import (
    QuickDemoSetupRequest,
    QuickDemoSetupResponse,
    RegistrationApprovePayload,
    RegistrationRejectPayload,
    RegistrationRequestRead,
    AdminReviewSlaSettingsRead,
    AdminReviewSlaSettingsUpdate,
    UserActivationUpdate,
    UserCreate,
    UserPermissionsUpdate,
    UserPasswordUpdate,
    UserRead,
    UserRoleUpdate,
    UserSessionRead,
    UserUpdate,
)

router = APIRouter()
settings = get_settings()
UPLOAD_ROOT = Path("/tmp/tdo_uploads")

SLA_INITIAL_KEY = "review_sla_default_initial_days"
SLA_NEXT_KEY = "review_sla_default_next_days"
SLA_KEYS_DEFAULTS: dict[str, float] = {
    SLA_INITIAL_KEY: 14,
    SLA_NEXT_KEY: 7,
    "review_sla_owner_dcc_incoming_days": 1,
    "review_sla_owner_specialist_review_days": 7,
    "review_sla_owner_lr_approval_days": 1,
    "review_sla_contractor_consideration_days": 0.5,
    "review_sla_contractor_ap_issue_days": 2,
    "review_sla_contractor_an_issue_days": 5,
    "review_sla_contractor_co_rj_issue_days": 8,
    "review_sla_owner_final_approval_days": 1,
    "review_sla_owner_stamp_days": 1,
}


def _default_company_code(company_type: CompanyType) -> str:
    if company_type == CompanyType.contractor:
        return "CTR"
    if company_type == CompanyType.owner:
        return "OWN"
    return "ADM"


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
    users = db.query(User).order_by(User.id.asc()).all()
    return [
        UserRead.model_validate(user, from_attributes=True).model_copy(
            update={"permissions": get_effective_permissions(user)}
        )
        for user in users
    ]


@router.get("/admin-settings/review-sla", response_model=AdminReviewSlaSettingsRead)
def get_admin_review_sla_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    values: dict[str, float] = {}
    for key, default in SLA_KEYS_DEFAULTS.items():
        item = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if item is None:
            values[key] = default
            continue
        try:
            values[key] = float(item.value)
        except ValueError:
            values[key] = default
    return AdminReviewSlaSettingsRead(
        initial_days=values[SLA_INITIAL_KEY],
        next_days=values[SLA_NEXT_KEY],
        owner_dcc_incoming_days=values["review_sla_owner_dcc_incoming_days"],
        owner_specialist_review_days=values["review_sla_owner_specialist_review_days"],
        owner_lr_approval_days=values["review_sla_owner_lr_approval_days"],
        contractor_consideration_days=values["review_sla_contractor_consideration_days"],
        contractor_ap_issue_days=values["review_sla_contractor_ap_issue_days"],
        contractor_an_issue_days=values["review_sla_contractor_an_issue_days"],
        contractor_co_rj_issue_days=values["review_sla_contractor_co_rj_issue_days"],
        owner_final_approval_days=values["review_sla_owner_final_approval_days"],
        owner_stamp_days=values["review_sla_owner_stamp_days"],
    )


@router.put("/admin-settings/review-sla", response_model=AdminReviewSlaSettingsRead)
def update_admin_review_sla_settings(
    payload: AdminReviewSlaSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    updates = {
        SLA_INITIAL_KEY: payload.initial_days,
        SLA_NEXT_KEY: payload.next_days,
        "review_sla_owner_dcc_incoming_days": payload.owner_dcc_incoming_days,
        "review_sla_owner_specialist_review_days": payload.owner_specialist_review_days,
        "review_sla_owner_lr_approval_days": payload.owner_lr_approval_days,
        "review_sla_contractor_consideration_days": payload.contractor_consideration_days,
        "review_sla_contractor_ap_issue_days": payload.contractor_ap_issue_days,
        "review_sla_contractor_an_issue_days": payload.contractor_an_issue_days,
        "review_sla_contractor_co_rj_issue_days": payload.contractor_co_rj_issue_days,
        "review_sla_owner_final_approval_days": payload.owner_final_approval_days,
        "review_sla_owner_stamp_days": payload.owner_stamp_days,
    }
    for key, value in updates.items():
        item = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if item is None:
            item = SystemSetting(key=key, value=str(value))
        else:
            item.value = str(value)
        db.add(item)
    db.commit()
    return AdminReviewSlaSettingsRead(**payload.model_dump())


@router.delete("/admin-tools/project-data", status_code=status.HTTP_200_OK)
def clear_project_data(
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    revisions = db.query(Revision).all()
    revision_ids = [item.id for item in revisions]
    file_paths = [item.file_path for item in revisions if item.file_path]

    documents = db.query(Document).all()
    document_nums = [item.document_num for item in documents]

    mdr_items = db.query(MDRRecord).all()
    project_codes = [item.project_code for item in mdr_items]

    deleted_files = 0
    for raw_path in file_paths:
        try:
            path = Path(raw_path).resolve()
            root = UPLOAD_ROOT.resolve()
            if root in path.parents and path.exists():
                path.unlink()
                deleted_files += 1
        except OSError:
            continue

    if revision_ids:
        db.query(Notification).filter(Notification.revision_id.in_(revision_ids)).delete(
            synchronize_session=False
        )
        db.query(Comment).filter(Comment.revision_id.in_(revision_ids)).delete(
            synchronize_session=False
        )
        db.query(Revision).filter(Revision.id.in_(revision_ids)).delete(synchronize_session=False)

    if document_nums:
        db.query(Notification).filter(Notification.document_num.in_(document_nums)).delete(
            synchronize_session=False
        )
    if project_codes:
        db.query(Notification).filter(Notification.project_code.in_(project_codes)).delete(
            synchronize_session=False
        )

    db.query(Document).delete(synchronize_session=False)
    db.query(MDRRecord).delete(synchronize_session=False)
    db.query(ProjectReference).delete(synchronize_session=False)
    db.query(ReviewMatrixMember).delete(synchronize_session=False)
    db.query(ProjectMember).delete(synchronize_session=False)
    db.query(Project).delete(synchronize_session=False)

    db.flush()
    seed_default_data(db)
    return {
        "message": "Project data and files cleared",
        "deleted_files": deleted_files,
        "deleted_revisions": len(revision_ids),
        "deleted_documents": len(documents),
        "deleted_mdr": len(mdr_items),
    }


@router.delete("/admin-tools/notifications", status_code=status.HTTP_200_OK)
def clear_all_notifications(
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    deleted = db.query(Notification).delete(synchronize_session=False)
    db.commit()
    return {"message": "All notifications cleared", "deleted_notifications": deleted}


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
        company_code=(payload.company_code or _default_company_code(payload.company_type)).upper()[:3],
        company_type=payload.company_type,
        role=payload.role,
        permissions=(payload.permissions or default_permissions_for_role(payload.role)),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user, from_attributes=True).model_copy(
        update={"permissions": get_effective_permissions(user)}
    )


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
        company_code="CTR",
        company_type=CompanyType.contractor,
        role=UserRole.user,
        is_active=True,
    )
    owner = User(
        email=owner_email,
        hashed_password=get_password_hash(payload.password),
        full_name="Demo Owner",
        company_code="OWN",
        company_type=CompanyType.owner,
        role=UserRole.user,
        is_active=True,
    )
    db.add(contractor)
    db.add(owner)
    db.flush()

    suffix = datetime.utcnow().strftime("%y%m%d%H%M%S%f")
    doc_number = f"DEMO-PD-{suffix[-8:]}"
    mdr = MDRRecord(
        document_key=f"DEMO-{suffix[-10:]}",
        project_code="DEMO",
        originator_code="CTR",
        category="PIPING",
        title_object="Demo Unit",
        discipline_code="PD",
        doc_type="DRAWING",
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

    target_role = payload.role or request_item.requested_role or UserRole.user
    target_company_type = payload.company_type or request_item.company_type

    _validate_admin_constraints(current_user, target_role, target_company_type)

    user = User(
        email=request_item.email,
        hashed_password=request_item.hashed_password,
        full_name=request_item.full_name,
        company_code=_default_company_code(target_company_type),
        company_type=target_company_type,
        role=target_role,
        permissions=default_permissions_for_role(target_role),
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
    return UserRead.model_validate(user, from_attributes=True).model_copy(
        update={"permissions": get_effective_permissions(user)}
    )


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
    user.permissions = default_permissions_for_role(payload.role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user, from_attributes=True).model_copy(
        update={"permissions": get_effective_permissions(user)}
    )


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
    return UserRead.model_validate(user, from_attributes=True).model_copy(
        update={"permissions": get_effective_permissions(user)}
    )


@router.put("/{user_id}/permissions", response_model=UserRead)
def update_user_permissions(
    user_id: int,
    payload: UserPermissionsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.permissions = payload.permissions
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user, from_attributes=True).model_copy(
        update={"permissions": get_effective_permissions(user)}
    )


@router.put("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    data = payload.model_dump(exclude_unset=True)
    if "email" in data and data["email"]:
        normalized_email = str(data["email"]).lower()
        exists = db.query(User).filter(User.email == normalized_email, User.id != user_id).first()
        if exists is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
        user.email = normalized_email
    if "full_name" in data and data["full_name"] is not None:
        user.full_name = data["full_name"]
    if "company_code" in data:
        user.company_code = (data["company_code"] or "").upper()[:3] or None
    if "company_type" in data and data["company_type"] is not None:
        user.company_type = data["company_type"]
    if "is_active" in data and data["is_active"] is not None:
        user.is_active = bool(data["is_active"])

    db.add(user)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user, from_attributes=True).model_copy(
        update={"permissions": get_effective_permissions(user)}
    )


@router.put("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def update_user_password(
    user_id: int,
    payload: UserPasswordUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.hashed_password = get_password_hash(payload.new_password)
    db.add(user)
    db.commit()


@router.get("/{user_id}/sessions", response_model=list[UserSessionRead])
def list_user_sessions(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    items = db.query(UserSession).filter(UserSession.user_id == user_id).order_by(UserSession.created_at.desc()).all()
    now = datetime.utcnow()
    return [
        UserSessionRead.model_validate(item, from_attributes=True).model_copy(
            update={"is_active": item.revoked_at is None and item.expires_at > now}
        )
        for item in items
    ]


@router.delete("/{user_id}/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_user_session(
    user_id: int,
    session_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    session = db.query(UserSession).filter(UserSession.id == session_id, UserSession.user_id == user_id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session.revoked_at = datetime.utcnow()
    db.add(session)
    db.commit()


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
    db.query(Notification).filter(Notification.user_id == user.id).delete()
    db.query(UserSession).filter(UserSession.user_id == user.id).delete()
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
