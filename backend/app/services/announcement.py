"""Объявление для всех пользователей с обратным отсчётом (баннер в шапке).

Хранится в system_settings тремя ключами — значение там ограничено 255
символами, поэтому текст, дедлайн и флаг лежат раздельно. Дедлайн — naive
UTC, как всё время в проекте; фронт показывает его по Москве.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import SystemSetting

KEY_ENABLED = "announcement_enabled"
KEY_DEADLINE = "announcement_deadline"
KEY_TEXT = "announcement_text"
TEXT_MAX = 255


def _get(db: Session, key: str) -> str | None:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    return row.value if row is not None else None


def _set(db: Session, key: str, value: str) -> None:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row is None:
        row = SystemSetting(key=key, value=value)
    else:
        row.value = value
    db.add(row)


def read(db: Session) -> dict:
    raw_deadline = _get(db, KEY_DEADLINE)
    deadline = None
    if raw_deadline:
        try:
            deadline = datetime.fromisoformat(raw_deadline)
        except ValueError:
            deadline = None
    return {
        "enabled": (_get(db, KEY_ENABLED) or "").strip().lower() in ("1", "true", "yes", "on"),
        "deadline": deadline,
        "text": _get(db, KEY_TEXT) or "",
    }


def write(db: Session, *, enabled: bool, deadline: datetime | None, text: str) -> dict:
    # В базе — naive UTC: если фронт прислал время с таймзоной, переводим в UTC.
    if deadline is not None and deadline.tzinfo is not None:
        deadline = (deadline - deadline.utcoffset()).replace(tzinfo=None)
    _set(db, KEY_ENABLED, "true" if enabled else "false")
    _set(db, KEY_DEADLINE, deadline.isoformat() if deadline is not None else "")
    _set(db, KEY_TEXT, (text or "").strip()[:TEXT_MAX])
    db.commit()
    return read(db)
