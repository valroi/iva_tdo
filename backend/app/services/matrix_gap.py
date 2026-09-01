"""Контроль заполненности матрицы назначений перед созданием документа.

Документ без назначенного LR по своему разделу физически некому рассматривать:
ревизия уйдёт «в никуда», а рассылка свалится в fallback «всем заказчикам».
Поэтому создание такого документа блокируется, а администратору (и адресатам
из системной настройки) уходит уведомление с письмом — чтобы завести строку
в матрице и только после этого создавать документ.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from sqlalchemy import func, or_

from app.models import Notification, Project, ReviewMatrixMember, SystemSetting, User, UserRole

logger = logging.getLogger("matrix_gap")

NOTIFY_SETTING_KEY = "matrix_gap_notify_emails"
DEFAULT_NOTIFY_EMAILS = "rakov.vd@ivamaris.group"
EVENT_TYPE = "MATRIX_GAP_BLOCKED"


def matrix_discipline(*, category: str | None, discipline_code: str | None) -> str | None:
    """Раздел документа в терминах матрицы (проверка идёт до создания записи,
    поэтому без обращения к БД). Категория передаётся отдельно."""
    return (discipline_code or "").strip() or None


def has_lead_reviewer(
    db: Session,
    *,
    project_id: int,
    discipline: str | None,
    category: str | None = None,
) -> bool:
    """Есть ли LR (level=1) по паре «категория + раздел».

    Правила совпадают с _matrix_match_clause в routers/documents.py — менять
    синхронно: строка без категории покрывает любую, а раздел «SE» в категории
    SE покрывает все виды отчётов изысканий.
    """
    if not discipline:
        return False
    section = discipline.strip().upper()
    cat = (category or "").strip().upper()
    disciplines = [section]
    if cat == "SE":
        disciplines.append("SE")
    return (
        db.query(ReviewMatrixMember.id)
        .filter(
            ReviewMatrixMember.project_id == project_id,
            or_(
                ReviewMatrixMember.category.is_(None),
                func.upper(ReviewMatrixMember.category) == cat,
            ),
            func.upper(ReviewMatrixMember.discipline_code).in_(disciplines),
            ReviewMatrixMember.level == 1,
            ReviewMatrixMember.state == "LR",
        )
        .first()
        is not None
    )


def _notify_emails(db: Session) -> list[str]:
    item = db.query(SystemSetting).filter(SystemSetting.key == NOTIFY_SETTING_KEY).first()
    raw = item.value if item is not None else DEFAULT_NOTIFY_EMAILS
    return [part.strip().lower() for part in str(raw or "").replace(";", ",").split(",") if part.strip()]


def gap_recipient_ids(db: Session) -> set[int]:
    """Админы системы + адресаты из настройки. Используется и для уведомлений
    о блокировке, и как fallback рассылки, когда по разделу нет назначений."""
    recipients: set[int] = {
        row[0] for row in db.query(User.id).filter(User.role == UserRole.admin, User.is_active.is_(True)).all()
    }
    emails = _notify_emails(db)
    if emails:
        # У получателя из настройки может не быть роли admin (например
        # рук. проекта заказчика) — достаточно активной учётной записи.
        recipients |= {
            row[0]
            for row in db.query(User.id)
            .filter(User.is_active.is_(True), func.lower(User.email).in_(emails))
            .all()
        }
    return recipients


def notify_gap(
    db: Session,
    *,
    project: Project,
    requester: User,
    doc_number: str,
    discipline: str | None,
    category: str | None,
) -> None:
    """Уведомление админам и адресатам из настройки. Письма уходят сами —
    на новые Notification навешен хук рассылки (services/notification_email).

    Идемпотентно: пока предыдущее уведомление по той же паре
    «проект + раздел» не прочитано, новых не плодим — иначе подрядчик,
    жмущий «Создать» несколько раз, засыпает почту.
    """
    recipient_ids = gap_recipient_ids(db)

    message = (
        f"Подрядчик {requester.full_name or requester.email} пытался создать документ {doc_number} "
        f"(проект {project.code}, категория {category or '—'}, раздел {discipline or '—'}), "
        f"но в матрице назначений нет LR по этому разделу. Документ не создан. "
        f"Назначьте LR (и R) в матрице проекта, затем сообщите подрядчику."
    )
    for user_id in recipient_ids:
        duplicate = (
            db.query(Notification.id)
            .filter(
                Notification.user_id == user_id,
                Notification.event_type == EVENT_TYPE,
                Notification.project_code == project.code,
                Notification.is_read.is_(False),
                Notification.message.like(f"%раздел {discipline or '—'},%"),
            )
            .first()
        )
        if duplicate is not None:
            continue
        db.add(
            Notification(
                user_id=user_id,
                event_type=EVENT_TYPE,
                message=message,
                project_code=project.code,
                document_num=doc_number,
            )
        )
    if not recipient_ids:
        logger.warning("Некому сообщить о пробеле в матрице: нет админов и адресатов в %s", NOTIFY_SETTING_KEY)
    db.commit()


def gap_detail(*, discipline: str | None, category: str | None = None) -> str:
    where = f"«{category}» / «{discipline or '—'}»" if category else f"«{discipline or '—'}»"
    return (
        f"По разделу {where} в матрице назначений нет лидера-ревьювера (LR) от заказчика. "
        f"Документ создать нельзя — его некому рассматривать. "
        f"Мы уже сообщили администратору системы заказчика; свяжитесь с ним, "
        f"чтобы назначить LR и R, после этого создайте документ повторно."
    )
