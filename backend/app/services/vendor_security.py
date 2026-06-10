"""Авторизация и инварианты модуля Vendors (VQM).

Ключевые правила безопасности собраны здесь в одном месте, чтобы каждый
endpoint вызывал их явно, а не дублировал логику:

  * _can_manage_mr        — кто может создавать/править MR и приглашения
  * ensure_mr_open        — write-операции запрещены после дедлайна/закрытия
  * ensure_can_manage_mr  — поднимает 403, если нет прав

MR — самостоятельная сущность, поэтому права НЕ наследуются от проекта
автоматически. Управлять может: admin, назначенный lr_user_id MR, её
создатель, либо LR-матрица проекта (уровень 1).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import (
    MaterialRequisition,
    MrStatus,
    ReviewMatrixMember,
    User,
    UserRole,
)


def _is_project_lr(db: Session, *, user: User, project_id: int) -> bool:
    """Есть ли у пользователя роль LR (level=1) в матрице ревью проекта."""
    match = (
        db.query(ReviewMatrixMember.id)
        .filter(
            ReviewMatrixMember.project_id == project_id,
            ReviewMatrixMember.user_id == user.id,
            ReviewMatrixMember.level == 1,
        )
        .first()
    )
    return match is not None


def can_manage_mr(db: Session, *, user: User, mr: MaterialRequisition) -> bool:
    """Может ли пользователь управлять данной MR (CRUD, теги, документы,
    приглашения, ответы на вопросы, публикация Q&A)."""
    if user.role == UserRole.admin:
        return True
    if mr.lr_user_id is not None and mr.lr_user_id == user.id:
        return True
    if mr.created_by_id == user.id:
        return True
    if _is_project_lr(db, user=user, project_id=mr.project_id):
        return True
    return False


def ensure_can_manage_mr(db: Session, *, user: User, mr: MaterialRequisition) -> None:
    if not can_manage_mr(db, user=user, mr=mr):
        # 404 (не 403) когда сущность вообще не должна быть видна пользователю:
        # здесь права на управление — отдаём явный 403, объект существует.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No permission to manage this MR",
        )


def ensure_mr_open(mr: MaterialRequisition) -> None:
    """Любая write-операция (цена, загрузка, вопрос подрядчика) запрещена,
    если MR не в статусе OPEN или дедлайн прошёл. Security boundary —
    проверяется и для guest, и для внутренних правок состава после старта."""
    if mr.status != MrStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="MR is not open for submissions",
        )
    if mr.deadline_at is not None and datetime.utcnow() > mr.deadline_at:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="MR deadline has passed — submissions are closed",
        )
