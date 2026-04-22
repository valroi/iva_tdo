from __future__ import annotations

import io
import json
import re
import subprocess
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
GENERIC_TITLE_PREFIXES = ("page ", "class:", "doc. type", "project", "-- ")


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


def _extract_labeled_value(text_upper: str, labels: list[str], pattern: str) -> str | None:
    label_union = "|".join(re.escape(item) for item in labels)
    match = re.search(rf"(?:{label_union})\s*[:\-]?\s*({pattern})", text_upper)
    if match:
        return match.group(1).strip().upper()
    return None


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

    project = _extract_labeled_value(upper_text, ["PROJECT"], r"[A-Z0-9]{2,8}")
    phase = _extract_labeled_value(upper_text, ["PHASE"], r"[A-Z0-9]{2,8}")
    discipline = _extract_labeled_value(upper_text, ["DISC", "DISC.", "DISCIPLINE"], r"[A-Z0-9]{1,8}")
    doc_type = _extract_labeled_value(upper_text, ["DOC TYPE", "DOC. TYPE"], r"[A-Z0-9]{2,8}")
    serial = _extract_labeled_value(upper_text, ["SERIAL"], r"[A-Z0-9]{2,4}")
    revision = _extract_labeled_value(upper_text, ["REV", "REV."], r"[A-Z0-9]{1,4}")

    match = FULL_CIPHER_RE.search(upper_text) or FULL_CIPHER_RE.search(filename_without_ext)
    if match:
        full_cipher = match.group(1)
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
    title_text = _extract_title(text)

    fields = {
        "full_cipher": full_cipher,
        "project": project or parsed["project"],
        "phase": phase or parsed["phase"],
        "document_category": phase or parsed["document_category"],
        "unit": parsed["unit"],
        "title_code": parsed["title_code"],
        "discipline": discipline or parsed["discipline"],
        "doc_type": doc_type or parsed["doc_type"],
        "serial": serial or parsed["serial"],
        "revision": revision or parsed["revision"],
        "title_text": title_text,
    }
    found_in_text = bool(match and FULL_CIPHER_RE.search(upper_text))
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
            _safe_token(str(fields.get("discipline", "unknown"))),
            _safe_token(str(fields.get("title_code", "unknown"))),
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
