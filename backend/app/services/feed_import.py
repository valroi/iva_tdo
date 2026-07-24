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
    _extract_text_pdftotext,
)

# Шифр в имени файла: 6+ дефис-секций, опциональный хвост-ревизия из 2 цифр.
FILENAME_CIPHER_RE = re.compile(
    r"([A-Z0-9]{2,}(?:-[A-Z0-9]{1,6}){5,9})",
    re.IGNORECASE,
)


_LANG_SUFFIX = {
    "EN": "EN", "ENG": "EN", "ENGLISH": "EN",
    "RU": "RU", "RUS": "RU", "RUSSIAN": "RU",
    "BI": "BI", "ENRU": "BI", "RUEN": "BI",
}


def split_lang(cipher: str) -> tuple[str, str | None]:
    """Отрезает завершающий языковой суффикс шифра — он не часть номера.
    IMP-…-020-01-EN → (IMP-…-020-01, 'EN'); …-01-RU-EN → (…-01, 'BI').
    Благодаря этому RU/EN-версии одного документа попадают в одну карточку."""
    parts = cipher.strip().upper().split("-")
    if len(parts) >= 2 and {parts[-2], parts[-1]} == {"RU", "EN"}:
        return "-".join(parts[:-2]), "BI"
    if parts and parts[-1] in _LANG_SUFFIX:
        return "-".join(parts[:-1]), _LANG_SUFFIX[parts[-1]]
    return "-".join(parts), None


def split_rev(cipher: str) -> tuple[str, str | None]:
    """IMP-FD-00-00-HM-REQ-262-00 → (IMP-FD-00-00-HM-REQ-262, '00').
    Последняя секция из 1-2 цифр трактуется как ревизия."""
    parts = cipher.strip().upper().split("-")
    if len(parts) >= 7 and re.fullmatch(r"\d{1,2}", parts[-1]):
        return "-".join(parts[:-1]), parts[-1].zfill(2)
    return "-".join(parts), None


# Канонический шифр: PROJ-PHASE-UU-SS-DISC-TYPE-SERIAL. SERIAL — цифры с
# опциональной буквой (201A, 257B — это РАЗНЫЕ документы). Всё после серийника
# (ревизия, язык, ACRS/CRS, IR-выпуск, номер листа, копии) — метаданные.
_CANON_RE = re.compile(
    r"^([A-Z]{2,4}-[A-Z]{2}-\d{2}-\d{2}-[A-Z]{2}-[A-Z]{2,5}-\d{1,4}[A-Z]?)(.*)$"
)


def parse_filename_cipher(file_name: str) -> dict[str, str | None] | None:
    """Жёстко структурный разбор имени файла FEED.

    Возвращает doc_number (канонический шифр без суффиксов), rev (2 цифры),
    язык (EN/RU/BI) и kind (REVISION/ACRS). None — если имя не похоже на шифр
    (тогда выше сработает фолбэк по штампу). Покрывает реальные шаблоны:
    -EN/-RU/_EN/_RU/-BI, -ACRS/_ACRS/-ACRS-NNN, -CRS, -IR01, листы _1/_2,
    копии [01], двойные расширения .xlsm.xlsx."""
    name = re.sub(r"(\.[A-Za-z0-9]{1,5})+$", "", file_name.strip())  # все расширения
    name = re.sub(r"\[[^\]]*\]|\([^)]*\)", "", name)  # маркеры копий
    m = _CANON_RE.match(name.strip().upper())
    if not m:
        return None
    doc_number, rest = m.group(1), m.group(2)
    rev = lang = None
    kind = "REVISION"
    for tok in re.split(r"[-_]", rest):
        if not tok:
            continue
        if tok in ("EN", "ENG", "ENGLISH"):
            lang = "EN"
        elif tok in ("RU", "RUS", "RUSSIAN"):
            lang = "RU"
        elif tok in ("BI", "ENRU", "RUEN"):
            lang = "BI"
        elif tok == "ACRS":
            kind = "ACRS"
        elif tok == "CRS":
            kind = "CRS"  # лист замечаний — вспомогательный, не главный
        elif re.fullmatch(r"IR\d*", tok):
            continue  # промежуточный выпуск — игнорируем для группировки
        elif re.fullmatch(r"\d{2}", tok) and rev is None:
            rev = tok  # ревизия всегда 2 цифры; одиночные цифры (_1/_2) — листы
    return {"doc_number": doc_number, "rev": rev, "lang": lang, "kind": kind}


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


def detect_class(text_upper: str) -> str | None:
    """Класс документа из штампа: 'Class: 1A' / 'КЛАСС 1'. Возвращает '1' или '1A'."""
    m = re.search(r"CLASS\s*[:\-]?\s*(1\s*[АA]|1B|1|2|3)", text_upper)
    if not m:
        m = re.search(r"КЛАСС\s*[:\-]?\s*(1\s*[АA]|1|2|3)", text_upper)
    if not m:
        return None
    raw = re.sub(r"\s+", "", m.group(1)).upper().replace("А", "A")
    return "1A" if raw == "1A" else raw


