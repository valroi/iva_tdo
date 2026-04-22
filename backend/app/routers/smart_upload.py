from __future__ import annotations

from pathlib import Path
from typing import Any

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

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
    fields["document_category"] = chunks[1]
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


class SmartUploadBatchProcessResponse(BaseModel):
    total: int
    processed: int
    items: list[SmartUploadProcessResponse]


class SmartUploadTreeNode(BaseModel):
    key: str
    name: str
    node_type: str
    relative_path: str
    is_pdf: bool = False
    children: list["SmartUploadTreeNode"] = Field(default_factory=list)


class SmartUploadRegistryItem(BaseModel):
    full_cipher: str
    cipher_no_revision: str
    revision: str
    project: str
    document_category: str
    discipline: str
    title_code: str
    title_text: str | None = None
    hierarchy: str
    destination: str
    pdf_name: str
    pdf_relative_path: str
    source: str
    confidence: float


def _resolve_relative_path(relative_path: str) -> Path:
    target = (SMART_UPLOAD_ROOT / relative_path).resolve()
    root = SMART_UPLOAD_ROOT.resolve()
    if root not in target.parents and target != root:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    return target


def _build_tree(path: Path, root: Path) -> list[SmartUploadTreeNode]:
    if not path.exists():
        return []
    nodes: list[SmartUploadTreeNode] = []
    for item in sorted(path.iterdir(), key=lambda x: (x.is_file(), x.name.lower())):
        relative_path = str(item.relative_to(root))
        if item.is_dir():
            nodes.append(
                SmartUploadTreeNode(
                    key=relative_path,
                    name=item.name,
                    node_type="directory",
                    relative_path=relative_path,
                    children=_build_tree(item, root),
                )
            )
            continue
        is_pdf = item.suffix.lower() == ".pdf"
        nodes.append(
            SmartUploadTreeNode(
                key=relative_path,
                name=item.name,
                node_type="file",
                relative_path=relative_path,
                is_pdf=is_pdf,
                children=[],
            )
        )
    return nodes


def _build_registry(root: Path) -> list[SmartUploadRegistryItem]:
    if not root.exists():
        return []
    rows: list[SmartUploadRegistryItem] = []
    for metadata_path in root.rglob("_smart_upload_result.json"):
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        fields = payload.get("fields") or {}
        if not isinstance(fields, dict):
            continue
        destination = metadata_path.parent
        pdf_files = sorted(destination.glob("*.pdf"))
        if not pdf_files:
            continue
        pdf_path = pdf_files[0]
        full_cipher = str(fields.get("full_cipher") or pdf_path.stem).upper()
        cipher_no_revision = "-".join(full_cipher.split("-")[:-1]) if "-" in full_cipher else full_cipher
        rows.append(
            SmartUploadRegistryItem(
                full_cipher=full_cipher,
                cipher_no_revision=cipher_no_revision,
                revision=str(fields.get("revision") or ""),
                project=str(fields.get("project") or ""),
                document_category=str(fields.get("document_category") or fields.get("phase") or ""),
                discipline=str(fields.get("discipline") or ""),
                title_code=str(fields.get("title_code") or ""),
                title_text=(str(fields.get("title_text")) if fields.get("title_text") is not None else None),
                hierarchy=str(destination.relative_to(root)),
                destination=str(destination),
                pdf_name=pdf_path.name,
                pdf_relative_path=str(pdf_path.relative_to(root)),
                source=str(payload.get("source") or ""),
                confidence=float(payload.get("confidence") or 0.0),
            )
        )
    rows.sort(key=lambda item: (item.project, item.cipher_no_revision, item.revision), reverse=False)
    return rows


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


@router.post("/process-batch", response_model=SmartUploadBatchProcessResponse)
async def process_smart_upload_batch(
    pdf_files: list[UploadFile] = File(...),
    _: User = Depends(require_permissions("can_upload_files")),
):
    items: list[SmartUploadProcessResponse] = []
    for pdf in pdf_files:
        pdf_bytes = await pdf.read()
        parsed = extract_document_metadata(pdf_bytes, pdf.filename or "document.pdf")
        fields = dict(parsed["fields"])
        stored = store_upload_set(
            storage_root=SMART_UPLOAD_ROOT,
            pdf_name=pdf.filename or "document.pdf",
            pdf_bytes=pdf_bytes,
            related_files=[],
            fields=fields,
            metadata={
                "fields": fields,
                "confidence": parsed["confidence"],
                "source": parsed["source"],
                "requires_confirmation": parsed["requires_confirmation"],
            },
        )
        items.append(
            SmartUploadProcessResponse(
                fields=fields,
                confidence=parsed["confidence"],
                source=parsed["source"],
                requires_confirmation=parsed["requires_confirmation"],
                hierarchy=stored["hierarchy"],
                destination=stored["destination"],
                pdf_path=stored["pdf_path"],
                related_paths=stored["related_paths"],
            )
        )
    return SmartUploadBatchProcessResponse(total=len(pdf_files), processed=len(items), items=items)


@router.get("/tree", response_model=list[SmartUploadTreeNode])
def list_smart_upload_tree(
    _: User = Depends(require_permissions("can_upload_files")),
):
    return _build_tree(SMART_UPLOAD_ROOT, SMART_UPLOAD_ROOT)


@router.get("/registry", response_model=list[SmartUploadRegistryItem])
def list_smart_upload_registry(
    _: User = Depends(require_permissions("can_upload_files")),
):
    return _build_registry(SMART_UPLOAD_ROOT)


@router.get("/file")
def get_smart_upload_file(
    relative_path: str,
    _: User = Depends(require_permissions("can_upload_files")),
):
    target = _resolve_relative_path(relative_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    media_type = "application/pdf" if target.suffix.lower() == ".pdf" else "application/octet-stream"
    return FileResponse(path=target, filename=target.name, media_type=media_type)
