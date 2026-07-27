"""Автоматический append-only аудит замечаний (таблица comment_audit).

Подход: SQLAlchemy-хук на Session (как в notification_email), а не правка
каждого из ~10 мест, где создаются/меняются Comment. Любой insert/update
замечания автоматически попадает в физический журнал — данные можно
восстановить, даже если строку в `comments` позже изменят или удалят.

Поток:
  after_flush  — собираем PK+значения новых и изменённых Comment в session.info
                 (у объектов уже есть данные; до commit — если транзакция
                 откатится, аудит не запишется).
  after_commit — транзакция зафиксирована; в ОТДЕЛЬНОЙ сессии дорезолвим ФИО
                 автора и контекст документа и пишем строки CommentAudit.
"""

from __future__ import annotations

import logging

from sqlalchemy import event
from sqlalchemy.orm import Session as OrmSession

from app.database import SessionLocal
from app.models import Comment, CommentAudit, Document, MDRRecord, Revision, User

logger = logging.getLogger("comment_audit")

_SESSION_INFO_KEY = "_pending_comment_audit"


def _enum_val(value) -> str | None:
    if value is None:
        return None
    return getattr(value, "value", value)


def _snapshot(comment: Comment, action: str) -> dict:
    return {
        "comment_id": comment.id,
        "action": action,
        "revision_id": comment.revision_id,
        "parent_id": comment.parent_id,
        "author_id": comment.author_id,
        "text": comment.text,
        "status": _enum_val(comment.status),
        "review_code": _enum_val(comment.review_code),
        "contractor_status": _enum_val(comment.contractor_status),
        "in_crs": comment.in_crs,
        "crs_number": comment.crs_number,
        "is_published_to_contractor": comment.is_published_to_contractor,
        "comment_created_at": comment.created_at,
        "resolved_at": comment.resolved_at,
    }


@event.listens_for(OrmSession, "after_flush")
def _collect_comment_changes(session: OrmSession, _flush_context) -> None:
    pending: list[dict] = []
    for obj in session.new:
        if isinstance(obj, Comment):
            pending.append(_snapshot(obj, "INSERT"))
    for obj in session.dirty:
        if isinstance(obj, Comment) and session.is_modified(obj, include_collections=False):
            pending.append(_snapshot(obj, "UPDATE"))
    if pending:
        session.info.setdefault(_SESSION_INFO_KEY, []).extend(pending)


@event.listens_for(OrmSession, "after_commit")
def _write_comment_audit(session: OrmSession) -> None:
    pending = session.info.pop(_SESSION_INFO_KEY, None)
    if not pending:
        return
    db = SessionLocal()
    try:
        author_ids = {p["author_id"] for p in pending if p["author_id"]}
        revision_ids = {p["revision_id"] for p in pending if p["revision_id"]}
        authors = {u.id: u for u in db.query(User).filter(User.id.in_(author_ids)).all()} if author_ids else {}
        revisions = {r.id: r for r in db.query(Revision).filter(Revision.id.in_(revision_ids)).all()} if revision_ids else {}
        doc_ids = {r.document_id for r in revisions.values()}
        documents = {d.id: d for d in db.query(Document).filter(Document.id.in_(doc_ids)).all()} if doc_ids else {}
        mdr_ids = {d.mdr_id for d in documents.values()}
        mdrs = {m.id: m for m in db.query(MDRRecord).filter(MDRRecord.id.in_(mdr_ids)).all()} if mdr_ids else {}
        for p in pending:
            rev = revisions.get(p["revision_id"])
            doc = documents.get(rev.document_id) if rev else None
            mdr = mdrs.get(doc.mdr_id) if doc else None
            author = authors.get(p["author_id"])
            db.add(
                CommentAudit(
                    comment_id=p["comment_id"],
                    action=p["action"],
                    revision_id=p["revision_id"],
                    parent_id=p["parent_id"],
                    document_num=doc.document_num if doc else None,
                    project_code=mdr.project_code if mdr else None,
                    revision_code=rev.revision_code if rev else None,
                    author_id=p["author_id"],
                    author_name=(author.full_name or author.email) if author else None,
                    text=p["text"],
                    status=p["status"],
                    review_code=p["review_code"],
                    contractor_status=p["contractor_status"],
                    in_crs=p["in_crs"],
                    crs_number=p["crs_number"],
                    is_published_to_contractor=p["is_published_to_contractor"],
                    comment_created_at=p["comment_created_at"],
                    resolved_at=p["resolved_at"],
                )
            )
        db.commit()
    except Exception:  # noqa: BLE001 — аудит не должен ронять основной поток
        logger.exception("Не удалось записать comment_audit")
        db.rollback()
    finally:
        db.close()
