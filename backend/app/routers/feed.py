"""Модуль FEED — документация стадии FEED. /api/v1/feed/...

Доступ — через право can_access_feed (вешается на роутер при регистрации).
Документы в БД, файлы в feed_storage volume — переживают апдейты системы.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models import (
    FeedDocClass,
    FeedDocument,
    FeedFile,
    FeedFileKind,
    Project,
    User,
)
from app.schemas import (
    FeedAskResult,
    FeedDocumentRead,
    FeedDocumentUpdate,
    FeedFileRead,
    FeedSearchHit,
    FeedUploadItemResult,
    FeedUploadResult,
)
from app.services import feed_import

router = APIRouter()
settings = get_settings()

FEED_ROOT = Path(settings.feed_storage_root)
MAX_FEED_FILE = 200 * 1024 * 1024  # 200 MB — чертежи бывают тяжёлые


def _doc_read(db: Session, doc: FeedDocument) -> FeedDocumentRead:
    files = (
        db.query(FeedFile)
        .filter(FeedFile.feed_document_id == doc.id)
        .order_by(FeedFile.id.asc())
        .all()
    )
    data = FeedDocumentRead.model_validate(doc, from_attributes=True)
    data.files = [FeedFileRead.model_validate(f, from_attributes=True) for f in files]
    data.has_acrs = any(f.kind == FeedFileKind.ACRS for f in files)
    return data


def _get_doc_or_404(db: Session, doc_id: int) -> FeedDocument:
    doc = db.query(FeedDocument).filter(FeedDocument.id == doc_id).first()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feed document not found")
    return doc


def _store_file(raw: bytes, file_name: str, doc_id: int) -> Path:
    safe = f"{uuid4().hex}_{Path(file_name).name.replace(' ', '_')}"
    dest_dir = FEED_ROOT / str(doc_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / safe
    dest.write_bytes(raw)
    return dest


# ------------------------------------------------------------- documents
@router.get("/feed/documents", response_model=list[FeedDocumentRead])
def list_feed_documents(
    project_id: int | None = None,
    discipline: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(FeedDocument)
    if project_id is not None:
        query = query.filter(FeedDocument.project_id == project_id)
    if discipline:
        query = query.filter(FeedDocument.discipline_code == discipline.upper())
    docs = query.order_by(FeedDocument.discipline_code.asc(), FeedDocument.doc_number.asc()).all()
    return [_doc_read(db, d) for d in docs]


@router.post("/feed/upload", response_model=FeedUploadResult)
def upload_feed_documents(
    project_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Массовая загрузка: на каждый файл — распознание шифра (штамп → имя
    файла) и создание/обновление строки документа. Повторная загрузка того
    же шифра обновляет ревизию и добавляет файл (история сохраняется)."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    items: list[FeedUploadItemResult] = []
    created = updated = failed = 0

    for up in files:
        fname = up.filename or "document"
        raw = up.file.read()
        if len(raw) > MAX_FEED_FILE:
            items.append(FeedUploadItemResult(file_name=fname, status="failed", message="File too large"))
            failed += 1
            continue
        try:
            parsed = feed_import.parse_feed_file(fname, raw)
        except Exception as exc:  # noqa: BLE001 — одна битая PDF не должна валить пачку
            items.append(FeedUploadItemResult(file_name=fname, status="failed", message=str(exc)[:200]))
            failed += 1
            continue

        doc_number = parsed.get("doc_number")
        if not doc_number:
            # Нераспознанный — создаём строку-заглушку по имени файла,
            # чтобы документ не потерялся; правится руками.
            doc_number = f"UNRESOLVED-{Path(fname).stem[:80].upper()}"

        doc = (
            db.query(FeedDocument)
            .filter(FeedDocument.project_id == project_id, FeedDocument.doc_number == doc_number)
            .first()
        )
        is_new = doc is None
        if doc is None:
            doc = FeedDocument(
                project_id=project_id,
                doc_number=doc_number,
                discipline_code=(parsed.get("discipline") or "00")[:20],
                doc_type=parsed.get("doc_type"),
                title_en=parsed.get("title_en"),
                title_ru=parsed.get("title_ru"),
                doc_class=FeedDocClass.C1,
                created_by_id=current_user.id,
            )
            db.add(doc)
            db.flush()

        # Обновляем ревизию/метаданные, если новая ревизия старше или пусто.
        new_rev = parsed.get("rev")
        if new_rev and (not doc.latest_rev or new_rev >= doc.latest_rev):
            doc.latest_rev = new_rev
            doc.issue_purpose = parsed.get("issue_purpose") or doc.issue_purpose
            doc.rev_date = parsed.get("rev_date") or doc.rev_date
        if not doc.title_en and parsed.get("title_en"):
            doc.title_en = parsed.get("title_en")
        if not doc.title_ru and parsed.get("title_ru"):
            doc.title_ru = parsed.get("title_ru")
        if parsed.get("search_text"):
            doc.search_text = parsed["search_text"]

        dest = _store_file(raw, fname, doc.id)
        db.add(
            FeedFile(
                feed_document_id=doc.id,
                kind=FeedFileKind.REVISION,
                rev=new_rev,
                file_path=str(dest),
                file_name=fname,
                mime=up.content_type,
                size_bytes=len(raw),
                sha256=hashlib.sha256(raw).hexdigest(),
                uploaded_by_id=current_user.id,
            )
        )
        db.commit()

        items.append(
            FeedUploadItemResult(
                file_name=fname,
                status="created" if is_new else "updated",
                doc_number=doc.doc_number,
                document_id=doc.id,
                detected_from=parsed.get("detected_from"),
            )
        )
        if is_new:
            created += 1
        else:
            updated += 1

    return FeedUploadResult(items=items, created=created, updated=updated, failed=failed)


@router.patch("/feed/documents/{doc_id}", response_model=FeedDocumentRead)
def update_feed_document(
    doc_id: int,
    payload: FeedDocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_doc_or_404(db, doc_id)
    for field in ("discipline_code", "doc_number", "title_en", "title_ru", "doc_class", "doc_type", "latest_rev", "issue_purpose"):
        value = getattr(payload, field)
        if value is not None:
            setattr(doc, field, value.upper() if field in {"discipline_code", "doc_number"} and isinstance(value, str) else value)
    db.commit()
    db.refresh(doc)
    return _doc_read(db, doc)


@router.delete("/feed/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = _get_doc_or_404(db, doc_id)
    for f in db.query(FeedFile).filter(FeedFile.feed_document_id == doc.id).all():
        try:
            Path(f.file_path).unlink(missing_ok=True)
        except OSError:
            pass
        db.delete(f)
    db.delete(doc)
    db.commit()
    return None


# ------------------------------------------------------------- files
@router.post("/feed/documents/{doc_id}/files", response_model=FeedDocumentRead)
def upload_feed_file(
    doc_id: int,
    kind: str = "ACRS",
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Дозагрузка файла к документу: ACRS (класс 1А) или доп. ревизия."""
    doc = _get_doc_or_404(db, doc_id)
    try:
        file_kind = FeedFileKind(kind.upper())
    except ValueError:
        file_kind = FeedFileKind.ACRS
    raw = file.file.read()
    if len(raw) > MAX_FEED_FILE:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")
    dest = _store_file(raw, file.filename or "file", doc.id)
    db.add(
        FeedFile(
            feed_document_id=doc.id,
            kind=file_kind,
            file_path=str(dest),
            file_name=file.filename or "file",
            mime=file.content_type,
            size_bytes=len(raw),
            sha256=hashlib.sha256(raw).hexdigest(),
            uploaded_by_id=current_user.id,
        )
    )
    db.commit()
    db.refresh(doc)
    return _doc_read(db, doc)


