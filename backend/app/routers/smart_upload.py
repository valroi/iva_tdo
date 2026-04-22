from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel

from app.deps import require_permissions
from app.models import User
from app.services.smart_upload import build_target_hierarchy, extract_document_metadata, store_upload_set

router = APIRouter(prefix="/smart-upload")
SMART_UPLOAD_ROOT = Path("/tmp/tdo_smart_upload")


class SmartUploadPreviewResponse(BaseModel):
    fields: dict[str, Any]
    confidence: float
    suggested_hierarchy: str


class SmartUploadProcessResponse(BaseModel):
    fields: dict[str, Any]
    confidence: float
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
        suggested_hierarchy=hierarchy,
    )


@router.post("/process", response_model=SmartUploadProcessResponse)
async def process_smart_upload(
    pdf: UploadFile = File(...),
    related_files: list[UploadFile] = File(default=[]),
    _: User = Depends(require_permissions("can_upload_files")),
):
    pdf_bytes = await pdf.read()
    parsed = extract_document_metadata(pdf_bytes, pdf.filename or "document.pdf")

    related_payload: list[tuple[str, bytes]] = []
    for item in related_files:
        related_payload.append((item.filename or "attachment.bin", await item.read()))

    stored = store_upload_set(
        storage_root=SMART_UPLOAD_ROOT,
        pdf_name=pdf.filename or "document.pdf",
        pdf_bytes=pdf_bytes,
        related_files=related_payload,
        fields=parsed["fields"],
    )

    return SmartUploadProcessResponse(
        fields=parsed["fields"],
        confidence=parsed["confidence"],
        hierarchy=stored["hierarchy"],
        destination=stored["destination"],
        pdf_path=stored["pdf_path"],
        related_paths=stored["related_paths"],
    )
