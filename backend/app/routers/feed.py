"""Модуль FEED — документация стадии FEED. /api/v1/feed/...

Доступ — через право can_access_feed (вешается на роутер при регистрации).
Документы в БД, файлы в feed_storage volume — переживают апдейты системы.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, defer

from app.config import get_settings
from app.database import SessionLocal, get_db
from app.deps import get_current_user
from app.models import (
    FeedDocClass,
    FeedDocument,
    FeedFile,
    FeedFileKind,
    FeedFileLang,
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


def _is_pdf(file_name: str | None, mime: str | None) -> bool:
    return bool((file_name or "").lower().endswith(".pdf") or (mime or "").lower() == "application/pdf")


def _doc_read(db: Session, doc: FeedDocument) -> FeedDocumentRead:
    files = (
        db.query(FeedFile)
        .filter(FeedFile.feed_document_id == doc.id)
        .order_by(FeedFile.id.asc())
        .all()
    )
    return _build_doc_read(doc, files)


def _build_doc_read(doc: FeedDocument, files: list[FeedFile]) -> FeedDocumentRead:
    data = FeedDocumentRead.model_validate(doc, from_attributes=True)
    file_reads: list[FeedFileRead] = []
    master_langs: set[str] = set()
    for f in files:
        fr = FeedFileRead.model_validate(f, from_attributes=True)
        is_pdf = _is_pdf(f.file_name, f.mime)
        # Главная версия — PDF-ревизия. Не-PDF (docx/xls…) — редактируемый исходник.
        fr.is_master = bool(is_pdf and f.kind == FeedFileKind.REVISION)
        fr.is_editable = bool((not is_pdf) and f.kind == FeedFileKind.REVISION)
        if fr.is_master:
            master_langs.add(f.lang.value)
        file_reads.append(fr)
    data.files = file_reads
    data.has_acrs = any(f.kind == FeedFileKind.ACRS for f in files)
    data.master_langs = sorted(master_langs)

    # Комплектность.
    # Класс 1: ВАЖНО — флажим только если документ ВЫПУЩЕН по языкам, но один
    # язык отсутствует (есть EN, нет RU — или наоборот). Одиночный PDF без
    # языкового суффикса (lang=NA) — это самостоятельный/совмещённый документ,
    # он считается полным. Иначе пол-базы (тысячи доков с одним PDF) горели бы
    # ложным «не хватает версии».
    # Класс 1А: нужен PDF + ACRS.
    has_en = FeedFileLang.EN.value in master_langs
    has_ru = FeedFileLang.RU.value in master_langs
    has_bi = FeedFileLang.BI.value in master_langs
    incomplete, reason = False, None
    if doc.doc_class == FeedDocClass.C1:
        if not master_langs:
            incomplete, reason = True, "нет PDF-версии"
        elif has_en and not has_ru and not has_bi:
            incomplete, reason = True, "есть только EN, не хватает RU"
        elif has_ru and not has_en and not has_bi:
            incomplete, reason = True, "есть только RU, не хватает EN"
        # только NA (один совмещённый PDF), либо EN+RU, либо BI → полный
    else:  # C1A
        if not master_langs:
            incomplete, reason = True, "нет PDF-версии"
        elif not data.has_acrs:
            incomplete, reason = True, "нет ACRS"
    data.incomplete = incomplete
    data.incomplete_reason = reason
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
    # defer(search_text): при листинге не тянем огромные тексты документов
    # (по ~200КБ на документ; на 2700 доках это были сотни МБ и тормоза).
    query = db.query(FeedDocument).options(defer(FeedDocument.search_text))
    if project_id is not None:
        query = query.filter(FeedDocument.project_id == project_id)
    if discipline:
        query = query.filter(FeedDocument.discipline_code == discipline.upper())
    docs = query.order_by(FeedDocument.discipline_code.asc(), FeedDocument.doc_number.asc()).all()
    # Все файлы — ОДНИМ запросом (вместо N+1 запроса на каждый документ).
    doc_ids = [d.id for d in docs]
    files_by_doc: dict[int, list[FeedFile]] = {}
    if doc_ids:
        for f in (
            db.query(FeedFile)
            .filter(FeedFile.feed_document_id.in_(doc_ids))
            .order_by(FeedFile.id.asc())
            .all()
        ):
            files_by_doc.setdefault(f.feed_document_id, []).append(f)
    return [_build_doc_read(d, files_by_doc.get(d.id, [])) for d in docs]


def _index_docs_bg(doc_ids: list[int]) -> None:
    """Фоновая инкрементальная индексация документов в Qdrant после загрузки.
    Тихо выходит, если RAG-стек не готов — поиск тогда работает по ключевым."""
    if not doc_ids:
        return
    from app.services import feed_rag

    if not feed_rag.rag_ready():
        return
    db = SessionLocal()
    try:
        for did in set(doc_ids):
            doc = db.query(FeedDocument).filter(FeedDocument.id == did).first()
            if doc:
                try:
                    feed_rag.index_document(doc)
                except Exception:  # noqa: BLE001 — индексация не должна падать в фоне
                    pass
    finally:
        db.close()


@router.post("/feed/upload", response_model=FeedUploadResult)
def upload_feed_documents(
    project_id: int,
    background: BackgroundTasks,
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
    created = updated = failed = duplicate = 0
    batch_hashes: set[str] = set()
    touched: set[int] = set()

    for up in files:
        fname = up.filename or "document"
        raw = up.file.read()
        if len(raw) > MAX_FEED_FILE:
            items.append(FeedUploadItemResult(file_name=fname, status="failed", message="File too large"))
            failed += 1
            continue

        # Дедуп по содержимому: одинаковый файл (даже под другим именем) не
        # загружаем повторно — ни в рамках пачки, ни если уже есть в проекте.
        digest = hashlib.sha256(raw).hexdigest()
        if digest in batch_hashes:
            items.append(FeedUploadItemResult(file_name=fname, status="duplicate", message="Дубликат в этой пачке"))
            duplicate += 1
            continue
        existing_dup = (
            db.query(FeedFile.id)
            .join(FeedDocument, FeedFile.feed_document_id == FeedDocument.id)
            .filter(FeedDocument.project_id == project_id, FeedFile.sha256 == digest)
            .first()
        )
        if existing_dup:
            items.append(FeedUploadItemResult(file_name=fname, status="duplicate", message="Уже загружен в проект"))
            duplicate += 1
            continue
        batch_hashes.add(digest)

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
        # Наличие ACRS-файла — признак класса 1А (ACRS бывает только у 1А).
        parsed_kind = (parsed.get("kind") or "REVISION").upper()
        is_1a = parsed.get("doc_class") == "1A" or parsed_kind == "ACRS"
        parsed_class = FeedDocClass.C1A if is_1a else FeedDocClass.C1
        if doc is None:
            doc = FeedDocument(
                project_id=project_id,
                doc_number=doc_number,
                discipline_code=(parsed.get("discipline") or "00")[:20],
                doc_type=parsed.get("doc_type"),
                title_en=parsed.get("title_en"),
                title_ru=parsed.get("title_ru"),
                doc_class=parsed_class,
                created_by_id=current_user.id,
            )
            db.add(doc)
            db.flush()
        elif is_1a:
            # Если хоть один файл документа класса 1А (или ACRS) — поднимаем класс.
            doc.doc_class = FeedDocClass.C1A

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
            # Накапливаем текст всех языковых версий — для поиска по обеим.
            existing = doc.search_text or ""
            combined = (existing + "\n" + parsed["search_text"])[:400_000]
            doc.search_text = combined

        try:
            file_lang = FeedFileLang(parsed.get("language") or "NA")
        except ValueError:
            file_lang = FeedFileLang.NA
        file_kind = FeedFileKind.ACRS if parsed_kind == "ACRS" else FeedFileKind.REVISION
        dest = _store_file(raw, fname, doc.id)
        db.add(
            FeedFile(
                feed_document_id=doc.id,
                kind=file_kind,
                lang=file_lang,
                rev=new_rev,
                file_path=str(dest),
                file_name=fname,
                mime=up.content_type,
                size_bytes=len(raw),
                sha256=digest,
                uploaded_by_id=current_user.id,
            )
        )
        db.commit()
        touched.add(doc.id)

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

    # Инкрементальная индексация затронутых документов — в фоне, не блокирует ответ.
    background.add_task(_index_docs_bg, list(touched))
    return FeedUploadResult(items=items, created=created, updated=updated, failed=failed, duplicate=duplicate)


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
    # Сначала собираем пути, затем удаляем строки одним bulk-запросом и
    # коммитим — и только после успешного коммита трогаем файлы на диске.
    # Так удаление в БД не падает из-за проблем с ФС (причина бага на проде).
    paths = [f.file_path for f in db.query(FeedFile).filter(FeedFile.feed_document_id == doc.id).all()]
    db.query(FeedFile).filter(FeedFile.feed_document_id == doc.id).delete(synchronize_session=False)
    db.delete(doc)
    db.commit()
    for p in paths:
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass
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
    """Дозагрузка файла к документу: ACRS (класс 1А), доп. ревизия или
    другая языковая версия (RU/EN) под тем же шифром."""
    doc = _get_doc_or_404(db, doc_id)
    try:
        file_kind = FeedFileKind(kind.upper())
    except ValueError:
        file_kind = FeedFileKind.ACRS
    raw = file.file.read()
    if len(raw) > MAX_FEED_FILE:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")
    digest = hashlib.sha256(raw).hexdigest()
    existing_dup = (
        db.query(FeedFile.id)
        .join(FeedDocument, FeedFile.feed_document_id == FeedDocument.id)
        .filter(FeedDocument.project_id == doc.project_id, FeedFile.sha256 == digest)
        .first()
    )
    if existing_dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Такой файл уже загружен в проект")
    # Определяем язык и (для версии) ревизию из содержимого.
    parsed = feed_import.parse_feed_file(file.filename or "file", raw)
    try:
        file_lang = FeedFileLang(parsed.get("language") or "NA")
    except ValueError:
        file_lang = FeedFileLang.NA
    if file_kind == FeedFileKind.REVISION and parsed.get("search_text"):
        doc.search_text = ((doc.search_text or "") + "\n" + parsed["search_text"])[:400_000]
    dest = _store_file(raw, file.filename or "file", doc.id)
    db.add(
        FeedFile(
            feed_document_id=doc.id,
            kind=file_kind,
            lang=file_lang,
            rev=parsed.get("rev") if file_kind == FeedFileKind.REVISION else None,
            file_path=str(dest),
            file_name=file.filename or "file",
            mime=file.content_type,
            size_bytes=len(raw),
            sha256=digest,
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
    inline: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = db.query(FeedFile).filter(FeedFile.id == file_id).first()
    if f is None or not Path(f.file_path).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    # PDF отдаём с настоящим content-type: иначе браузер не рендерит в iframe
    # и принудительно скачивает («просмотрщик не работает»). inline=1 —
    # просмотр в браузере, без — скачивание с именем файла.
    is_pdf = (f.file_name or "").lower().endswith(".pdf")
    media = "application/pdf" if is_pdf else "application/octet-stream"
    return FileResponse(
        f.file_path,
        filename=f.file_name,
        media_type=media,
        content_disposition_type="inline" if (inline and is_pdf) else "attachment",
    )


# ------------------------------------------------------------- search / ask
def _keyword_hits(db: Session, q: str, project_id: int | None, limit: int = 10) -> list[tuple[FeedDocument, str | None]]:
    # casefold() + подсчёт в Python: SQLite LIKE/lower() не различает регистр
    # кириллицы, из-за чего «график» не находил «График» (выдача мусорных
    # источников). Объём FEED-документов небольшой — скорим на стороне Python.
    words = [w.casefold() for w in re.split(r"\W+", q, flags=re.UNICODE) if len(w) >= 3][:8]
    if not words:
        return []
    query = db.query(FeedDocument)
    if project_id is not None:
        query = query.filter(FeedDocument.project_id == project_id)
    # Предфильтр в БД (ilike в Postgres регистронезависим и для кириллицы),
    # чтобы не тянуть тексты ВСЕХ документов в Python (на 2700 доках — тормоза).
    conds = []
    for w in words:
        like = f"%{w}%"
        conds.append(or_(
            FeedDocument.search_text.ilike(like),
            FeedDocument.doc_number.ilike(like),
            FeedDocument.title_en.ilike(like),
            FeedDocument.title_ru.ilike(like),
        ))
    docs = query.filter(or_(*conds)).limit(300).all()

    scored: list[tuple[int, FeedDocument, str | None]] = []
    for d in docs:
        head = f"{d.doc_number} {d.title_en or ''} {d.title_ru or ''}".casefold()
        body = (d.search_text or "").casefold()
        # Совпадение в шифре/заголовке весомее, чем в теле; считаем вхождения.
        score = sum(head.count(w) * 5 + body.count(w) for w in words)
        if score == 0:
            continue  # показываем ТОЛЬКО реально релевантные документы
        snippet = None
        text = d.search_text or ""
        low = text.casefold()
        for w in words:
            idx = low.find(w)
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
    # Прямой матч по шифру — ВСЕГДА работает (даже частичный, любой регистр).
    # Короткие сегменты шифра (00, EL) терялись в keyword-скоринге.
    cipher = q.strip().upper()
    out: list[FeedSearchHit] = []
    seen: set[int] = set()
    if cipher:
        dq = db.query(FeedDocument).filter(FeedDocument.doc_number.ilike(f"%{cipher}%"))
        if project_id is not None:
            dq = dq.filter(FeedDocument.project_id == project_id)
        for d in dq.order_by(FeedDocument.doc_number.asc()).limit(50).all():
            out.append(_hit_schema(d, None))
            seen.add(d.id)
    # Полнотекстовый/смысловой по содержимому.
    for d, s in _keyword_hits(db, q, project_id):
        if d.id not in seen:
            out.append(_hit_schema(d, s))
            seen.add(d.id)
    return out


_FEED_AI_SETTING_KEY = "feed_ai_enabled"


def _feed_ai_enabled(db: Session) -> bool:
    from app.models import SystemSetting

    item = db.query(SystemSetting).filter(SystemSetting.key == _FEED_AI_SETTING_KEY).first()
    return bool(item and item.value == "true")


def _ai_configured() -> bool:
    return bool(settings.ai_api_key and settings.ai_api_base_url)


@router.get("/feed/settings")
def get_feed_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Состояние умного (AI) поиска: включён админом, настроен ключ, готов RAG."""
    from app.services import feed_rag

    return {
        "ai_enabled": _feed_ai_enabled(db),
        "ai_configured": _ai_configured(),
        "rag_ready": feed_rag.rag_ready(),
        "agent_model": settings.agent_model,
    }


