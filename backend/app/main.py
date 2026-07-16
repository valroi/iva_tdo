from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import SessionLocal, init_db
from app.routers import api_router
from app.seed import seed_default_data
from app.services import notification_email  # noqa: F401 — регистрирует SQLAlchemy-хук email-рассылки уведомлений

settings = get_settings()

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.middleware("http")
async def security_headers(request, call_next):
    """Базовые security-заголовки для интернет-экспозиции.
    HSTS/CSP добавляет reverse-proxy (Caddy) — тут только независимые от TLS."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


def _check_production_secrets() -> None:
    """APP_ENV=production: отказ старта с дефолтными секретами.
    Дефолтный SECRET_KEY = подделка любых JWT, дефолтный пароль админа =
    полный захват системы. На публичном сервере это фатально."""
    if settings.app_env.lower() != "production":
        return
    problems = []
    if settings.secret_key == "change-me-in-production":
        problems.append("SECRET_KEY имеет дефолтное значение")
    if settings.first_admin_password in ("admin123", "change-this-admin-password"):
        problems.append("FIRST_ADMIN_PASSWORD имеет дефолтное значение")
    if settings.seed_demo_users:
        problems.append("SEED_DEMO_USERS=true (демо-пользователи с известными паролями)")
    if problems:
        raise RuntimeError(
            "APP_ENV=production, но обнаружены небезопасные настройки: "
            + "; ".join(problems)
            + ". Задайте значения в .env и перезапустите."
        )


@app.on_event("startup")
def on_startup() -> None:
    _check_production_secrets()
    init_db()
    with SessionLocal() as db:
        seed_default_data(db)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
