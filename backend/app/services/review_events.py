"""Журнал действий рассмотрения (review_events) и состояние ревьюеров.

Пишем события в существующих точках workflow, не меняя их логику. Одна
таблица питает три фичи: таймлайн истории на карточке ревизии, отчёт по
действиям R/LR/разработчиков и напоминания о дедлайнах.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models import (
    Document,
    MDRRecord,
    ReviewEvent,
    Revision,
    RevisionReviewerState,
    SystemSetting,
    User,
)

# Настройка: закрывает ли NC (нет замечаний) дальнейшее комментирование R.
# По умолчанию закрывает; снять может только админ глобально.
NC_LOCKS_COMMENTING_KEY = "review_nc_locks_commenting"


def nc_locks_commenting(db: Session) -> bool:
    row = db.query(SystemSetting).filter(SystemSetting.key == NC_LOCKS_COMMENTING_KEY).first()
    if row is None:
        return True  # безопасный дефолт: NC закрывает комментирование
    return str(row.value).strip().lower() in ("1", "true", "yes", "on")


def record_event(
    db: Session,
    *,
    revision: Revision,
    document: Document,
    mdr: MDRRecord,
    actor: Optional[User],
    actor_role: str,
    event_type: str,
    target_user_id: Optional[int] = None,
    deadline: Optional[date] = None,
    note: Optional[str] = None,
) -> ReviewEvent:
    """Добавить событие в журнал. Не коммитит — коммит на стороне вызова."""
    event = ReviewEvent(
        revision_id=revision.id,
        project_code=mdr.project_code,
        document_num=document.document_num,
        discipline_code=mdr.discipline_code,
        revision_code=revision.revision_code,
        actor_id=actor.id if actor is not None else None,
        actor_role=actor_role,
        event_type=event_type,
        target_user_id=target_user_id,
        deadline=deadline,
        note=note,
    )
    db.add(event)
    return event


def get_or_create_reviewer_state(db: Session, *, revision_id: int, user_id: int) -> RevisionReviewerState:
    state = (
        db.query(RevisionReviewerState)
        .filter(
            RevisionReviewerState.revision_id == revision_id,
            RevisionReviewerState.user_id == user_id,
        )
        .first()
    )
    if state is None:
        state = RevisionReviewerState(revision_id=revision_id, user_id=user_id)
        db.add(state)
        db.flush()
    return state


def reviewer_commenting_locked(db: Session, *, revision_id: int, user_id: int) -> bool:
    """R закрыт для комментирования, если он поставил NC и настройка активна."""
    if not nc_locks_commenting(db):
        return False
    state = (
        db.query(RevisionReviewerState)
        .filter(
            RevisionReviewerState.revision_id == revision_id,
            RevisionReviewerState.user_id == user_id,
        )
        .first()
    )
    return bool(state and state.no_comments)
