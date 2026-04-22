from __future__ import annotations

import argparse
from pathlib import Path

from app.services.smart_upload import extract_document_metadata, store_upload_set


def main() -> None:
    parser = argparse.ArgumentParser(description="Run smart upload demo against one PDF.")
    parser.add_argument("pdf_path", type=Path, help="Absolute or relative path to PDF file")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("/tmp/tdo_smart_upload_demo"),
        help="Directory where hierarchy will be created",
    )
    parser.add_argument(
        "--related",
        type=Path,
        nargs="*",
        default=[],
        help="Additional related files to place in the same hierarchy",
    )
    parser.add_argument(
        "--full-cipher",
        type=str,
        default=None,
        help="Manual override for extracted full cipher",
    )
    args = parser.parse_args()

    pdf_path: Path = args.pdf_path
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    pdf_bytes = pdf_path.read_bytes()
    parsed = extract_document_metadata(pdf_bytes, pdf_path.name)
    fields = dict(parsed["fields"])
    if args.full_cipher:
        chunks = [item.strip().upper() for item in args.full_cipher.split("-")]
        while len(chunks) < 8:
            chunks.append("00")
        fields["full_cipher"] = args.full_cipher.upper()
        fields["project"] = chunks[0]
        fields["phase"] = chunks[1]
        fields["unit"] = chunks[2]
        fields["title_code"] = chunks[3]
        fields["discipline"] = chunks[4]
        fields["doc_type"] = chunks[5]
        fields["serial"] = chunks[6]
        fields["revision"] = chunks[7]

    related_payload: list[tuple[str, bytes]] = []
    for rel_path in args.related:
        if rel_path.exists() and rel_path.is_file():
            related_payload.append((rel_path.name, rel_path.read_bytes()))

    stored = store_upload_set(
        storage_root=args.output_root,
        pdf_name=pdf_path.name,
        pdf_bytes=pdf_bytes,
        related_files=related_payload,
        fields=fields,
        metadata={
            "fields": fields,
            "confidence": parsed["confidence"],
            "source": parsed.get("source"),
            "requires_confirmation": parsed.get("requires_confirmation"),
        },
    )

    print("Extracted fields:")
    for key, value in fields.items():
        print(f"  {key}: {value}")
    print(f"Confidence: {parsed['confidence']}")
    print(f"Source: {parsed.get('source')}")
    print(f"Requires confirmation: {parsed.get('requires_confirmation')}")
    print(f"Hierarchy: {stored['hierarchy']}")
    print(f"Destination: {stored['destination']}")
    if stored["related_paths"]:
        print("Related files:")
        for item in stored["related_paths"]:
            print(f"  {item}")


if __name__ == "__main__":
    main()
