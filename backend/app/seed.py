from sqlalchemy.orm import Session
from sqlalchemy.exc import DataError, ProgrammingError

from app.auth import get_password_hash
from app.config import get_settings
from app.deps import default_permissions_for_role
from app.models import CompanyType, User, UserRole, WorkflowStatus


def seed_default_data(db: Session) -> None:
    settings = get_settings()

    admin = db.query(User).filter(User.email == settings.first_admin_email).first()
    if admin is None:
        admin = User(
            email=settings.first_admin_email,
            hashed_password=get_password_hash(settings.first_admin_password),
            full_name=settings.first_admin_full_name,
            company_type=CompanyType.admin,
            role=UserRole.admin,
            permissions=default_permissions_for_role(UserRole.admin),
            is_active=True,
        )
        db.add(admin)
    else:
        admin.role = UserRole.admin
        admin.permissions = default_permissions_for_role(UserRole.admin)
        admin.company_type = CompanyType.admin
        admin.is_active = True
        db.add(admin)

    # NOTE:
    # On some legacy Postgres deployments enum type "userrole" may not yet include
    # value "user". In that case, hard migration on startup crashes the whole app.
    # Keep startup resilient: try migration, and if enum is not ready - skip for now.
    try:
        db.query(User).filter(User.role != UserRole.admin).update(
            {User.role: UserRole.user, User.permissions: default_permissions_for_role(UserRole.user)}
        )
    except (DataError, ProgrammingError):
        db.rollback()

    if settings.main_admin_email != settings.first_admin_email:
        main_admin = db.query(User).filter(User.email == settings.main_admin_email).first()
        if main_admin is None:
            db.add(
                User(
                    email=settings.main_admin_email,
                    hashed_password=get_password_hash(settings.first_admin_password),
                    full_name="Main Administrator",
                    company_type=CompanyType.admin,
                    role=UserRole.admin,
                    permissions=default_permissions_for_role(UserRole.admin),
                    is_active=True,
                )
            )
        else:
            main_admin.role = UserRole.admin
            main_admin.permissions = default_permissions_for_role(UserRole.admin)
            main_admin.company_type = CompanyType.admin
            main_admin.is_active = True
            db.add(main_admin)

    statuses = [
        ("AP", "Approved", "#52c41a", True),
        ("AN", "Approved as Note", "#13c2c2", True),
        ("CO", "Commented", "#faad14", False),
        ("RJ", "Rejected", "#ff4d4f", False),
    ]

    for code, name, color, is_final in statuses:
        exists = db.query(WorkflowStatus).filter(WorkflowStatus.code == code).first()
        if exists is None:
            db.add(
                WorkflowStatus(
                    code=code,
                    name=name,
                    color=color,
                    description=f"Default status {code}",
                    is_final=is_final,
                    editable=True,
                )
            )

    db.commit()
