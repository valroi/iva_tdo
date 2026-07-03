from __future__ import annotations

import ipaddress
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    decode_token_payload,
    hash_token,
    get_password_hash,
    verify_password,
)
from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user, get_effective_permissions, require_main_admin
from app.models import Notification, RegistrationRequest, RegistrationRequestStatus, User, UserSession
from app.schemas import LoginRequest, RefreshRequest, RegisterRequest, TokenPair, UserRead, UserSessionRead

router = APIRouter()
settings = get_settings()

# --- Защита /login от перебора (интернет-экспозиция) ---------------------
# In-memory: процесс uvicorn один (см. Dockerfile CMD), внешних зависимостей
# не требуется. Ключ — (ip, email): злоумышленник с одного IP не подберёт
# пароль, легитимного пользователя с другого IP не блокирует.
_LOGIN_MAX_FAILS = 5
_LOGIN_LOCK_SECONDS = 15 * 60
_login_fails: dict[tuple[str, str], list[float]] = {}


def _login_locked(ip: str, email: str) -> bool:
    import time

    key = (ip, email)
    now = time.monotonic()
    attempts = [t for t in _login_fails.get(key, []) if now - t < _LOGIN_LOCK_SECONDS]
    _login_fails[key] = attempts
    return len(attempts) >= _LOGIN_MAX_FAILS


def _login_register_fail(ip: str, email: str) -> None:
    import time

    _login_fails.setdefault((ip, email), []).append(time.monotonic())
    # Не даём словарю расти бесконечно.
    if len(_login_fails) > 10_000:
        _login_fails.clear()


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    email = payload.email.lower()
    ip = _get_ip_address(request) or "unknown"
    if _login_locked(ip, email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again in 15 minutes.",
        )
    user = db.query(User).filter(User.email == email).first()
    if (
        user is None
        or not user.is_active
        or not verify_password(payload.password, user.hashed_password)
    ):
        _login_register_fail(ip, email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    _login_fails.pop((ip, email), None)

    ip_address = _get_ip_address(request)
    now = datetime.utcnow()
    expires_at = now + timedelta(minutes=settings.refresh_token_expire_minutes)
    session = UserSession(
        user_id=user.id,
        refresh_token_hash="pending",
        ip_address=ip_address,
        country=_country_from_ip(ip_address),
        user_agent=request.headers.get("user-agent"),
        created_at=now,
        last_seen_at=now,
        expires_at=expires_at,
    )
    db.add(session)
    db.flush()

    refresh_token = create_refresh_token(user.email, session_id=session.id)
    session.refresh_token_hash = hash_token(refresh_token)
    db.add(session)
    db.commit()
    return TokenPair(
        access_token=create_access_token(user.email),
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=TokenPair)
def refresh_tokens(payload: RefreshRequest, request: Request, db: Session = Depends(get_db)):
    try:
        token_payload = decode_token_payload(payload.refresh_token, expected_type="refresh")
    except TokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    email = str(token_payload.get("sub"))
    session_id = token_payload.get("sid")
    if session_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is missing in token")

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive")

    session = db.query(UserSession).filter(UserSession.id == int(session_id), UserSession.user_id == user.id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found")
    if session.revoked_at is not None or session.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or revoked")
    if session.refresh_token_hash != hash_token(payload.refresh_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token")

    next_refresh = create_refresh_token(user.email, session_id=session.id)
    session.refresh_token_hash = hash_token(next_refresh)
    session.last_seen_at = datetime.utcnow()
    session.ip_address = _get_ip_address(request) or session.ip_address
    session.country = _country_from_ip(session.ip_address)
    session.user_agent = request.headers.get("user-agent") or session.user_agent
    session.expires_at = datetime.utcnow() + timedelta(minutes=settings.refresh_token_expire_minutes)
    db.add(session)
    db.commit()
    return TokenPair(
        access_token=create_access_token(user.email),
        refresh_token=next_refresh,
    )


@router.post("/impersonate/{user_id}", response_model=TokenPair)
def impersonate_user_session(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(require_main_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active user not found")

    ip_address = _get_ip_address(request)
    now = datetime.utcnow()
    expires_at = now + timedelta(minutes=settings.refresh_token_expire_minutes)
    session = UserSession(
        user_id=user.id,
        refresh_token_hash="pending",
        ip_address=ip_address,
        country=_country_from_ip(ip_address),
        user_agent=request.headers.get("user-agent"),
        created_at=now,
        last_seen_at=now,
        expires_at=expires_at,
    )
    db.add(session)
    db.flush()

    refresh_token = create_refresh_token(user.email, session_id=session.id)
    session.refresh_token_hash = hash_token(refresh_token)
    db.add(session)
    db.commit()
    return TokenPair(
        access_token=create_access_token(user.email),
        refresh_token=refresh_token,
    )


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)):
    return UserRead.model_validate(user, from_attributes=True).model_copy(
        update={"permissions": get_effective_permissions(user)}
    )


@router.get("/sessions", response_model=list[UserSessionRead])
def my_sessions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(UserSession)
        .filter(UserSession.user_id == user.id)
        .order_by(UserSession.created_at.desc())
        .all()
    )
    now = datetime.utcnow()
    return [
        UserSessionRead.model_validate(item, from_attributes=True).model_copy(
            update={"is_active": item.revoked_at is None and item.expires_at > now}
        )
        for item in sessions
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_my_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = db.query(UserSession).filter(UserSession.id == session_id, UserSession.user_id == user.id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session.revoked_at = datetime.utcnow()
    db.add(session)
    db.commit()


@router.post("/register-request", status_code=status.HTTP_201_CREATED)
def register_request(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()

    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    existing_request = (
        db.query(RegistrationRequest)
        .filter(
            RegistrationRequest.email == email,
            RegistrationRequest.status == RegistrationRequestStatus.PENDING,
        )
        .first()
    )
    if existing_request:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending request already exists")

    request_item = RegistrationRequest(
        email=email,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        company_type=payload.company_type,
        requested_role=payload.requested_role,
        status=RegistrationRequestStatus.PENDING,
    )
    db.add(request_item)
    db.flush()

    main_admin = db.query(User).filter(User.email == settings.main_admin_email).first()
    if main_admin is not None:
        db.add(
            Notification(
                user_id=main_admin.id,
                event_type="REGISTRATION_REQUEST",
                message=f"New registration request from {email}",
            )
        )

    db.commit()
    return {"message": "Registration request submitted"}


def _get_ip_address(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _country_from_ip(ip: str | None) -> str:
    if not ip:
        return "Unknown"
    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback:
            return "Local/Private"
        return "Unknown"
    except ValueError:
        return "Unknown"
