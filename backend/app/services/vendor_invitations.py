"""Жизненный цикл приглашений подрядчиков (VendorInvitation).

Безопасность:
  * Сам токен генерируется из secrets.token_urlsafe(32) — 256 бит энтропии.
    В БД хранится ТОЛЬКО хэш (pbkdf2_sha256). Plain-токен возвращается
    вызывающему один раз при создании.
  * Email-код подтверждения (6 цифр) тоже хранится хэшем, со сроком жизни.
  * Защита от перебора: счётчик failed_attempts + temporary lockout.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from passlib.context import CryptContext

from app.config import get_settings
from app.models import VendorInvitation

settings = get_settings()
_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


def generate_invitation_token() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(value: str) -> str:
    return _pwd.hash(value)


def verify_secret(value: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return _pwd.verify(value, hashed)
    except Exception:  # noqa: BLE001 — повреждённый хэш не должен ронять запрос
        return False


def resolve_public_base(origin: str | None = None) -> str:
    """Базовый URL для ссылок подрядчику.

    Если PUBLIC_BASE_URL задан явно (не localhost) — он главный (прод).
    Иначе берём Origin админского запроса (тот адрес/IP в локальной сети,
    с которого реально открыт сайт), чтобы ссылка не уходила на localhost.
    """
    configured = settings.public_base_url.rstrip("/")
    is_local = ("localhost" in configured) or ("127.0.0.1" in configured)
    if configured and not is_local:
        return configured
    if origin:
        from urllib.parse import urlparse

        parsed = urlparse(origin)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"  # только схема+хост:порт
    return configured


def build_invitation_link(invitation_id: int, token: str, origin: str | None = None) -> str:
    base = resolve_public_base(origin)
    return f"{base}/#/vendor/{invitation_id}?t={token}"


def generate_email_code() -> str:
    # 6-значный код, ведущие нули допустимы.
    return f"{secrets.randbelow(1_000_000):06d}"


def is_locked(inv: VendorInvitation) -> bool:
    return inv.locked_until is not None and datetime.utcnow() < inv.locked_until


def register_failed_attempt(inv: VendorInvitation) -> None:
    inv.failed_attempts = (inv.failed_attempts or 0) + 1
    if inv.failed_attempts >= MAX_FAILED_ATTEMPTS:
        inv.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
        inv.failed_attempts = 0


def reset_attempts(inv: VendorInvitation) -> None:
    inv.failed_attempts = 0
    inv.locked_until = None


def is_active(inv: VendorInvitation) -> bool:
    """Приглашение действительно: не отозвано и не истекло."""
    if inv.revoked_at is not None:
        return False
    if inv.expires_at is not None and datetime.utcnow() > inv.expires_at:
        return False
    return True


def set_email_code(inv: VendorInvitation, code: str) -> None:
    inv.email_code_hash = hash_secret(code)
    inv.email_code_expires_at = datetime.utcnow() + timedelta(
        minutes=settings.vendor_email_code_ttl_minutes
    )


def email_code_valid(inv: VendorInvitation, code: str) -> bool:
    if inv.email_code_expires_at is None or datetime.utcnow() > inv.email_code_expires_at:
        return False
    return verify_secret(code, inv.email_code_hash)
