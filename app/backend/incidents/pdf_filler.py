"""Fill the official ICS Canada form PDFs with extracted/edited field values.

The official forms in `ics_pdf_templates/` are interactive AcroForm PDFs whose field
names were captured into `ics_pdf_templates/schemas.json` at build time (see the SME's
2026 Forms Catalogue). To export a filled form we open the official template, write the
user's values into the named fields, and return the bytes — the output is pixel-identical
to the official form because we ARE the official form.

This is the underpinning for the SME-supplied ICS forms work (BACKLOG.md → "Faithful
form/report templates"). Generic across all 11 forms; no per-form rendering code needed.
"""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

_TEMPLATES_DIR = Path(__file__).parent / "ics_pdf_templates"
_SCHEMAS_PATH = _TEMPLATES_DIR / "schemas.json"

_SCHEMAS_CACHE: dict[str, Any] | None = None


def load_schemas() -> dict[str, Any]:
    """Lazy-load the per-form schema map (form_id -> { fields, title, pdf_file, ... })."""
    global _SCHEMAS_CACHE
    if _SCHEMAS_CACHE is None:
        _SCHEMAS_CACHE = json.loads(_SCHEMAS_PATH.read_text(encoding="utf-8"))
    return _SCHEMAS_CACHE


def get_form_schema(form_id_key: str) -> dict[str, Any]:
    """Look up a form by its key (e.g. "ics_201"). Raises ValueError if unknown."""
    schemas = load_schemas()
    if form_id_key not in schemas:
        raise ValueError(f"Unknown ICS form id: {form_id_key}")
    return schemas[form_id_key]


def list_form_ids() -> list[str]:
    """All known ICS form keys."""
    return list(load_schemas().keys())


def fill_form_pdf(form_id_key: str, field_values: dict[str, str]) -> bytes:
    """Open the official PDF template for `form_id_key`, fill in `field_values`, return bytes.

    Field names must match the AcroForm names captured in schemas.json. Missing fields are
    left blank in the output; unknown fields are silently ignored by pypdf's update call.
    """
    schema = get_form_schema(form_id_key)
    template_path = _TEMPLATES_DIR / schema["pdf_file"]
    if not template_path.exists():
        raise FileNotFoundError(f"PDF template missing: {template_path}")

    reader = PdfReader(str(template_path))
    writer = PdfWriter(clone_from=reader)

    # Coerce all values to strings; pypdf wants string values for text fields.
    normalized = {k: ("" if v is None else str(v)) for k, v in field_values.items()}

    # Update fields on each page that carries any; pypdf raises if a page has no fields,
    # so we wrap per-page to skip cleanly.
    for page in writer.pages:
        try:
            writer.update_page_form_field_values(page, normalized)
        except Exception:
            # No fields on this page — that's fine, skip it.
            continue

    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()
