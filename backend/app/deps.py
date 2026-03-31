from __future__ import annotations

from typing import Iterable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth import TokenError, decode_token
from app.config import get_settings
from app.database import get_db
from app.models import CompanyType, User, UserRole

bearer_scheme = HTTPBearer(auto_error=False)
settings = get_settings()

PERMISSION_KEYS = (
    "can_manage_users",
    "can_manage_projects",
    "can_edit_project_references",
    "can_manage_review_matrix",
    "can_create_mdr",
    "can_upload_files",
    "can_comment",
    "can_raise_comments",
    "can_respond_comments",
    "can_publish_comments",
    "can_edit_workflow_statuses",
    "can_process_tdo_queue",
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        subject = decode_token(credentials.credentials, expected_type="access")
    except TokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    user = db.query(User).filter(User.email == subject).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")
    return user


def require_roles(*roles: UserRole):
    allowed = set(roles)

    def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return _checker


def default_permissions_for_role(role: UserRole) -> dict[str, bool]:
    if role == UserRole.admin:
        return {key: True for key in PERMISSION_KEYS}
    return {
        "can_manage_users": False,
        "can_manage_projects": False,
        "can_edit_project_references": False,
        "can_manage_review_matrix": False,
        "can_create_mdr": True,
        "can_upload_files": True,
        "can_comment": True,
        "can_raise_comments": True,
        "can_respond_comments": True,
        "can_publish_comments": False,
        "can_edit_workflow_statuses": False,
        "can_process_tdo_queue": False,
    }


def get_effective_permissions(user: User) -> dict[str, bool]:
    defaults = default_permissions_for_role(user.role)
    custom = user.permissions or {}
    return {key: bool(custom.get(key, defaults[key])) for key in PERMISSION_KEYS}


def has_permission(user: User, permission: str) -> bool:
    return get_effective_permissions(user).get(permission, False)


def require_permissions(*permissions: str):
    required = set(permissions)

    def _checker(user: User = Depends(get_current_user)) -> User:
        effective = get_effective_permissions(user)
        if any(not effective.get(item, False) for item in required):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return _checker


def is_main_admin(user: User) -> bool:
    return user.email.lower() == settings.main_admin_email.lower()


def require_user_manager(user: User = Depends(get_current_user)) -> User:
    if not has_permission(user, "can_manage_users"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Users management permission required")
    return user


def require_main_admin(user: User = Depends(require_user_manager)) -> User:
    if not is_main_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Main admin required")
    return user


def users_by_company_types(
    db: Session,
    *,
    company_types: Iterable[CompanyType],
) -> list[User]:
    return db.query(User).filter(User.company_type.in_(list(company_types))).all()
