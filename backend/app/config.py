from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "IvaMaris TDO"
    api_v1_prefix: str = "/api/v1"

    secret_key: str = Field(default="change-me-in-production")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_minutes: int = 60 * 24 * 7

    database_url: str = "postgresql+psycopg://user:pass@db:5432/tdms"

    cors_origins: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]

    first_admin_email: str = "admin@ivamaris.io"
    first_admin_password: str = "admin123"
    first_admin_full_name: str = "System Administrator"
    main_admin_email: str = "admin@ivamaris.io"
    seed_demo_users: bool = False

    # --- Модуль Vendors (VQM) ---
    # SMTP для email-кодов подтверждения подрядчиков. Если smtp_host пуст —
    # сервис писем работает в режиме лог-заглушки (код пишется в backend-лог).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@ivamaris.io"
    smtp_use_tls: bool = True
    # Базовый URL фронта для ссылок-приглашений в письмах.
    public_base_url: str = "http://localhost:3000"
    # Корень хранилища документов подрядчиков (отдельный volume).
    vendor_uploads_root: str = "/data/vendor_uploads"
    # Время жизни email-кода подтверждения, минут.
    vendor_email_code_ttl_minutes: int = 15
    # Время жизни гостевой сессии подрядчика, минут.
    vendor_session_ttl_minutes: int = 60 * 8
    # Макс. число подрядчиков на один MR (бизнес-ограничение).
    vendor_max_invitations_per_mr: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
