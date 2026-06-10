from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


class TokenError(Exception):
    pass


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def _create_token(subject: str, token_type: str, minutes: int, session_id: int | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    to_encode = {"sub": subject, "type": token_type, "exp": expire}
    if session_id is not None:
        to_encode["sid"] = session_id
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(subject: str) -> str:
    # Keep UX stable: access session should live at least 1 hour.
    return _create_token(subject, "access", max(60, settings.access_token_expire_minutes))


def create_refresh_token(subject: str, session_id: int | None = None) -> str:
    return _create_token(subject, "refresh", settings.refresh_token_expire_minutes, session_id=session_id)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# --- Модуль Vendors: гостевые сессии подрядчиков ---
# Тип токена "vendor" ИЗОЛИРОВАН от "access"/"refresh": обычный JWT
# пользователя не пройдёт vendor-проверку и наоборот. Внутри — id
# приглашения, а не пользователя.

def create_vendor_session_token(invitation_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.vendor_session_ttl_minutes)
    to_encode = {"sub": f"vendor:{invitation_id}", "type": "vendor", "inv": invitation_id, "exp": expire}
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_vendor_session_token(token: str) -> int:
    """Возвращает invitation_id из гостевого токена. Поднимает TokenError,
    если токен не vendor-типа, протух или повреждён."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as exc:
        raise TokenError("Invalid vendor token") from exc
    if payload.get("type") != "vendor":
        raise TokenError("Invalid token type")
    inv = payload.get("inv")
    if not isinstance(inv, int):
        raise TokenError("Invalid vendor token subject")
    return inv


def decode_token(token: str, expected_type: str) -> str:
    payload = decode_token_payload(token, expected_type=expected_type)
    return str(payload.get("sub"))


def decode_token_payload(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        token_type = payload.get("type")
        if token_type != expected_type:
            raise TokenError("Invalid token type")
        subject = payload.get("sub")
        if not subject:
            raise TokenError("Invalid token subject")
        return payload
    except JWTError as exc:
        raise TokenError("Invalid token") from exc
