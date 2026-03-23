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
    ]

    first_admin_email: str = "admin@ivamaris.io"
    first_admin_password: str = "admin123"
    first_admin_full_name: str = "System Administrator"


@lru_cache
def get_settings() -> Settings:
    return Settings()
