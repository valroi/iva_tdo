"""Распознавание документов FEED при массовой загрузке.

Каскад определения шифра (решает проблему штампов разных форматов A4/A3/A2,
где порядок извлечения текста из PDF непредсказуем):
  1. Текст первых страниц (штамп) — регулярки из smart_upload.
  2. ИМЯ ФАЙЛА — файлы стадии FEED именуются шифром
     (IMP-FD-00-00-HM-REQ-262-00.pdf), это самый надёжный источник.
  3. Не нашли — строка создаётся как "UNRESOLVED", правится руками.

Шифр храним БЕЗ суффикса ревизии (IMP-FD-00-00-HM-REQ-262), ревизию — отдельно.
"""

from __future__ import annotations

import io
import re
from typing import Any

from app.services.smart_upload import (  # переиспользуем боевые экстракторы
    _extract_cipher_from_text,
    _extract_drawing_title_parts,
    _extract_stamp_triplet,
    _extract_text,
    _extract_text_pdftotext,
)

# Шифр в имени файла: 6+ дефис-секций, опциональный хвост-ревизия из 2 цифр.
FILENAME_CIPHER_RE = re.compile(
    r"([A-Z0-9]{2,}(?:-[A-Z0-9]{1,6}){5,9})",
    re.IGNORECASE,
)


def split_rev(cipher: str) -> tuple[str, str | None]:
    """IMP-FD-00-00-HM-REQ-262-00 → (IMP-FD-00-00-HM-REQ-262, '00').
    Последняя секция из 2 цифр трактуется как ревизия."""
    parts = cipher.strip().upper().split("-")
    if len(parts) >= 7 and re.fullmatch(r"\d{2}", parts[-1]):
        return "-".join(parts[:-1]), parts[-1]
    return "-".join(parts), None


def parse_components(doc_number: str) -> dict[str, str | None]:
    """Из шифра без ревизии достаём дисциплину и тип документа.
    IMP-FD-00-00-HM-REQ-262 → discipline=HM, doc_type=REQ."""
    parts = doc_number.split("-")
    discipline = parts[4] if len(parts) > 4 else None
    doc_type = parts[5] if len(parts) > 5 else None
    return {"discipline": discipline, "doc_type": doc_type}


def cipher_from_filename(file_name: str) -> str | None:
    stem = re.sub(r"\.[A-Za-z0-9]+$", "", file_name.strip())
    # Убираем суффиксы вида [02], (1), _final
    stem = re.sub(r"\[[^\]]*\]|\([^)]*\)", "", stem)
    best: str | None = None
    for m in FILENAME_CIPHER_RE.finditer(stem.upper()):
        candidate = m.group(1)
        if best is None or len(candidate) > len(best):
            best = candidate
    return best


def extract_pdf_text(pdf_bytes: bytes, max_pages: int = 10) -> str:
    """Текст для поиска: первые max_pages страниц (или весь docx-фолбэк)."""
    text = ""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(pdf_bytes))
        parts = []
        for page in reader.pages[:max_pages]:
            parts.append(page.extract_text() or "")
        text = "\n".join(parts)
    except Exception:  # noqa: BLE001
        text = ""
    if not text.strip():
        text = _extract_text_pdftotext(pdf_bytes)
    return text


def extract_docx_text(docx_bytes: bytes) -> str:
    try:
        import zipfile

        xml = zipfile.ZipFile(io.BytesIO(docx_bytes)).read("word/document.xml").decode("utf-8")
        xml = re.sub(r"<[^>]+>", " ", xml)
        return re.sub(r"\s+", " ", xml)
    except Exception:  # noqa: BLE001
        return ""


def parse_feed_file(file_name: str, raw: bytes) -> dict[str, Any]:
    """Главная функция: имя файла + содержимое → поля документа FEED."""
    is_pdf = file_name.lower().endswith(".pdf")
    is_docx = file_name.lower().endswith(".docx")

    text = ""
    if is_pdf:
        text = _extract_text(raw) or _extract_text_pdftotext(raw)
    elif is_docx:
        text = extract_docx_text(raw)[:20000]

    text_upper = (text or "").upper()

    cipher = None
    detected_from = "none"
    if text_upper:
        cipher = _extract_cipher_from_text(text_upper)
        if cipher:
            detected_from = "stamp"
    if not cipher:
        cipher = cipher_from_filename(file_name)
        if cipher:
            detected_from = "filename"

    rev = None
    doc_number = None
    if cipher:
        doc_number, rev = split_rev(cipher)

    # Ревизия/дата/цель из штампа (если есть текст)
    stamp_rev, stamp_date, purpose = (None, None, None)
    if text_upper:
        stamp_rev, stamp_date, purpose = _extract_stamp_triplet(text_upper)
    rev = rev or stamp_rev

    title_en, title_ru = (None, None)
    if text:
        title_en, title_ru = _extract_drawing_title_parts(text)
        if not title_en:
            # «Requisition for X» в первых строках — годится как EN-название
            m = re.search(r"(REQUISITION\s+FOR\s+[A-Z0-9 ()\-/.,]{3,80})", text_upper)
            if m:
                title_en = m.group(1).title()

    components = parse_components(doc_number) if doc_number else {"discipline": None, "doc_type": None}

    search_text = ""
    if is_pdf:
        search_text = extract_pdf_text(raw)
    elif is_docx:
        search_text = extract_docx_text(raw)
    # Ограничиваем, чтобы не раздувать БД.
    search_text = (search_text or "")[:200_000]

    return {
        "doc_number": doc_number,
        "rev": rev,
        "rev_date": stamp_date,
        "issue_purpose": purpose,
        "title_en": title_en,
        "title_ru": title_ru,
        "discipline": components.get("discipline"),
        "doc_type": components.get("doc_type"),
        "detected_from": detected_from,
        "search_text": search_text,
    }