@router.delete("/feed/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(FeedFile).filter(FeedFile.id == file_id).first()
    if f is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    try:
        Path(f.file_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(f)
    db.commit()
    return None


@router.get("/feed/files/{file_id}")
def download_feed_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(FeedFile).filter(FeedFile.id == file_id).first()
    if f is None or not Path(f.file_path).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return FileResponse(f.file_path, filename=f.file_name, media_type="application/octet-stream")


# ------------------------------------------------------------- search / ask
def _keyword_hits(db: Session, q: str, project_id: int | None, limit: int = 10) -> list[tuple[FeedDocument, str | None]]:
    words = [w for w in re.split(r"\s+", q.strip()) if len(w) >= 3][:6]
    if not words:
        return []
    query = db.query(FeedDocument)
    if project_id is not None:
        query = query.filter(FeedDocument.project_id == project_id)
    conditions = []
    for w in words:
        like = f"%{w}%"
        conditions.append(
            or_(
                FeedDocument.search_text.ilike(like),
                FeedDocument.doc_number.ilike(like),
                FeedDocument.title_en.ilike(like),
                FeedDocument.title_ru.ilike(like),
            )
        )
    docs = query.filter(or_(*conditions)).limit(limit * 3).all()

    # Скоринг: сколько слов реально встретилось; сниппет вокруг первого вхождения.
    scored: list[tuple[int, FeedDocument, str | None]] = []
    for d in docs:
        haystack = " ".join(filter(None, [d.doc_number, d.title_en or "", d.title_ru or "", d.search_text or ""])).lower()
        score = sum(1 for w in words if w.lower() in haystack)
        snippet = None
        text = d.search_text or ""
        for w in words:
            idx = text.lower().find(w.lower())
            if idx >= 0:
                start = max(0, idx - 80)
                snippet = ("…" if start else "") + text[start : idx + 160].replace("\n", " ") + "…"
                break
        scored.append((score, d, snippet))
    scored.sort(key=lambda x: -x[0])
    return [(d, s) for _, d, s in scored[:limit]]


def _hit_schema(d: FeedDocument, snippet: str | None) -> FeedSearchHit:
    return FeedSearchHit(
        document_id=d.id,
        doc_number=d.doc_number,
        title_en=d.title_en,
        title_ru=d.title_ru,
        discipline_code=d.discipline_code,
        latest_rev=d.latest_rev,
        snippet=snippet,
    )


@router.get("/feed/search", response_model=list[FeedSearchHit])
def search_feed(
    q: str,
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return [_hit_schema(d, s) for d, s in _keyword_hits(db, q, project_id)]


@router.post("/feed/ask", response_model=FeedAskResult)
def ask_feed(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AI-поиск по документации. Если настроен OpenAI-совместимый API
    (AI_API_BASE_URL/AI_API_KEY, напр. Qwen) — отвечает нейросеть с опорой
    на найденные документы. Иначе — обычный поиск с выдачей источников."""
    question = (payload.get("question") or "").strip()
    project_id = payload.get("project_id")
    if not question:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty question")

    hits = _keyword_hits(db, question, project_id, limit=5)
    sources = [_hit_schema(d, s) for d, s in hits]

    if not settings.ai_api_key or not settings.ai_api_base_url:
        if not sources:
            return FeedAskResult(answer="Ничего не найдено по запросу. Уточните формулировку.", mode="keyword", sources=[])
        listing = "\n".join(f"• {h.doc_number} — {h.title_en or h.title_ru or ''} (rev {h.latest_rev or '—'})" for h in sources)
        return FeedAskResult(
            answer=f"AI-поиск не настроен (нет API-ключа). Найдено по ключевым словам:\n{listing}",
            mode="keyword",
            sources=sources,
        )

    # Контекст для LLM: фрагменты текста найденных документов.
    context_parts = []
    for d, _ in hits:
        body = (d.search_text or "")[:4000]
        context_parts.append(f"=== {d.doc_number} (rev {d.latest_rev or '—'}) {d.title_en or d.title_ru or ''} ===\n{body}")
    context = "\n\n".join(context_parts)[:24000]

    try:
        import json as _json
        import urllib.request

        req_body = _json.dumps(
            {
                "model": settings.ai_model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Ты помощник по проектной документации стадии FEED. Отвечай кратко и"
                            " по делу на языке вопроса. Опирайся ТОЛЬКО на предоставленные фрагменты"
                            " документов; в конце перечисли шифры документов-источников."
                        ),
                    },
                    {"role": "user", "content": f"Фрагменты документов:\n{context}\n\nВопрос: {question}"},
                ],
                "temperature": 0.2,
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            settings.ai_api_base_url.rstrip("/") + "/chat/completions",
            data=req_body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.ai_api_key}",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        answer = data["choices"][0]["message"]["content"]
        return FeedAskResult(answer=answer, mode="ai", sources=sources)
    except Exception as exc:  # noqa: BLE001 — сеть/ключ/квота: не роняем, отдаём keyword-фолбэк
        listing = "\n".join(f"• {h.doc_number} — {h.title_en or h.title_ru or ''}" for h in sources)
        return FeedAskResult(
            answer=f"AI-сервис недоступен ({str(exc)[:120]}). Найдено по ключевым словам:\n{listing}",
            mode="keyword",
            sources=sources,
        )
