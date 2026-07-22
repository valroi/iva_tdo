"""Напоминания о приближающемся дедлайне рассмотрения (R/LR).

Когда до дедлайна ревизии остаётся ≤1 дня и задача ещё открыта, шлём
ревьюеру уведомление в системе (оно же уходит на e-mail через SQLAlchemy-хук
notification_email). Идемпотентно: повторно по той же (ревизия, ревьювер,
дедлайн) не шлём — защита через запись DEADLINE_REMINDER в review_events.

Запускается фоновым демоном раз в сутки (backend — одиночный процесс, дублей
нет) и разово при старте. Дополнительно вызывается лениво при загрузке
очереди рассмотрения — на случай, если процесс перезапускался.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    Comment,
    Document,
    MDRRecord,
    Notification,
    ReviewEvent,
    ReviewMatrixMember,
    Revision,
    RevisionReviewerState,
)

logger = logging.getLogger("deadline_reminders")

# На владельческой стороне ревизия ещё «живая» для рассмотрения.
_OPEN_OWNER_STATUSES = {"UNDER_REVIEW", "OWNER_COMMENTS_SENT", "CONTRACTOR_REPLY_I"}
_REMIND_WITHIN_DAYS = 1  # напоминаем, когда осталось 0..1 день


def _matrix_discipline(mdr: MDRRecord) -> str | None:
    if (mdr.category or "").upper() == "SE":
        return "SE"
    return mdr.discipline_code


def scan_and_notify(db: Session) -> int:
    """Создаёт напоминания по всем подходящим (ревизия, ревьювер). Возвращает
    число созданных уведомлений."""
    today = date.today()
    revisions = (
        db.query(Revision)
        .filter(
            Revision.review_deadline.isnot(None),
            Revision.status.in_(list(_OPEN_OWNER_STATUSES)),
        )
        .all()
    )
    created = 0
    for revision in revisions:
        if revision.review_code is not None and getattr(revision.review_code, "value", revision.review_code) == "AP":
            continue
        days_left = (revision.review_deadline - today).days
        if days_left < 0 or days_left > _REMIND_WITHIN_DAYS:
            continue

        document = db.query(Document).filter(Document.id == revision.document_id).first()
        if document is None:
            continue
        mdr = db.query(MDRRecord).filter(MDRRecord.id == document.mdr_id).first()
        if mdr is None:
            continue
        project_id = None
        from app.models import Project

        project = db.query(Project).filter(Project.code == mdr.project_code).first()
        if project is None:
            continue
        project_id = project.id
        discipline = _matrix_discipline(mdr)

        members = (
            db.query(ReviewMatrixMember)
            .filter(
                ReviewMatrixMember.project_id == project_id,
                ReviewMatrixMember.discipline_code == discipline,
                ReviewMatrixMember.level == 1,
                ReviewMatrixMember.state.in_(["LR", "R"]),
            )
            .all()
        )
        for member in members:
            # Задача закрыта этим ревьюером? (нет замечаний / оставил замечание)
            state = (
                db.query(RevisionReviewerState)
                .filter(
                    RevisionReviewerState.revision_id == revision.id,
                    RevisionReviewerState.user_id == member.user_id,
                )
                .first()
            )
            if state and state.no_comments:
                continue
            has_comment = (
                db.query(Comment.id)
                .filter(Comment.revision_id == revision.id, Comment.author_id == member.user_id)
                .first()
                is not None
            )
            if has_comment:
                continue
            # Уже напоминали по этому дедлайну?
            already = (
                db.query(ReviewEvent.id)
                .filter(
                    ReviewEvent.revision_id == revision.id,
                    ReviewEvent.event_type == "DEADLINE_REMINDER",
                    ReviewEvent.target_user_id == member.user_id,
                    ReviewEvent.deadline == revision.review_deadline,
                )
                .first()
            )
            if already is not None:
                continue

            when = "сегодня" if days_left == 0 else "завтра"
            db.add(
                Notification(
                    user_id=member.user_id,
                    event_type="REVIEW_DEADLINE_SOON",
                    message=(
                        f"Дедлайн рассмотрения {when} ({revision.review_deadline:%d.%m.%Y}). "
                        f"Задача ещё открыта: {document.document_num}, ревизия {revision.revision_code}. "
                        f"Закройте — рассмотрите или оставьте замечание."
                    ),
                    project_code=mdr.project_code,
                    document_num=document.document_num,
                    revision_id=revision.id,
                )
            )
            db.add(
                ReviewEvent(
                    revision_id=revision.id,
                    project_code=mdr.project_code,
                    document_num=document.document_num,
                    discipline_code=mdr.discipline_code,
                    revision_code=revision.revision_code,
                    actor_id=None,
                    actor_role="SYSTEM",
                    event_type="DEADLINE_REMINDER",
                    target_user_id=member.user_id,
                    deadline=revision.review_deadline,
                    note=f"Напоминание: осталось {days_left} дн.",
                )
            )
            created += 1

    if created:
        db.commit()
    return created


def run_scan_safe() -> None:
    db = SessionLocal()
    try:
        count = scan_and_notify(db)
        if count:
            logger.info("Создано напоминаний о дедлайне: %s", count)
    except Exception:  # noqa: BLE001 — фоновая задача не должна ронять процесс
        logger.exception("Ошибка скана напоминаний о дедлайнах")
    finally:
        db.close()


def _loop(interval_seconds: int) -> None:
    # Первый прогон при старте, затем раз в сутки.
    while True:
        run_scan_safe()
        time.sleep(interval_seconds)


def start_daemon(interval_seconds: int = 24 * 60 * 60) -> None:
    thread = threading.Thread(target=_loop, args=(interval_seconds,), daemon=True, name="deadline-reminders")
    thread.start()
    logger.info("Демон напоминаний о дедлайнах запущен (интервал %s c)", interval_seconds)
