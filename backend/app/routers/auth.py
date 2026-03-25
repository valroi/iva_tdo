from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)
from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Notification, RegistrationRequest, RegistrationRequestStatus, User
from app.schemas import LoginRequest, RefreshRequest, RegisterRequest, TokenPair, UserRead

router = APIRouter()
settings = get_settings()


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if (
        user is None
        or not user.is_active
        or not verify_password(payload.password, user.hashed_password)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    return TokenPair(
        access_token=create_access_token(user.email),
        refresh_token=create_refresh_token(user.email),
    )


@router.post("/refresh", response_model=TokenPair)
def refresh_tokens(payload: RefreshRequest, db: Session = Depends(get_db)):
    try:
        email = decode_token(payload.refresh_token, expected_type="refresh")
    except TokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive")

    return TokenPair(
        access_token=create_access_token(user.email),
        refresh_token=create_refresh_token(user.email),
    )


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)):
    return user


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
