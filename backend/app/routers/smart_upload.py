from __future__ import annotations

from pathlib import Path
from typing import Any

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.deps import require_permissions
from app.models import User
from app.services.smart_upload import (
    build_target_hierarchy,
    extract_document_metadata,
    store_upload_set,
)

router = APIRouter(prefix="/smart-upload")
SMART_UPLOAD_ROOT = Path("/tmp/tdo_smart_upload")


def _apply_full_cipher(fields: dict[str, Any], full_cipher: str) -> None:
    chunks = [item.strip().upper() for item in full_cipher.split("-")]
    while len(chunks) < 8:
        chunks.append("00")
    fields["full_cipher"] = full_cipher.upper()
    fields["project"] = chunks[0]
    fields["phase"] = chunks[1]
    fields["unit"] = chunks[2]
    fields["title_code"] = chunks[3]
    fields["discipline"] = chunks[4]
    fields["doc_type"] = chunks[5]
    fields["serial"] = chunks[6]
    fields["revision"] = chunks[7]


class SmartUploadPreviewResponse(BaseModel):
    fields: dict[str, Any]
    confidence: float
    source: str
    requires_confirmation: bool
    suggested_hierarchy: str


class SmartUploadProcessResponse(BaseModel):
    fields: dict[str, Any]
    confidence: float
    source: str
    requires_confirmation: bool
    hierarchy: str
    destination: str
    pdf_path: str
    related_paths: list[str]


@router.post("/preview", response_model=SmartUploadPreviewResponse)
async def preview_smart_upload(
    pdf: UploadFile = File(...),
    _: User = Depends(require_permissions("can_upload_files")),
):
    pdf_bytes = await pdf.read()
    parsed = extract_document_metadata(pdf_bytes, pdf.filename or "document.pdf")
    hierarchy = build_target_hierarchy(parsed["fields"])
    return SmartUploadPreviewResponse(
        fields=parsed["fields"],
        confidence=parsed["confidence"],
        source=parsed["source"],
        requires_confirmation=parsed["requires_confirmation"],
        suggested_hierarchy=hierarchy,
    )


@router.post("/process", response_model=SmartUploadProcessResponse)
async def process_smart_upload(
    pdf: UploadFile = File(...),
    related_files: list[UploadFile] = File(default=[]),
    overrides_json: str | None = Form(default=None),
    _: User = Depends(require_permissions("can_upload_files")),
):
    pdf_bytes = await pdf.read()
    parsed = extract_document_metadata(pdf_bytes, pdf.filename or "document.pdf")
    fields = dict(parsed["fields"])

    if overrides_json:
        try:
            overrides = json.loads(overrides_json)
            if not isinstance(overrides, dict):
                raise ValueError("overrides_json must be object")
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid overrides_json: {exc}",
            ) from exc
        for key, value in overrides.items():
            if key in fields and value is not None and str(value).strip():
                fields[key] = str(value).strip()
        if overrides.get("full_cipher"):
            _apply_full_cipher(fields, str(overrides["full_cipher"]))

    related_payload: list[tuple[str, bytes]] = []
    for item in related_files:
        related_payload.append((item.filename or "attachment.bin", await item.read()))

    stored = store_upload_set(
        storage_root=SMART_UPLOAD_ROOT,
        pdf_name=pdf.filename or "document.pdf",
        pdf_bytes=pdf_bytes,
        related_files=related_payload,
        fields=fields,
        metadata={
            "fields": fields,
            "confidence": parsed["confidence"],
            "source": parsed["source"],
            "requires_confirmation": parsed["requires_confirmation"],
        },
    )

    return SmartUploadProcessResponse(
        fields=fields,
        confidence=parsed["confidence"],
        source=parsed["source"],
        requires_confirmation=parsed["requires_confirmation"],
        hierarchy=stored["hierarchy"],
        destination=stored["destination"],
        pdf_path=stored["pdf_path"],
        related_paths=stored["related_paths"],
    )
