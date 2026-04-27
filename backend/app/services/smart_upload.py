from __future__ import annotations

import io
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - optional dependency fallback
    PdfReader = None


FULL_CIPHER_RE = re.compile(
    r"\b([A-Z0-9]{2,}-[A-Z0-9]{2,}-[A-Z0-9]{2,}-[A-Z0-9]{2,}-[A-Z0-9]{2,}-[A-Z0-9]{2,}-[A-Z0-9]{2,4}-[A-Z0-9]{2,})\b"
)
SPACED_CIPHER_RE = re.compile(
    r"\b([A-Z0-9]{2,})[\s\-]+([A-Z0-9]{2,})[\s\-]+([A-Z0-9]{2,})[\s\-]+([A-Z0-9]{2,})[\s\-]+([A-Z0-9]{2,})[\s\-]+([A-Z0-9]{2,})[\s\-]+([A-Z0-9]{2,4})[\s\-]+([A-Z0-9]{2})\b"
)
GENERIC_TITLE_PREFIXES = ("page ", "class:", "doc. type", "project", "-- ")
ISSUE_PURPOSE_MAP = {
    "APPROVAL": "IFA",
    "REVIEW": "IFR",
    "CONSTRUCTION": "IFC",
    "DESIGN": "IFD",
    "FINAL": "FIN",
    "AS-BUILT": "ASB",
}
INVALID_LABEL_VALUES = {"PROJECT", "PHASE", "UNIT", "TITLE", "SERIAL", "REV", "DISC", "DOC", "TYPE", "CLASS"}


def _safe_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    token = token.strip("._-")
    return token or "unknown"


def _extract_text(pdf_bytes: bytes) -> str:
    if PdfReader is None:
        return ""

    reader = PdfReader(io.BytesIO(pdf_bytes))
    parts: list[str] = []
    for page in reader.pages[:3]:
        page_text = page.extract_text() or ""
        if page_text:
            parts.append(page_text)
    return "\n".join(parts)


