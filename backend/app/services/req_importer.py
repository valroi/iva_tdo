"""Импортёр REQ (.docx → структура MR).

Раскладывает документ-требование (Requisition) на:
  * шапку (тип оборудования, № REQ, дисциплина),
  * Material Summary List → теги,
  * List of Attachments → чек-лист заказчика (owner items),
  * RFD (Requirement for Documents) → чек-лист подрядчика (vendor items, RFD),
  * Bid Technical Check List → универсальный набор (фиксированный, одинаков
    во всех дисциплинах).

Парсинг устойчив к разным дисциплинам: таблицы ищутся по заголовкам столбцов,
а не по позиции. Bid Check List берётся из эталонного шаблона (он идентичен
во всех REQ), чтобы не зависеть от вёрстки конкретного файла.
"""

from __future__ import annotations

import re
import zipfile

# Универсальный Bid Technical Check List (идентичен во всех REQ).
BID_INCLUSION_ITEMS = [
    "Letter Of Conformity (Technical)",
    "List Of Inconsistencies",
    "Spare Part List",
    "Special Tools",
    "Manufacturing and Delivery Schedule",
    "Sub-Vendor List",
    "Quality Assurance Manual (or Certificate)",
    "Reference List",
]
BID_NOTES_ITEMS = [
    "English Language",
    "Units of Measurement",
    "Name Plate",
    "Ambient and Site Condition",
    "Progress Reporting",
    "Inspection Requirements",
    "Partial Delivery Conditions",
    "Document Requirements",
    "Purchaser’s Document Numbering Procedure",
    "Quality Dossier",
    "Final Vendor Data Book Preparation",
    "Final Document Delivery",
    "Filling the SPIR Form",
    "Master and Detailed Packing List",
    "Overall Responsibility",
    "Fabrication Start",
]

DISCIPLINE_NAMES = {
    "HM": "Heat & Mass Transfer Equipment",
    "IN": "Instrumentation",
    "PV": "Pressure Vessels",
    "RE": "Rotating Equipment",
    "PI": "Piping",
    "EL": "Electrical",
    "ST": "Structural",
}


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()


def _read_document_xml(path: str) -> str:
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    return re.sub(r"<w:instrText[^>]*>.*?</w:instrText>", "", xml, flags=re.S)