@router.put("/feed/settings")
def set_feed_settings(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Вкл/выкл умный поиск. Только для админов (управление пользователями)."""
    from app.deps import has_permission
    from app.models import SystemSetting

    if not has_permission(current_user, "can_manage_users"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    enabled = bool(payload.get("ai_enabled"))
    item = db.query(SystemSetting).filter(SystemSetting.key == _FEED_AI_SETTING_KEY).first()
    if item is None:
        item = SystemSetting(key=_FEED_AI_SETTING_KEY, value="true" if enabled else "false")
        db.add(item)
    else:
        item.value = "true" if enabled else "false"
    db.commit()
    return {"ai_enabled": enabled, "ai_configured": _ai_configured()}


def _keyword_result(db: Session, question: str, project_id: int | None) -> FeedAskResult:
    hits = _keyword_hits(db, question, project_id, limit=5)
    sources = [_hit_schema(d, s) for d, s in hits]
    if not sources:
        return FeedAskResult(answer="Ничего не найдено по запросу. Уточните формулировку.", mode="keyword", sources=[])
    listing = "\n".join(f"• {h.doc_number} — {h.title_en or h.title_ru or ''} (rev {h.latest_rev or '—'})" for h in sources)
    return FeedAskResult(answer=f"Найдено по ключевым словам:\n{listing}", mode="keyword", sources=sources)


@router.post("/feed/ask", response_model=FeedAskResult)
def ask_feed(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Поиск по документации. Если умный поиск включён админом И настроен
    OpenRouter — отвечает LangGraph-агент (RAG: Qdrant + bge-m3 + Qwen).
    Иначе или при сбое стека — полнотекстовый поиск с выдачей источников."""
    question = (payload.get("question") or "").strip()
    project_id = payload.get("project_id")
    if not question:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty question")

    if not (_feed_ai_enabled(db) and _ai_configured()):
        return _keyword_result(db, question, project_id)

    from app.services import feed_agent, feed_rag

    try:
        res = feed_agent.answer_question(question, project_id)
        sources = [FeedSearchHit(**s) for s in res.get("sources", [])]
        return FeedAskResult(answer=res["answer"], mode="agent", sources=sources)
    except feed_rag.RagUnavailable as exc:
        base = _keyword_result(db, question, project_id)  # стек не готов — показываем причину
        return FeedAskResult(
            answer=f"⚠️ Умный поиск недоступен: {str(exc)[:200]}\n\n{base.answer}",
            mode="keyword",
            sources=base.sources,
        )
    except Exception as exc:  # noqa: BLE001 — LLM/квота/сеть: показываем ошибку в чате
        base = _keyword_result(db, question, project_id)
        return FeedAskResult(
            answer=f"⚠️ Ошибка AI-агента: {str(exc)[:250]}\n\n{base.answer}",
            mode="keyword",
            sources=base.sources,
        )


@router.post("/feed/agent/reindex")
def reindex_feed_agent(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Перестроить векторный индекс (Qdrant) по документам FEED. Только админ."""
    from app.deps import has_permission
    from app.services import feed_rag

    if not has_permission(current_user, "can_manage_users"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    try:
        stats = feed_rag.reindex_all(db, project_id)
    except feed_rag.RagUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return {"status": "ok", **stats}


@router.post("/feed/reparse-titles")
def reparse_feed_titles(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Перечитать названия документов из уже извлечённого текста (search_text).

    Нужен после починки парсера: в старых карточках в названии лежит мусор из
    штампа/тела чертежа («резервуар для», «350350 250250К1К1»). Осмысленные и
    вручную поправленные названия НЕ трогаем — перезаписываем только те, что не
    проходят текущую валидацию. Только админ."""
    from app.deps import has_permission
    from app.services.feed_import import (
        _TITLE_HINT,
        _TITLE_HINT_RU,
        _TITLE_STOP,
        _TITLE_STOP_RU,
        _looks_like_junk,
        extract_titles,
    )

    if not has_permission(current_user, "can_manage_users"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    def looks_valid(value: str | None, *, ru: bool) -> bool:
        if not value:
            return False
        line = value.strip()
        if len(line) < 8 or _looks_like_junk(line):
            return False
        if ru:
            return bool(_TITLE_HINT_RU.search(line)) and not _TITLE_STOP_RU.search(line)
        return bool(_TITLE_HINT.search(line)) and not _TITLE_STOP.search(line)

    query = db.query(FeedDocument)
    if project_id is not None:
        query = query.filter(FeedDocument.project_id == project_id)
    docs = query.all()

    updated = 0
    cleared = 0
    kept = 0
    for doc in docs:
        ru_ok = looks_valid(doc.title_ru, ru=True)
        en_ok = looks_valid(doc.title_en, ru=False)
        if ru_ok and en_ok:
            kept += 1
            continue
        new_en, new_ru = extract_titles(doc.search_text or "") if doc.search_text else (None, None)
        changed = False
        if not ru_ok:
            if new_ru:
                doc.title_ru, changed = new_ru, True
            elif doc.title_ru:
                # Мусор и заменить нечем — лучше пусто, чем вводящее в заблуждение.
                doc.title_ru, changed = None, True
                cleared += 1
        if not en_ok:
            if new_en:
                doc.title_en, changed = new_en, True
            elif doc.title_en:
                doc.title_en, changed = None, True
                cleared += 1
        if changed:
            db.add(doc)
            updated += 1
    db.commit()
    return {"status": "ok", "documents": len(docs), "updated": updated, "cleared_junk": cleared, "kept_valid": kept}
