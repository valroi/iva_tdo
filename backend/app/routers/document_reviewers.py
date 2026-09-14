"""Ревьюверы, добавленные на отдельный документ сверх матрицы назначений.

Матрица задаёт состав на всю пару «категория + раздел»; по отдельным
документам этого бывает мало. LR документа добавляет R, администратор — R
или LR, из участников проекта со стороны заказчика. Добавленный участвует в
текущем круге рассмотрения и во всех следующих, пока его не снимут.

Состав документа везде считается через `_document_reviewers` в
routers/documents.py — эти эндпоинты только ведут записи `document_reviewers`.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import (
    CompanyType,
    DocumentReviewer,
    MDRRecord,
    Notification,
    Project,
    ProjectMember,
    Revision,
    User,
)
from app.routers.documents import (
    _build_reviewer_summary,
    _document_reviewers,
    _is_lr_for_document,
    _matrix_source,
    _owner_can_access_revision,
    _revision_context,
)
from app.schemas import (
    DocumentReviewerAdd,
    DocumentReviewerCandidate,
    DocumentReviewerManageRead,
    RevisionReviewerSummary,
)
from app.services import review_events as review_events_service

router = APIRouter()

_ROLE_LABEL = {"LR": "LR (лидер-ревьювер)", "R": "R (ревьювер)"}


def _load(db: Session, revision_id: int, current_user: User) -> tuple[Revision, object, MDRRecord, Project]:
    revision = db.query(Revision).filter(Revision.id == revision_id).first()
    if revision is None or not _owner_can_access_revision(db, current_user, revision):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ревизия не найдена")
    document, mdr, project = _revision_context(db, revision)
    return revision, document, mdr, project


def _allowed_states(db: Session, current_user: User, project: Project, mdr: MDRRecord) -> list[str]:
    if current_user.role.value == "admin":
        return ["R", "LR"]
    if current_user.company_type == CompanyType.owner and _is_lr_for_document(
        db, current_user=current_user, project_id=project.id, mdr=mdr
    ):
        return ["R"]
    return []


@router.get("/revisions/{revision_id}/reviewers/manage", response_model=DocumentReviewerManageRead)
def get_reviewer_management(
    revision_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    revision, document, mdr, project = _load(db, revision_id, current_user)
    allowed = _allowed_states(db, current_user, project, mdr)
    candidates: list[DocumentReviewerCandidate] = []
    if allowed:
        current_ids = {item.user_id for item in _document_reviewers(db, project_id=project.id, mdr=mdr)}
        rows = (
            db.query(User, ProjectMember)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .filter(
                ProjectMember.project_id == project.id,
                User.company_type == CompanyType.owner,
                User.is_active.is_(True),
            )
            .order_by(User.full_name.asc())
            .all()
        )
        seen: set[int] = set()
        for user, member in rows:
            if user.id in current_ids or user.id in seen:
                continue
            seen.add(user.id)
            candidates.append(
                DocumentReviewerCandidate(
                    user_id=user.id,
                    full_name=user.full_name or user.email,
                    email=user.email,
                    member_role=member.member_role.value if member.member_role else None,
                )
            )
    return DocumentReviewerManageRead(
        revision_id=revision.id,
        document_num=document.document_num,
        can_add=bool(allowed),
        allowed_states=allowed,
        candidates=candidates,
    )


@router.post("/revisions/{revision_id}/reviewers", response_model=RevisionReviewerSummary)
def add_document_reviewer(
    revision_id: int,
    payload: DocumentReviewerAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    revision, document, mdr, project = _load(db, revision_id, current_user)
    allowed = _allowed_states(db, current_user, project, mdr)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Добавлять ревьюверов на документ может LR этого документа или администратор",
        )
    if payload.state not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="LR документа может добавить только ревьювера (R). Второго LR назначает администратор",
        )

    user = db.query(User).filter(User.id == payload.user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    if user.company_type != CompanyType.owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Рассматривать документ могут только сотрудники заказчика",
        )
    member = (
        db.query(ProjectMember.id)
        .filter(ProjectMember.project_id == project.id, ProjectMember.user_id == user.id)
        .first()
    )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{user.full_name or user.email} не участник проекта {project.code} — сначала добавьте его в участники",
        )

    existing = next(
        (item for item in _document_reviewers(db, project_id=project.id, mdr=mdr) if item.user_id == user.id),
        None,
    )
    if existing is not None:
        where = "по матрице назначений" if existing.source == "matrix" else "добавлен на документ ранее"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{user.full_name or user.email} уже рассматривает этот документ как {_ROLE_LABEL[existing.state]} ({where})",
        )

    db.add(
        DocumentReviewer(
            mdr_id=mdr.id,
            user_id=user.id,
            state=payload.state,
            added_by_id=current_user.id,
        )
    )
    actor_name = current_user.full_name or current_user.email
    db.add(
        Notification(
            user_id=user.id,
            event_type="REVIEWER_ADDED",
            message=(
                f"{actor_name} добавил вас ревьювером ({payload.state}) по документу "
                f"{document.document_num}, ревизия {revision.revision_code}."
            ),
            project_code=mdr.project_code,
            document_num=document.document_num,
            revision_id=revision.id,
        )
    )
    review_events_service.record_event(
        db,
        revision=revision,
        document=document,
        mdr=mdr,
        actor=current_user,
        actor_role="ADMIN" if current_user.role.value == "admin" else "LR",
        event_type="REVIEWER_ADDED",
        target_user_id=user.id,
        note=f"Добавлен ревьювер {payload.state}",
    )
    db.commit()
    return _build_reviewer_summary(db, revision, project, mdr, current_user)


@router.delete("/revisions/{revision_id}/reviewers/{assignment_id}", response_model=RevisionReviewerSummary)
def remove_document_reviewer(
    revision_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    revision, document, mdr, project = _load(db, revision_id, current_user)
    source = _matrix_source(db, mdr)
    mdr_ids = {mdr.id} | ({source.id} if source is not None else set())
    row = (
        db.query(DocumentReviewer)
        .filter(
            DocumentReviewer.id == assignment_id,
            DocumentReviewer.mdr_id.in_(mdr_ids),
            DocumentReviewer.removed_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Назначение не найдено. Ревьюверов из матрицы снимают в матрице назначений проекта",
        )
    allowed = _allowed_states(db, current_user, project, mdr)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Снимать ревьюверов с документа может LR этого документа или администратор",
        )
    if row.state not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Снять LR, добавленного на документ, может только администратор",
        )
    row.removed_at = datetime.utcnow()
    row.removed_by_id = current_user.id
    db.add(row)
    review_events_service.record_event(
        db,
        revision=revision,
        document=document,
        mdr=mdr,
        actor=current_user,
        actor_role="ADMIN" if current_user.role.value == "admin" else "LR",
        event_type="REVIEWER_REMOVED",
        target_user_id=row.user_id,
        note=f"Снят ревьювер {row.state}",
    )
    db.commit()
    return _build_reviewer_summary(db, revision, project, mdr, current_user)
