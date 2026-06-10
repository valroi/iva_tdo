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

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import TokenError, decode_vendor_session_token
from app.database import get_db
from app.models import (
    MaterialRequisition,
    MrStatus,
    ReviewMatrixMember,
    User,
    UserRole,
    VendorAuditLog,
    VendorInvitation,
)
from app.services import vendor_invitations


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


# =====================================================================
#  Гостевой контекст подрядчика — ПОЛНОСТЬЮ отдельный от пользовательского
#  JWT. require_vendor_session() декодирует ТОЛЬКО vendor-токены и не
#  пускает обычных пользователей. Это разделение на уровне dependency.
# =====================================================================


def require_vendor_session(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> VendorInvitation:
    """Достаёт активное приглашение из vendor-токена (заголовок
    Authorization: Bearer <vendor_token>). 404 на любую проблему —
    не подтверждаем существование объектов внешнему наблюдателю."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Vendor session required")
    token = authorization.split(" ", 1)[1].strip()
    try:
        invitation_id = decode_vendor_session_token(token)
    except TokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid vendor session")
    inv = db.query(VendorInvitation).filter(VendorInvitation.id == invitation_id).first()
    if inv is None or not vendor_invitations.is_active(inv):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    # Лёгкий аудит присутствия: фиксируем последний визит.
    inv.last_seen_at = datetime.utcnow()
    if request.client:
        inv.last_seen_ip = request.client.host
    db.commit()
    return inv


def vendor_owns_mr(inv: VendorInvitation, mr: MaterialRequisition) -> None:
    """Инвариант изоляции: ресурс должен принадлежать MR этого приглашения.
    Вызывается в каждом guest-endpoint, который работает с MR."""
    if inv.mr_id != mr.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def write_audit(
    db: Session,
    *,
    action: str,
    mr_id: int | None = None,
    invitation_id: int | None = None,
    actor_user_id: int | None = None,
    request: Request | None = None,
    summary: str | None = None,
) -> None:
    """Пишет запись в vendor_audit_logs. Аудит не должен ронять запрос —
    ошибки проглатываются."""
    try:
        ip = None
        ua = None
        if request is not None:
            ip = request.client.host if request.client else None
            ua = request.headers.get("user-agent")
        db.add(
            VendorAuditLog(
                mr_id=mr_id,
                invitation_id=invitation_id,
                actor_user_id=actor_user_id,
                action=action,
                ip=ip,
                user_agent=(ua or "")[:255] or None,
                payload_summary=summary,
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