def _paragraphs(xml: str) -> list[str]:
    out = []
    for p in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        t = "".join(re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", p, re.S))
        t = _clean(t)
        if t:
            out.append(t)
    return out


def _tables(xml: str) -> list[list[list[str]]]:
    """Возвращает список таблиц; таблица — список строк; строка — список ячеек."""
    tables = []
    for tbl in re.findall(r"<w:tbl[ >].*?</w:tbl>", xml, re.S):
        rows = []
        for tr in re.findall(r"<w:tr[ >].*?</w:tr>", tbl, re.S):
            cells = []
            for tc in re.findall(r"<w:tc[ >].*?</w:tc>", tr, re.S):
                t = "".join(re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", tc, re.S))
                cells.append(_clean(t))
            rows.append(cells)
        if rows:
            tables.append(rows)
    return tables


def _header_matches(row: list[str], keywords: list[str]) -> bool:
    joined = " ".join(c.lower() for c in row)
    return all(any(kw in c.lower() for c in row) for kw in keywords)


def _find_table(tables, keywords):
    for tbl in tables:
        for r in tbl[:3]:  # заголовок обычно в первых строках
            if _header_matches(r, keywords):
                return tbl
    return None


def parse_req(path: str, filename: str) -> dict:
    xml = _read_document_xml(path)
    paras = _paragraphs(xml)
    tables = _tables(xml)

    title = paras[0] if paras else "Requisition"
    equipment_type = None
    m = re.search(r"Requisition\s+for\s+(.+)", title, re.I)
    if m:
        equipment_type = m.group(1).strip()

    # № REQ и дисциплина из имени файла: IMP-FD-00-00-HM-REQ-262-00
    req_number = None
    discipline = None
    fm = re.search(r"([A-Z]{2,3}-[A-Z]{2}-\d+-\d+-([A-Z]{2})-REQ-\w+(?:-\w+)?)", filename)
    if fm:
        req_number = fm.group(1)
        discipline = fm.group(2)

    # --- Material Summary → теги ---
    tags = []
    mat = _find_table(tables, ["item", "description", "qty"]) or _find_table(
        tables, ["item", "description", "quantity"]
    )
    if mat:
        header = [c.lower() for c in mat[0]]

        def col(*names):
            for i, h in enumerate(header):
                if any(n in h for n in names):
                    return i
            return None

        c_sr, c_item, c_desc, c_qty, c_rem = (
            col("sr", "s.no", "no."),
            col("item no", "item"),
            col("description"),
            col("qty", "quantity"),
            col("remark"),
        )
        for r in mat[1:]:
            if not any(r):
                continue
            desc = r[c_desc] if c_desc is not None and c_desc < len(r) else ""
            if not desc:
                continue
            item_no = r[c_item] if c_item is not None and c_item < len(r) else ""
            qty_raw = r[c_qty] if c_qty is not None and c_qty < len(r) else ""
            qty = None
            qm = re.search(r"[\d.,]+", qty_raw)
            if qm:
                try:
                    qty = float(qm.group(0).replace(",", "."))
                except ValueError:
                    qty = None
            unit = None
            um = re.search(r"\b(set|pcs?|ea|шт|компл|set\(s\))\b", qty_raw, re.I)
            if um:
                unit = um.group(1)
            tags.append(
                {
                    "sr_no": (r[c_sr] if c_sr is not None and c_sr < len(r) else "") or None,
                    "item_no": item_no or None,
                    "tag_code": item_no or desc[:40],
                    "name": desc,
                    "quantity": qty,
                    "unit": unit,
                    "note": (r[c_rem] if c_rem is not None and c_rem < len(r) else "") or None,
                }
            )

    # --- List of Attachments → owner items ---
    owner_items = []
    att = _find_table(tables, ["description", "document no"]) or _find_table(
        tables, ["att", "description"]
    )
    if att:
        header = [c.lower() for c in att[0]]

        def acol(*names):
            for i, h in enumerate(header):
                if any(n in h for n in names):
                    return i
            return None

        a_no, a_desc, a_doc, a_rev = (
            acol("att"),
            acol("description"),
            acol("document no", "doc"),
            acol("rev"),
        )
        rows_raw = []
        for r in att[1:]:
            if not any(r):
                continue
            desc = r[a_desc] if a_desc is not None and a_desc < len(r) else ""
            if not desc or desc.lower() in ("description",):
                continue
            rows_raw.append(
                {
                    "att_no": (r[a_no] if a_no is not None and a_no < len(r) else "").strip() or None,
                    "title": desc,
                    "doc_number": (r[a_doc] if a_doc is not None and a_doc < len(r) else "") or None,
                    "rev": (r[a_rev] if a_rev is not None and a_rev < len(r) else "") or None,
                }
            )
        # Группа-заголовок: att_no без точки, у которого есть дочерние
        # позиции вида "{att_no}.N". На такие нельзя грузить файл.
        all_nos = [row["att_no"] for row in rows_raw if row["att_no"]]
        for row in rows_raw:
            ano = row["att_no"] or ""
            is_group = bool(ano) and "." not in ano and any(
                other != ano and other.startswith(ano + ".") for other in all_nos
            )
            cat = _guess_owner_category(row["title"])
            owner_items.append(
                {
                    "att_no": row["att_no"],
                    "category": cat,
                    "title": row["title"],
                    "doc_number": row["doc_number"],
                    "rev": row["rev"],
                    "is_required": not is_group,
                    "allow_questions": (not is_group) and cat in ("DATASHEET", "SPEC", "DRAWING"),
                    "is_group": is_group,
                }
            )

    # --- RFD → vendor items (section RFD) ---
    vendor_items = []
    order = 0
    # Bid Check List (универсальный)
    for t in BID_INCLUSION_ITEMS:
        vendor_items.append(
            {"section": "BID_INCLUSION", "category": None, "code": None, "title": t,
             "purpose": None, "with_bid": True, "is_required": True, "allow_questions": False, "order_index": order}
        )
        order += 1
    for t in BID_NOTES_ITEMS:
        vendor_items.append(
            {"section": "BID_NOTES", "category": None, "code": None, "title": t,
             "purpose": None, "with_bid": False, "is_required": True, "allow_questions": False, "order_index": order}
        )
        order += 1

    rfd = _find_table(tables, ["code", "document title"]) or _find_table(tables, ["code", "title"])
    if rfd:
        header = [c.lower() for c in rfd[0]]

        def rcol(*names):
            for i, h in enumerate(header):
                if any(n in h for n in names):
                    return i
            return None

        r_code, r_title, r_purp = rcol("code"), rcol("document title", "title"), rcol("purpose")
        current_cat = "technical"
        for r in rfd[1:]:
            if not any(r):
                continue
            code = (r[r_code] if r_code is not None and r_code < len(r) else "").strip()
            ttl = (r[r_title] if r_title is not None and r_title < len(r) else "").strip()
            # Строка-заголовок группы (нет кода, есть только текст в одной ячейке)
            if not code and ttl and ttl.isupper():
                low = ttl.lower()
                current_cat = "scheduling" if "schedul" in low else "quality" if "quality" in low else "technical"
                continue
            if not ttl:
                continue
            purpose = None
            pm = re.search(r"\b([RIA])\b", (r[r_purp] if r_purp is not None and r_purp < len(r) else ""))
            if pm:
                purpose = pm.group(1)
            vendor_items.append(
                {
                    "section": "RFD",
                    "category": current_cat,
                    "code": code or None,
                    "title": ttl,
                    "purpose": purpose,
                    "with_bid": False,
                    "is_required": True,
                    "allow_questions": True,
                    "order_index": order,
                }
            )
            order += 1

    return {
        "title": title,
        "equipment_type": equipment_type,
        "req_number": req_number,
        "discipline_code": discipline,
        "tags": tags,
        "owner_items": owner_items,
        "vendor_items": vendor_items,
    }


def _guess_owner_category(desc: str) -> str:
    d = desc.lower()
    if "check list" in d or "conformity" in d:
        return "CHECKLIST_FORM"
    if "requirement for documents" in d or "rfd" in d:
        return "RFD"
    if "spare" in d or "spir" in d:
        return "SPARE"
    if "inspection" in d:
        return "INSPECTION"
    if "procedure" in d:
        return "PROCEDURE"
    if "datasheet" in d or "data sheet" in d:
        return "DATASHEET"
    if "specification" in d:
        return "SPEC"
    if "drawing" in d:
        return "DRAWING"
    return "OTHER"