def detect_language(text: str) -> str:
    """RU/EN/BI/NA по соотношению кириллицы и латиницы в теле документа."""
    cyr = len(re.findall(r"[А-Яа-яЁё]", text))
    lat = len(re.findall(r"[A-Za-z]", text))
    total = cyr + lat
    if total < 30:
        return "NA"
    cyr_share = cyr / total
    lat_share = lat / total
    if cyr_share > 0.15 and lat_share > 0.15:
        return "BI"
    if cyr_share >= lat_share:
        return "RU"
    return "EN"


# Слова-маркеры заголовка инженерного документа (EN).
_TITLE_HINT = re.compile(
    r"\b(SYSTEM|LIST|DIAGRAM|SCHEDULE|SPECIFICATION|DRAWING|PLAN|LAYOUT|REPORT|"
    r"DATA\s*SHEET|DATASHEET|PHILOSOPHY|CALCULATION|INDEX|PROCEDURE|REQUISITION|"
    r"DESCRIPTION|STUDY|BASIS|MAP|PROFILE|SCHEMATIC|KEY\s*PLAN)\b",
    re.IGNORECASE,
)
_TITLE_STOP = re.compile(r"PROJECT|TITLE|SUBCONTRACTOR|CONTRACTOR|OWNER|PHASE|CLASS|DOC|DISC|SHEET|PAGE|REV\b|SERIAL", re.IGNORECASE)

# Русские маркеры названия инженерного документа. Раньше RU-заголовком
# бралась ПЕРВАЯ попавшаяся кириллическая строка — из штампа чертежа лезло
# «резервуар для», «12 А5004 шт», «350350 250250К1К1». Теперь как у EN:
# строка обязана содержать маркер вида документа.
_TITLE_HINT_RU = re.compile(
    r"(СХЕМА|ПЛАН\b|РАЗРЕЗ|УЗЕЛ|УЗЛЫ|ФАСАД|ВЕДОМОСТЬ|СПЕЦИФИКАЦИЯ|ПЕРЕЧЕНЬ|ЧЕРТЕЖ|ЧЕРТЁЖ|"
    r"ОПРОСНЫЙ\s+ЛИСТ|ЗАПИСКА|ОТЧЕТ|ОТЧЁТ|РАСЧЕТ|РАСЧЁТ|ПРОГРАММА|ПРОЦЕДУРА|ИНСТРУКЦИЯ|"
    r"ТЕХНИЧЕСКИЕ\s+ТРЕБОВАНИЯ|ТЕХНИЧЕСКОЕ\s+ЗАДАНИЕ|ЗАДАНИЕ\b|КАРКАС|ФУНДАМЕНТ|РОСТВЕРК|"
    r"КОНСТРУКЦИИ|РАСПОЛОЖЕНИ|КОМПОНОВК|РАЗМЕЩЕНИ|ТРУБОПРОВОД|ОБОРУДОВАНИ|"
    r"ТАБЛИЦА|КАРТА|ПРОФИЛЬ|ФИЛОСОФИЯ|ОСНОВНЫЕ\s+ТЕХНИЧЕСКИЕ)",
    re.IGNORECASE,
)
# Служебные поля штампа/рамки — не название.
_TITLE_STOP_RU = re.compile(
    r"(НАИМЕНОВАНИЕ|ЗАКАЗЧИК|ПОДРЯДЧИК|СУБПОДРЯДЧИК|СТАДИЯ|ЛИСТ\b|ЛИСТОВ|ИЗМ\b|КОЛ\.?УЧ|"
    r"ПОДПИС|ДАТА|ШИФР|РЕВИЗИЯ|ИНВ\.?\s*№|ВЗАМ\.?|СОГЛАСОВАН|УТВЕРЖДАЮ|РАЗРАБОТАЛ|ПРОВЕРИЛ|"
    r"Н\.?\s*КОНТР|ГИП\b|ТИП\s+ДОК|ДИСЦИПЛИН|ИНСТИТУТ|ООО\b|АО\b|ЗАО\b|СТР\.?\s*\d)",
    re.IGNORECASE,
)


def _looks_like_junk(line: str) -> bool:
    """Отсев строк из тела чертежа: размеры, позиции, обрывки."""
    letters = len(re.findall(r"[A-Za-zА-Яа-яЁё]", line))
    if letters < 6:
        return True
    # Доля букв мала → это размерная цепочка вида «350350 250250К1К1».
    if letters / max(len(line.replace(" ", "")), 1) < 0.55:
        return True
    # Повтор одного «слова» подряд (К1К1К1) — характерно для выносок.
    if re.search(r"(\b\w{1,3}\b)(\s*\1){2,}", line):
        return True
    # Заканчивается предлогом/союзом → обрезанный фрагмент («резервуар для»).
    if re.search(r"\s(для|на|в|с|из|по|к|от|и|или|под|при)$", line, re.IGNORECASE):
        return True
    return False


