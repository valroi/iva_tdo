"""Нумерация замечаний: {ПРОЕКТ}-RMK-000123.

Номер присваивается при создании замечания и больше не меняется — по нему
находится вся история (ревизия, лист, CRS, ответ подрядчика, решение LR,
carry-over). Этот модуль отвечает за разовую простановку номеров тем
замечаниям, которые появились до внедрения нумерации.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy.orm import Session

from app.models import Comment, Document, MDRRecord, Revision

logger = logging.getLogger(__name__)

_PATTERN = re.compile(r"^(?P<prefix>.+-RMK-)(?P<seq>\d{6})$")


def backfill_remark_numbers(db: Session) -> int:
    """Проставить номера родительским замечаниям без remark_number.

    Идемпотентно: уже пронумерованные не трогаются, нумерация продолжается с
    максимального существующего номера по каждому проекту. Порядок — по времени
    создания, чтобы номера шли «как в жизни». Возвращает число проставленных.
    """
    pending = (
        db.query(Comment, MDRRecord.project_code)
        .join(Revision, Revision.id == Comment.revision_id)
        .join(Document, Document.id == Revision.document_id)
        .join(MDRRecord, MDRRecord.id == Document.mdr_id)
        .filter(Comment.parent_id.is_(None), Comment.remark_number.is_(None))
        .order_by(Comment.created_at.asc(), Comment.id.asc())
        .all()
    )
    if not pending:
        return 0

    # Текущие максимумы по проектам — чтобы не пересечься с уже выданными.
    max_by_project: dict[str, int] = {}
    for (value,) in db.query(Comment.remark_number).filter(Comment.remark_number.isnot(None)).all():
        match = _PATTERN.match(value or "")
        if not match:
            continue
        prefix = match.group("prefix")
        max_by_project[prefix] = max(max_by_project.get(prefix, 0), int(match.group("seq")))

    assigned = 0
    for comment, project_code in pending:
        prefix = f"{(project_code or 'NA').upper()}-RMK-"
        seq = max_by_project.get(prefix, 0) + 1
        max_by_project[prefix] = seq
        comment.remark_number = f"{prefix}{seq:06d}"
        db.add(comment)
        assigned += 1

    db.commit()
    logger.info("remark numbers backfilled: %s", assigned)
    return assigned
