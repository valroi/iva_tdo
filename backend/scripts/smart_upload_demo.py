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
    args = parser.parse_args()

    pdf_path: Path = args.pdf_path
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    pdf_bytes = pdf_path.read_bytes()
    parsed = extract_document_metadata(pdf_bytes, pdf_path.name)
    stored = store_upload_set(
        storage_root=args.output_root,
        pdf_name=pdf_path.name,
        pdf_bytes=pdf_bytes,
        related_files=[],
        fields=parsed["fields"],
    )

    print("Extracted fields:")
    for key, value in parsed["fields"].items():
        print(f"  {key}: {value}")
    print(f"Confidence: {parsed['confidence']}")
    print(f"Hierarchy: {stored['hierarchy']}")
    print(f"Destination: {stored['destination']}")


if __name__ == "__main__":
    main()
