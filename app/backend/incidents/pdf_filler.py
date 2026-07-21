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
_CURATION_PATH = _TEMPLATES_DIR / "field_curation.json"

_SCHEMAS_CACHE: dict[str, Any] | None = None


def load_schemas() -> dict[str, Any]:
    """Lazy-load the per-form schema map (form_id -> { fields, title, pdf_file, ... }).

    Hand-curated field metadata from `field_curation.json` (label overrides, fill guidance,
    ai_fill flags — see BACKLOG "ICS forms Phase 3") is merged onto the machine-generated
    schema at load time, so the /api/ics-forms/schemas endpoint, the form editor, and the
    AI fill prompt all read one merged view.
    """
    global _SCHEMAS_CACHE
    if _SCHEMAS_CACHE is None:
        schemas = json.loads(_SCHEMAS_PATH.read_text(encoding="utf-8"))
        if _CURATION_PATH.exists():
            curation = json.loads(_CURATION_PATH.read_text(encoding="utf-8"))
            for form_key, form_curation in curation.items():
                if form_key.startswith("_") or form_key not in schemas:
                    continue  # _readme etc., or curation for a form we don't ship
                curated_fields = form_curation.get("fields", {})
                for field in schemas[form_key]["fields"]:
                    override = curated_fields.get(field["name"])
                    if override is None:
                        continue
                    if override.get("label"):
                        field["label"] = override["label"]
                    if override.get("guidance"):
                        field["guidance"] = override["guidance"]
                    field["ai_fill"] = bool(override.get("ai_fill", False))
        _SCHEMAS_CACHE = schemas
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


def ai_fillable_fields(form_id_key: str) -> list[dict[str, Any]]:
    """The curated subset of a form's fields the fill LLM should attempt to populate.

    Each entry carries name / label / type / guidance. Empty list when the form has no
    curation yet (= AI fill is skipped for that form; see extract_forms.py).
    """
    schema = get_form_schema(form_id_key)
    return [f for f in schema["fields"] if f.get("ai_fill")]


# Truthy spellings the fill LLM (or a human editor) may use for a checked checkbox.
_CHECKBOX_TRUTHY = {"yes", "true", "checked", "x", "on", "1", "/yes"}

# Typographic characters LLM output loves that the official forms' embedded font encodings
# often can't represent (pypdf warns "characters not supported by font encoding"). Mapped to
# plain-ASCII equivalents so the filled text never corrupts in a strict PDF viewer.
_TRANSLITERATE = str.maketrans(
    {
        "—": "-",  # em dash
        "–": "-",  # en dash
        "‘": "'",  # left single quote
        "’": "'",  # right single quote
        "“": '"',  # left double quote
        "”": '"',  # right double quote
        "…": "...",  # ellipsis
        " ": " ",  # non-breaking space
        "•": "-",  # bullet
        "×": "x",  # multiplication sign
    }
)


def sanitize_field_text(value: str) -> str:
    """Replace typographic characters with ASCII equivalents safe for the form fonts."""
    return value.translate(_TRANSLITERATE)


def fill_form_pdf(form_id_key: str, field_values: dict[str, str]) -> bytes:
    """Open the official PDF template for `form_id_key`, fill in `field_values`, return bytes.

    Field names must match the AcroForm names captured in schemas.json. Missing fields are
    left blank in the output; unknown fields are silently ignored by pypdf's update call.
    Checkbox ("button") fields accept yes/true/checked/x/on/1 (case-insensitive) as checked;
    anything else leaves them unchecked — the ICS templates all use /Yes as the on-state.
    """
    schema = get_form_schema(form_id_key)
    template_path = _TEMPLATES_DIR / schema["pdf_file"]
    if not template_path.exists():
        raise FileNotFoundError(f"PDF template missing: {template_path}")

    reader = PdfReader(str(template_path))
    writer = PdfWriter(clone_from=reader)

    checkbox_names = {f["name"] for f in schema["fields"] if f.get("type") == "button"}

    # Coerce all values to strings; pypdf wants string values for text fields and the
    # literal on/off state names for checkboxes.
    normalized: dict[str, str] = {}
    for k, v in field_values.items():
        if k in checkbox_names:
            checked = str(v or "").strip().lower() in _CHECKBOX_TRUTHY
            normalized[k] = "/Yes" if checked else "/Off"
        else:
            normalized[k] = "" if v is None else sanitize_field_text(str(v))

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