def _score_title(line: str) -> int:
    """Чем длиннее осмысленная строка с маркером — тем вероятнее это название."""
    words = len(line.split())
    score = min(words, 12) * 2
    if 20 <= len(line) <= 80:
        score += 6
    if line.endswith((".", ",", ":")):
        score -= 3
    return score


def extract_titles(text: str) -> tuple[str | None, str | None]:
    """Заголовок документа: ищем «осмысленную» строку-название.

    И EN, и RU обязаны содержать маркер вида документа (System/List/... ,
    Схема/План/Ведомость/...), не быть служебным полем штампа и не выглядеть
    мусором из тела чертежа. Из подходящих берём наиболее «титульную» по
    скорингу, а не первую попавшуюся. Всё правится вручную в карточке."""
    lines = [re.sub(r"\s+", " ", ln).strip(" .:-|") for ln in text.splitlines()]
    best_en: tuple[int, str] | None = None
    best_ru: tuple[int, str] | None = None
    for ln in lines:
        if len(ln) < 8 or len(ln) > 90:
            continue
        has_cyr = bool(re.search(r"[А-Яа-яЁё]", ln))
        has_lat = bool(re.search(r"[A-Za-z]", ln))
        if _looks_like_junk(ln):
            continue
        if has_lat and not has_cyr:
            if _TITLE_STOP.search(ln) or not _TITLE_HINT.search(ln):
                continue
            if len(ln.split()) < 2:
                continue
            candidate = ln.title() if ln.isupper() else ln
            score = _score_title(candidate)
            if best_en is None or score > best_en[0]:
                best_en = (score, candidate)
        elif has_cyr:
            # Кириллица может соседствовать с латиницей (единицы, марки стали) —
            # это нормально для русского названия, поэтому has_lat не запрещаем.
            if _TITLE_STOP_RU.search(ln) or not _TITLE_HINT_RU.search(ln):
                continue
            if len(ln.split()) < 2:
                continue
            score = _score_title(ln)
            if best_ru is None or score > best_ru[0]:
                best_ru = (score, ln)
    return (best_en[1] if best_en else None), (best_ru[1] if best_ru else None)


def parse_feed_file(file_name: str, raw: bytes) -> dict[str, Any]:
    """Главная функция: имя файла + содержимое → поля документа FEED.

    Шифр берём СНАЧАЛА из имени файла (надёжно для FEED — все файлы названы
    шифром), штамп — только фолбэк. Раньше штамп цеплял случайные числа из
    чертежей и давал мусорный шифр."""
    is_pdf = file_name.lower().endswith(".pdf")
    is_docx = file_name.lower().endswith(".docx")

    # Текст извлекаем ОДИН раз и переиспользуем и для метаданных, и для поиска.
    # pypdf на векторных чертежах медленный (~1с/стр); берём достаточно
    # страниц для качественного поиска (прогресс загрузки показываем на UI).
    text = ""
    if is_pdf:
        text = extract_pdf_text(raw, max_pages=12) or _extract_text_pdftotext(raw)
    elif is_docx:
        text = extract_docx_text(raw)
    text_upper = (text or "").upper()

    # 1. Имя файла — приоритетный и надёжный источник (структурный разбор).
    doc_number, rev = (None, None)
    lang_from_name = None
    file_kind = "REVISION"
    detected_from = "none"
    parsed_name = parse_filename_cipher(file_name)
    if parsed_name:
        doc_number = parsed_name["doc_number"]
        rev = parsed_name["rev"]
        lang_from_name = parsed_name["lang"]
        file_kind = parsed_name["kind"] or "REVISION"
        detected_from = "filename"
    else:
        # 2. Фолбэк — старое эвристическое имя, затем штамп.
        cipher = cipher_from_filename(file_name)
        if not cipher and text_upper:
            cipher = _extract_cipher_from_text(text_upper)
            if cipher:
                detected_from = "stamp"
        if cipher:
            if detected_from == "none":
                detected_from = "filename"
            cipher, lang_from_name = split_lang(cipher)
            doc_number, rev = split_rev(cipher)

    stamp_rev, stamp_date, purpose = (None, None, None)
    if text_upper:
        stamp_rev, stamp_date, purpose = _extract_stamp_triplet(text_upper)
    rev = rev or stamp_rev

    doc_class = detect_class(text_upper) if text_upper else None
    # Язык: суффикс имени файла надёжнее распознавания по тексту.
    language = lang_from_name or (detect_language(text) if text else "NA")
    title_en, title_ru = extract_titles(text) if text else (None, None)

    components = parse_components(doc_number) if doc_number else {"discipline": None, "doc_type": None}

    # Поисковый текст — тот же извлечённый текст (повторно PDF не парсим).
    search_text = (text or "")[:200_000]

    return {
        "doc_number": doc_number,
        "rev": rev,
        "rev_date": stamp_date,
        "issue_purpose": purpose,
        "doc_class": doc_class,
        "language": language,
        "kind": file_kind,
        "title_en": title_en,
        "title_ru": title_ru,
        "discipline": components.get("discipline"),
        "doc_type": components.get("doc_type"),
        "detected_from": detected_from,
        "search_text": search_text,
    }