def _extract_text_pdftotext(pdf_bytes: bytes) -> str:
    """Fallback extractor for scanned/problematic PDFs if pdftotext exists."""
    try:
        result = subprocess.run(
            ["pdftotext", "-", "-"],
            input=pdf_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except FileNotFoundError:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", errors="ignore")


def _parse_cipher(cipher: str) -> dict[str, str]:
    chunks = [item.strip().upper() for item in cipher.split("-")]
    while len(chunks) < 8:
        chunks.append("00")
    return {
        "project": chunks[0],
        "phase": chunks[1],
        "document_category": chunks[1],
        "unit": chunks[2],
        "title_code": chunks[3],
        "discipline": chunks[4],
        "doc_type": chunks[5],
        "serial": chunks[6],
        "revision": chunks[7],
    }


def _extract_title(text: str) -> str | None:
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if len(line) < 8:
            continue
        lower_line = line.lower()
        if lower_line.startswith(GENERIC_TITLE_PREFIXES):
            continue
        if "device list" in lower_line or "system" in lower_line:
            return line
    return None


def _extract_english_labeled_line(text: str, label: str) -> str | None:
    # Handles bilingual stamp rows where the first (English) row should win.
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    for index, line in enumerate(lines):
        upper_line = line.upper()
        if not upper_line.startswith(label):
            continue
        value = re.sub(rf"^{re.escape(label)}\s*[:\-]?\s*", "", line, flags=re.IGNORECASE).strip()
        if value:
            return value
        if index + 1 < len(lines):
            next_line = lines[index + 1].strip()
            # Skip obvious RU helper line after bilingual label.
            if any(token in next_line.upper() for token in ["НАИМЕНОВАНИЕ", "КЛАСС", "ПРОЕКТА", "НОМЕР ДОКУМЕНТА"]):
                continue
            return next_line or None
    return None


def _extract_drawing_title_parts(text: str) -> tuple[str | None, str | None]:
    upper_text = text.upper()
    start_match = re.search(r"DRAWING\s+TITLE\s*:", upper_text)
    if not start_match:
        return None, None

    tail = text[start_match.end() :]
    stop_match = re.search(
        r"\n\s*(DOCUMENT\s+NO\.|CLASS\s*:|PROJECT\s+PHASE|OWNER\s*:|CONTRACTOR\s*:)",
        tail,
        flags=re.IGNORECASE,
    )
    block = tail[: stop_match.start()] if stop_match else tail[:400]
    lines = [re.sub(r"\s+", " ", line).strip(" .-") for line in block.splitlines() if line.strip()]

    ru_parts: list[str] = []
    en_parts: list[str] = []
    for raw in lines:
        line = raw
        line = re.sub(r"^НАИМЕНОВАНИЕ\s*:\s*", "", line, flags=re.IGNORECASE).strip()
        if not line:
            continue
        if "/" in line:
            left, right = [part.strip(" .-") for part in line.split("/", 1)]
            if left and re.search(r"[А-ЯЁ]", left.upper()):
                ru_parts.append(left)
            elif left:
                en_parts.append(left)
            if right and re.search(r"[A-Z]", right.upper()):
                en_parts.append(right)
            elif right:
                ru_parts.append(right)
            continue
        has_cyr = bool(re.search(r"[А-ЯЁ]", line.upper()))
        has_lat = bool(re.search(r"[A-Z]", line.upper()))
        if has_lat and not has_cyr:
            en_parts.append(line)
        elif has_cyr and not has_lat:
            ru_parts.append(line)
        elif has_lat and has_cyr:
            # Mixed line: prefer English tail if present.
            en_candidate = re.sub(r"^[^A-Za-z]*", "", line).strip(" .-")
            ru_candidate = re.sub(r"[^А-Яа-яЁё].*$", "", line).strip(" .-")
            if ru_candidate:
                ru_parts.append(ru_candidate)
            if en_candidate and re.search(r"[A-Z]", en_candidate.upper()):
                en_parts.append(en_candidate)

    en_title = " ".join(part for part in en_parts if part).strip() or None
    ru_title = " ".join(part for part in ru_parts if part).strip() or None
    return en_title, ru_title


def _extract_labeled_value(text_upper: str, labels: list[str], pattern: str) -> str | None:
    label_union = "|".join(re.escape(item) for item in labels)
    match = re.search(rf"(?:{label_union})\s*[:\-]?\s*({pattern})", text_upper)
    if match:
        value = match.group(1).strip().upper()
        if value in INVALID_LABEL_VALUES:
            return None
        return value
    return None


def _extract_cipher_from_text(text_upper: str) -> str | None:
    direct = FULL_CIPHER_RE.search(text_upper)
    if direct:
        candidate = direct.group(1)
        if _is_plausible_cipher(candidate):
            return candidate

    for match in SPACED_CIPHER_RE.finditer(text_upper):
        chunks = [part.strip().upper() for part in match.groups()]
        if len(chunks) != 8:
            continue
        if not chunks[6].isdigit() or not chunks[7].isdigit():
            continue
        if not re.search(r"[A-Z]", chunks[4]):
            continue
        if not re.search(r"[A-Z]", chunks[5]):
            continue
        if chunks[0] in INVALID_LABEL_VALUES or chunks[1] in INVALID_LABEL_VALUES:
            continue
        return "-".join(chunks)
    return None


def _is_plausible_cipher(cipher: str) -> bool:
    parts = [p.strip().upper() for p in cipher.split("-") if p.strip()]
    if len(parts) < 8:
        return False
    discipline = parts[4]
    doc_type = parts[5]
    serial = parts[6]
    revision = parts[7]
    if discipline == doc_type:
        return False
    if not serial.isdigit() or not revision.isdigit():
        return False
    return True


def _extract_stamp_triplet(text_upper: str) -> tuple[str | None, str | None, str | None]:
    # Typical stamp row: "00 24.FEB.2026 ISSUED FOR APPROVAL ..."
    match = re.search(
        r"\b([0-9]{2}|[A-Z]{1,2})\s+(\d{1,2}[.\-/][A-Z]{3}[.\-/]\d{4})\s+ISSUED\s+FOR\s+([A-Z\- ]{3,40})",
        text_upper,
    )
    if not match:
        return None, None, None
    revision = match.group(1).strip().upper()
    date_raw = match.group(2).strip().upper().replace("-", ".").replace("/", ".")
    purpose_raw = match.group(3).strip().upper()
    purpose_code = ""
    for key, code in ISSUE_PURPOSE_MAP.items():
        if key in purpose_raw:
            purpose_code = code
            break
    if not purpose_code and purpose_raw in {"IFA", "IFR", "IFD", "IFC", "FIN", "AFD"}:
        purpose_code = purpose_raw
    return revision, date_raw, purpose_code or None


def _normalize_issue_purpose(value: str | None) -> str:
    raw = (value or "").strip().upper()
    if not raw:
        return ""
    if raw in {"IFA", "IFR", "IFD", "IFC", "FIN", "AFD", "ASB"}:
        return raw
    for key, code in ISSUE_PURPOSE_MAP.items():
        if key in raw:
            return code
    return raw


def _extract_date(text_upper: str) -> str | None:
    # Supports: 17.Mar.2026, 17 MAR.2026, 17-Mar-2026
    match = re.search(r"\b(\d{1,2})[.\-/\s]+([A-Z]{3})[.\-/\s]+(\d{4})\b", text_upper)
    if not match:
        return None
    day = int(match.group(1))
    month_name = match.group(2)
    year = int(match.group(3))
    months = {
        "JAN": 1,
        "FEB": 2,
        "MAR": 3,
        "APR": 4,
        "MAY": 5,
        "JUN": 6,
        "JUL": 7,
        "AUG": 8,
        "SEP": 9,
        "OCT": 10,
        "NOV": 11,
        "DEC": 12,
    }
    month = months.get(month_name)
    if not month:
        return None
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _extract_revision_rows(text_upper: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    pattern = re.compile(
        r"\b([0-9]{2}|[A-Z]{1,2})\s+(\d{1,2}[.\-/\s]+[A-Z]{3}[.\-/\s]+\d{4})\s+ISSUED\s+FOR\s+([A-Z\- ]{3,60})"
    )
    for match in pattern.finditer(text_upper):
        rev = match.group(1).strip().upper()
        date_raw = re.sub(r"\s+", ".", match.group(2).strip().upper())
        purpose_raw = match.group(3).strip().upper()
        rows.append((rev, date_raw, purpose_raw))
    return rows


def _extract_components_from_title_block(text_upper: str) -> dict[str, str]:
    # Typical title block value row:
    # IMP FD 90 05 ST DWG 196 01
    header = re.search(r"PROJECT\s+PHASE\s+UNIT\s+TITLE\s+DISC\.?\s+DOC\.?\s*TYPE\s+SERIAL\s+REV\.?", text_upper)
    if not header:
        return {}
    tail = text_upper[header.end() : header.end() + 800]
    value_row = re.search(
        r"\b([A-Z0-9]{2,8})\s+([A-Z0-9]{2,8})\s+([A-Z0-9]{1,4})\s+([A-Z0-9]{1,4})\s+([A-Z0-9]{1,8})\s+([A-Z0-9]{2,8})\s+([A-Z0-9]{2,4})\s+([A-Z0-9]{2,4})\b",
        tail,
    )
    if not value_row:
        return {}
    return {
        "project": value_row.group(1),
        "phase": value_row.group(2),
        "unit": value_row.group(3),
        "title_code": value_row.group(4),
        "discipline": value_row.group(5),
        "doc_type": value_row.group(6),
        "serial": value_row.group(7),
        "revision": value_row.group(8),
    }


def _compose_full_cipher_from_components(fields: dict[str, str]) -> str | None:
    required = ["project", "phase", "discipline", "doc_type", "serial", "revision"]
    if any(not fields.get(key) for key in required):
        return None
    return "-".join(
        [
            fields["project"],
            fields["phase"],
            fields.get("unit") or "00",
            fields.get("title_code") or "00",
            fields["discipline"],
            fields["doc_type"],
            fields["serial"],
            fields["revision"],
        ]
    )


def extract_document_metadata(pdf_bytes: bytes, file_name: str) -> dict[str, Any]:
    text = _extract_text(pdf_bytes)
    source = "pdf_text"
    if not text.strip():
        text = _extract_text_pdftotext(pdf_bytes)
        if text.strip():
            source = "ocr_fallback"
    upper_text = text.upper()
    filename_without_ext = Path(file_name).stem.upper()

    block_components = _extract_components_from_title_block(upper_text)
    project = block_components.get("project") or _extract_labeled_value(upper_text, ["PROJECT"], r"[A-Z0-9]{2,8}")
    phase = block_components.get("phase") or _extract_labeled_value(upper_text, ["PHASE"], r"[A-Z0-9]{2,8}")
    discipline = block_components.get("discipline") or _extract_labeled_value(upper_text, ["DISC", "DISC.", "DISCIPLINE"], r"[A-Z]{1,8}")
    doc_type = block_components.get("doc_type") or _extract_labeled_value(upper_text, ["DOC TYPE", "DOC. TYPE"], r"[A-Z]{2,8}")
    serial = block_components.get("serial") or _extract_labeled_value(upper_text, ["SERIAL"], r"[A-Z0-9]{2,4}")
    revision = block_components.get("revision") or _extract_labeled_value(upper_text, ["REV", "REV."], r"[A-Z0-9]{1,4}")
    drawing_title_en, drawing_title_ru = _extract_drawing_title_parts(text)
    class_from_stamp = _extract_english_labeled_line(text, "DRAWING TITLE")
    title_from_stamp = _extract_english_labeled_line(text, "CLASS")
    document_class = _extract_labeled_value(upper_text, ["CLASS", "CLASS:"], r"[A-Z0-9]{1,8}")
    if title_from_stamp:
        class_match = re.search(r"\b([0-9A-Z]{1,4})\b", title_from_stamp.upper())
        if class_match:
            document_class = class_match.group(1)
    issue_purpose = _extract_labeled_value(
        upper_text,
        ["ISSUED FOR", "DESCRIPTION"],
        r"(REVIEW|APPROVAL|CONSTRUCTION|IFR|IFA|IFC|IFD|AFD|AS-BUILT)",
    )
    development_date = _extract_date(upper_text)
    revision_rows = _extract_revision_rows(upper_text)
    if revision_rows:
        latest_rev, latest_date_raw, latest_purpose_raw = revision_rows[0]
        revision = latest_rev or revision
        parsed_latest_date = _extract_date(latest_date_raw)
        if parsed_latest_date:
            development_date = parsed_latest_date
        issue_purpose = _normalize_issue_purpose(latest_purpose_raw) or issue_purpose
    else:
        stamp_revision, stamp_date_raw, stamp_purpose = _extract_stamp_triplet(upper_text)
        if stamp_revision:
            revision = stamp_revision
        if stamp_date_raw:
            parsed_stamp_date = _extract_date(stamp_date_raw)
            if parsed_stamp_date:
                development_date = parsed_stamp_date
        if stamp_purpose:
            issue_purpose = stamp_purpose

    text_cipher = _extract_cipher_from_text(upper_text)
    filename_match = FULL_CIPHER_RE.search(filename_without_ext)
    if text_cipher and _is_plausible_cipher(text_cipher):
        full_cipher = text_cipher
    elif filename_match:
        full_cipher = filename_match.group(1)
    else:
        composed = _compose_full_cipher_from_components(
            {
                "project": project or "",
                "phase": phase or "",
                "discipline": discipline or "",
                "doc_type": doc_type or "",
                "serial": serial or "",
                "revision": revision or "",
                "unit": "00",
                "title_code": "00",
            }
        )
        full_cipher = composed or filename_without_ext
    parsed = _parse_cipher(full_cipher)
    title_text = drawing_title_en or class_from_stamp or _extract_title(text)
    has_reliable_cipher = bool(text_cipher or filename_match)

    merged_for_cipher = {
        "project": parsed["project"] if has_reliable_cipher else (project or parsed["project"]),
        "phase": parsed["phase"] if has_reliable_cipher else (phase or parsed["phase"]),
        "discipline": parsed["discipline"] if has_reliable_cipher else (discipline or parsed["discipline"]),
        "doc_type": parsed["doc_type"] if has_reliable_cipher else (doc_type or parsed["doc_type"]),
        "serial": parsed["serial"] if has_reliable_cipher else (serial or parsed["serial"]),
        "revision": revision or parsed["revision"],
        "unit": block_components.get("unit") or parsed["unit"],
        "title_code": block_components.get("title_code") or parsed["title_code"],
    }
    if merged_for_cipher.get("revision", "").isdigit() and len(merged_for_cipher["revision"]) == 1:
        merged_for_cipher["revision"] = f"0{merged_for_cipher['revision']}"
    recomposed_cipher = _compose_full_cipher_from_components(merged_for_cipher)
    if recomposed_cipher:
        full_cipher = recomposed_cipher
        parsed = _parse_cipher(full_cipher)

    fields = {
        "cipher": full_cipher,
        "full_cipher": full_cipher,
        "project": parsed["project"] if has_reliable_cipher else (project or parsed["project"]),
        "phase": parsed["phase"] if has_reliable_cipher else (phase or parsed["phase"]),
        "document_category": parsed["document_category"] if has_reliable_cipher else (phase or parsed["document_category"]),
        "document_class": document_class or "",
        "unit": block_components.get("unit") or parsed["unit"],
        "title_code": block_components.get("title_code") or parsed["title_code"],
        "discipline": parsed["discipline"] if has_reliable_cipher else (discipline or parsed["discipline"]),
        "doc_type": parsed["doc_type"] if has_reliable_cipher else (doc_type or parsed["doc_type"]),
        "serial": parsed["serial"] if has_reliable_cipher else (serial or parsed["serial"]),
        "revision": revision or parsed["revision"],
        "issue_purpose": _normalize_issue_purpose(issue_purpose),
        "development_date": development_date or "",
        "title_text": title_text,
        "title_text_ru": drawing_title_ru,
    }
    found_in_text = bool(text_cipher)
    composed_from_fields = not found_in_text and bool(project and phase and discipline and doc_type and serial and revision)
    confidence = 0.98 if found_in_text else (0.86 if composed_from_fields else 0.72)
    effective_source = source if found_in_text else ("composed_from_fields" if composed_from_fields else "file_name_fallback")
    return {
        "fields": fields,
        "confidence": confidence,
        "source": effective_source,
        "requires_confirmation": not found_in_text or confidence < 0.9,
    }


def build_target_hierarchy(fields: dict[str, Any]) -> str:
    full_cipher = str(fields.get("full_cipher", "")).upper()
    cipher_no_revision = "-".join(full_cipher.split("-")[:-1]) if "-" in full_cipher else full_cipher
    if not cipher_no_revision:
        cipher_no_revision = str(fields.get("serial", "unknown"))
    return "/".join(
        [
            _safe_token(str(fields.get("project", "unknown"))),
            _safe_token(str(fields.get("document_category", fields.get("phase", "unknown")))),
            _safe_token(str(fields.get("document_class", "unknown"))),
            _safe_token(str(fields.get("discipline", "unknown"))),
            _safe_token(str(fields.get("title_code", "unknown"))),
            _safe_token(str(fields.get("issue_purpose", "unknown"))),
            _safe_token(cipher_no_revision),
            _safe_token(str(fields.get("revision", "unknown"))),
        ]
    )


def store_upload_set(
    *,
    storage_root: Path,
    pdf_name: str,
    pdf_bytes: bytes,
    related_files: list[tuple[str, bytes]],
    fields: dict[str, Any],
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    job_id = str(uuid4())
    hierarchy = build_target_hierarchy(fields)
    destination = storage_root / hierarchy
    destination.mkdir(parents=True, exist_ok=True)

    pdf_destination = destination / _safe_token(pdf_name)
    pdf_destination.write_bytes(pdf_bytes)

    related_saved: list[str] = []
    for related_name, related_bytes in related_files:
        related_destination = destination / _safe_token(related_name)
        related_destination.write_bytes(related_bytes)
        related_saved.append(str(related_destination))

    if metadata:
        metadata_path = destination / "_smart_upload_result.json"
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=True, indent=2), encoding="utf-8")

    return {
        "job_id": job_id,
        "hierarchy": hierarchy,
        "destination": str(destination),
        "pdf_path": str(pdf_destination),
        "related_paths": related_saved,
    }
