"""Вечерняя сводка уведомлений одним письмом вместо потока писем.

Зачем: LR, руководитель ТДО подрядчика и разработчики получали письмо на
КАЖДОЕ действие по документу — почта превращалась в спам, и важное тонуло.
Теперь мгновенно уходят только срочные события (см.
`notification_email.INSTANT_EVENT_TYPES`), остальные копятся и раз в сутки
уходят одним письмом, сгруппированным по документам.

Отметка об отправке — `Notification.email_sent_at`: письмо по одному
уведомлению уходит ровно один раз, повторный запуск дайджеста ничего не
дублирует. Прочитанные в интерфейсе уведомления в сводку не попадают —
человек их уже видел.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models import Notification, User
from app.services.vendor_email import send_email

logger = logging.getLogger("daily_digest")
settings = get_settings()

# Время отправки — 18:00 по Москве (бэкенд живёт в UTC).
MOSCOW_TZ = timezone(timedelta(hours=3))
SEND_HOUR_MSK = 18

_EVENT_TITLES = {
    "DOC_OVERDUE_PLAN_START": "Просрочка старта разработки",
    "REVISION_UPLOADED_FOR_TDO": "Ревизия ожидает проверки ТДО",
    "NEW_REVISION_FOR_TDO": "Новая ревизия для ТДО",
    "NEW_REVISION": "Новая ревизия",
    "CARRY_OVER_DECISION": "Решение по переносу замечания",
    "TDO_SENT_TO_OWNER": "Документ отправлен на рассмотрение",
    "TDO_CANCELLED_REVISION": "Ревизия отклонена ТДО",
    "OWNER_COMMENT_CREATED": "Новое замечание заказчика",
    "NEW_COMMENT": "Новый комментарий",
    "COMMENT_RESPONSE": "Ответ на замечание",
    "OWNER_COMMENT_PUBLISHED": "Замечание опубликовано",
    "R_NO_COMMENTS": "Рассмотрено без замечаний",
    "REVIEW_DEADLINE_SOON": "Скоро дедлайн рассмотрения",
    "MATRIX_GAP_BLOCKED": "Документ без назначенного LR",
    # Срочные типы уходят мгновенно, но старые записи могли остаться
    # неотправленными — пусть и они выглядят по-человечески.
    "OWNER_COMMENTS_PUBLISHED": "Замечания заказчика направлены",
    "REGISTRATION_REQUEST": "Заявка на регистрацию",
}


def _link_base() -> str | None:
    base = (settings.public_base_url or "").rstrip("/")
    if not base or "localhost" in base or "127.0.0.1" in base:
        return None
    return base


def _compose_body(user: User, rows: list[Notification]) -> str:
    """Сводка по документам: внутри документа — события по типам."""
    base = _link_base()
    by_document: dict[str, list[Notification]] = defaultdict(list)
    for row in rows:
        by_document[row.document_num or "Без привязки к документу"].append(row)

    lines = [
        f"Здравствуйте, {user.full_name or user.email}!",
        "",
        f"Сводка событий в IvaMaris TDO за сутки — всего {len(rows)} по {len(by_document)} документам.",
    ]
    for document_num in sorted(by_document):
        items = by_document[document_num]
        lines += ["", f"— {document_num} ({len(items)}):"]
        by_event: dict[str, list[Notification]] = defaultdict(list)
        for item in items:
            by_event[item.event_type].append(item)
        for event_type in sorted(by_event):
            group = by_event[event_type]
            title = _EVENT_TITLES.get(event_type, event_type)
            if len(group) == 1:
                lines.append(f"    • {title}: {group[0].message}")
            else:
                lines.append(f"    • {title} — {len(group)} шт.:")
                for item in group[:5]:
                    lines.append(f"        - {item.message}")
                if len(group) > 5:
                    lines.append(f"        - …и ещё {len(group) - 5}")
        revision_id = next((item.revision_id for item in items if item.revision_id), None)
        if base and revision_id:
            lines.append(f"      Открыть: {base}/#/revision_card/{revision_id}")
    if base:
        lines += ["", f"Все уведомления: {base}/#/notifications"]
    lines += ["", "Это автоматическая сводка. Отвечать на письмо не нужно."]
    return "\n".join(lines)


def send_digest(db: Session) -> int:
    """Отправляет сводки всем, у кого есть неотправленные уведомления.

    Возвращает количество отправленных писем.
    """
    pending = (
        db.query(Notification)
        .filter(Notification.email_sent_at.is_(None), Notification.is_read.is_(False))
        .order_by(Notification.user_id, Notification.document_num, Notification.id)
        .all()
    )
    if not pending:
        return 0

    by_user: dict[int, list[Notification]] = defaultdict(list)
    for row in pending:
        by_user[row.user_id].append(row)

    sent = 0
    now = datetime.utcnow()
    for user_id, rows in by_user.items():
        user = db.query(User).filter(User.id == user_id).first()
        if user is None or not user.is_active or not user.email:
            # Пометим отправленными, чтобы не перебирать их каждый вечер.
            for row in rows:
                row.email_sent_at = now
                db.add(row)
            continue
        subject = f"IvaMaris TDO — сводка за день ({len(rows)})"
        try:
            send_email(to=user.email, subject=subject, body=_compose_body(user, rows))
            sent += 1
        except Exception:  # noqa: BLE001 — почта не должна ронять фоновый поток
            logger.exception("Не удалось отправить сводку user_id=%s", user_id)
            continue
        for row in rows:
            row.email_sent_at = now
            db.add(row)
    db.commit()
    return sent


def run_digest_safe() -> None:
    db = SessionLocal()
    try:
        count = send_digest(db)
        if count:
            logger.info("Отправлено сводок: %s", count)
    except Exception:  # noqa: BLE001
        logger.exception("Ошибка отправки вечерней сводки")
    finally:
        db.close()


def _seconds_until_send_time() -> float:
    """Сколько спать до ближайших 18:00 МСК."""
    now_msk = datetime.now(MOSCOW_TZ)
    target = now_msk.replace(hour=SEND_HOUR_MSK, minute=0, second=0, microsecond=0)
    if target <= now_msk:
        target += timedelta(days=1)
    return (target - now_msk).total_seconds()


def _loop() -> None:
    while True:
        time.sleep(_seconds_until_send_time())
        run_digest_safe()


def start_daemon() -> None:
    thread = threading.Thread(target=_loop, daemon=True, name="daily-digest")
    thread.start()
    logger.info("Демон вечерней сводки запущен (18:00 МСК)")
