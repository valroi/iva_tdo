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
    # Отключить проверку SSL-сертификата SMTP (self-signed корп. сертификат).
    smtp_insecure: bool = False
    # Имя, которым backend представляется серверу в EHLO/HELO. По умолчанию
    # Python подставляет внутренний docker-IP (172.x), который корп. Exchange
    # отвергает. Указать hostname или IP хостовой машины (напр. 192.168.11.237).
    # Пусто — fallback на host из public_base_url (если не localhost).
    smtp_helo: str = ""
    # Базовый URL фронта для ссылок-приглашений в письмах.
    public_base_url: str = "http://localhost:3000"
    # --- Хранилища DCC (документы/ревизии). Должны быть на persistent volume,
    # иначе PDF теряются при пересборке контейнера. Настраиваются через env,
    # чтобы сисадмин мог указать host bind-mount. Дефолт совместим со старыми
    # путями в БД (не осиротить уже загруженные файлы). ---
    tdo_uploads_root: str = "/tmp/tdo_uploads"
    smart_upload_root: str = "/tmp/tdo_smart_upload"
    # Корень хранилища документов подрядчиков (отдельный volume).
    vendor_uploads_root: str = "/data/vendor_uploads"
    # Время жизни email-кода подтверждения, минут.
    vendor_email_code_ttl_minutes: int = 15
    # Время жизни гостевой сессии подрядчика, минут.
    vendor_session_ttl_minutes: int = 60 * 8
    # Макс. число подрядчиков на один MR (бизнес-ограничение).
    vendor_max_invitations_per_mr: int = 5

    # --- Модуль FEED (документация стадии FEED) ---
    # Корень хранилища файлов FEED (отдельный volume — переживает апдейты).
    feed_storage_root: str = "/data/feed_storage"
    # AI-поиск по документации: OpenAI-совместимый API (Qwen/DashScope,
    # OpenRouter, локальный vLLM и т.п.). Если ключ пуст — работает обычный
    # полнотекстовый поиск без нейросети.
    ai_api_base_url: str = ""
    ai_api_key: str = ""
    ai_model: str = "qwen-plus"

    # --- FEED RAG-агент (LangGraph + Qdrant + локальные эмбеддинги) ---
    qdrant_url: str = "http://qdrant:6333"
    rag_embed_model: str = "BAAI/bge-m3"          # мультиязычный, 1024-dim
    rag_rerank: bool = True                        # bge-reranker-v2-m3
    rag_collection: str = "feed_docs"
    rag_top_k: int = 20                            # кандидатов из Qdrant
    rag_top_n: int = 6                             # после реранка → в контекст
    rag_chunk_chars: int = 1800                    # ~800 токенов
    rag_chunk_overlap: int = 250
    # Модель-«мозг» агента на OpenRouter (reuse ai_api_base_url/ai_api_key).
    agent_model: str = "qwen/qwen-2.5-72b-instruct:free"


@lru_cache
def get_settings() -> Settings:
    return Settings()
