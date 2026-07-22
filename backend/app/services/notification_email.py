"""Email-дублирование внутрисистемных уведомлений (Notification).

Подход: SQLAlchemy-хук на Session, а не правка ~16 мест, где создаются
Notification по всему documents.py — новые точки создания уведомлений
автоматически попадают под рассылку без единой правки кода вызова.

Поток:
  after_flush   — на каждый flush собираем новые Notification (у них уже
                  есть PK) в session.info, ДО commit — если транзакция
                  откатится, письма просто не попадут в after_commit.
  after_commit  — транзакция гарантированно зафиксирована; ставим отправку
                  каждого письма в отдельный поток (ThreadPoolExecutor),
                  чтобы HTTP-ответ не ждал SMTP (который может идти секундами,
                  а уведомления иногда создаются пачкой — вся матрица
                  ревьюеров разом).

Отправка — best-effort: ошибка SMTP/сети пишется в лог и не всплывает
наружу (уведомление в системе уже создано и видно в UI независимо от почты).
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import event
from sqlalchemy.orm import Session as OrmSession

from app.config import get_settings
from app.database import SessionLocal
from app.models import Notification, User
from app.services.vendor_email import send_email

logger = logging.getLogger("notification_email")
settings = get_settings()

_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="notif-email")

_SESSION_INFO_KEY = "_pending_notification_emails"

# Человекочитаемые заголовки писем по типу события — иначе тема была бы
# голым кодом статуса ("OWNER_COMMENTS_PUBLISHED"), непонятным в почте.
_SUBJECT_BY_EVENT = {
    "DOC_OVERDUE_PLAN_START": "Просрочка старта разработки документа",
    "REVISION_UPLOADED_FOR_TDO": "Новая ревизия ожидает проверки ТДО",
    "OWNER_COMMENTS_PUBLISHED": "Замечания заказчика направлены",
    "CARRY_OVER_DECISION": "Решение по замечанию (carry-over)",
    "TDO_SENT_TO_OWNER": "Документ отправлен на рассмотрение заказчику",
    "TDO_CANCELLED_REVISION": "Ревизия отклонена ТДО",
    "OWNER_COMMENT_CREATED": "Новое замечание заказчика",
    "NEW_COMMENT": "Новый комментарий",
    "COMMENT_RESPONSE": "Ответ на замечание",
    "OWNER_COMMENT_PUBLISHED": "Замечание опубликовано",
    "REGISTRATION_REQUEST": "Новая заявка на регистрацию",
    "R_NO_COMMENTS": "Ревьювер рассмотрел без замечаний",
    "REVIEW_DEADLINE_SOON": "Скоро дедлайн рассмотрения",
}


def _build_link(item: dict) -> str | None:
    base = (settings.public_base_url or "").rstrip("/")
    if not base or "localhost" in base or "127.0.0.1" in base:
        return None  # локальный адрес бесполезен в письме внешнему получателю
    if item.get("revision_id"):
        return f"{base}/#/revision_card/{item['revision_id']}"
    return f"{base}/#/notifications"


def _deliver(item: dict) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == item["user_id"]).first()
        if user is None or not user.is_active or not user.email:
            return
        subject = _SUBJECT_BY_EVENT.get(item["event_type"], "Новое уведомление в IvaMaris TDO")
        link = _build_link(item)
        body_parts = [f"Здравствуйте, {user.full_name}!", "", item["message"]]
        if link:
            body_parts += ["", f"Открыть в системе: {link}"]
        body_parts += ["", "Это автоматическое уведомление. Отвечать на письмо не нужно."]
        send_email(to=user.email, subject=subject, body="\n".join(body_parts))
    except Exception:  # noqa: BLE001 — почта не должна ронять фоновый поток
        logger.exception("Не удалось отправить email-уведомление user_id=%s", item.get("user_id"))
    finally:
        db.close()


def _login_url() -> str:
    base = (settings.public_base_url or "").rstrip("/")
    return base or "http://localhost:3000"


def _deliver_welcome(*, to_email: str, full_name: str, password: str) -> None:
    try:
        subject = "Доступ к IvaMaris TDO"
        body = "\n".join([
            f"Здравствуйте, {full_name}!",
            "",
            "Для вас создана учётная запись в системе технического документооборота IvaMaris TDO.",
            "",
            f"Ссылка для входа: {_login_url()}",
            f"Логин (email): {to_email}",
            f"Временный пароль: {password}",
            "",
            "После первого входа рекомендуем сменить пароль (Профиль → сменить пароль).",
            "",
            "Это автоматическое письмо. Отвечать на него не нужно.",
        ])
        send_email(to=to_email, subject=subject, body=body)
    except Exception:  # noqa: BLE001 — email не должен ронять создание пользователя
        logger.exception("Не удалось отправить приветственное письмо на %s", to_email)


def send_welcome_email(*, to_email: str, full_name: str, password: str) -> None:
    """Приветственное письмо новому пользователю: ссылка на систему, логин,
    временный пароль, просьба сменить. Не блокирует запрос — реальная
    отправка идёт в фоновом потоке (тот же пул, что и для уведомлений)."""
    _executor.submit(_deliver_welcome, to_email=to_email, full_name=full_name, password=password)


@event.listens_for(OrmSession, "after_flush")
def _collect_new_notifications(session: OrmSession, _flush_context) -> None:
    pending = [
        {
            "user_id": obj.user_id,
            "event_type": obj.event_type,
            "message": obj.message,
            "revision_id": obj.revision_id,
        }
        for obj in session.new
        if isinstance(obj, Notification)
    ]
    if pending:
        session.info.setdefault(_SESSION_INFO_KEY, []).extend(pending)


@event.listens_for(OrmSession, "after_commit")
def _dispatch_notification_emails(session: OrmSession) -> None:
    pending = session.info.pop(_SESSION_INFO_KEY, None)
    if not pending:
        return
    for item in pending:
        _executor.submit(_deliver, item)
