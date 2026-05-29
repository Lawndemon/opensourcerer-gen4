"""
Form templates — single source of truth for which role gets which 3 forms.

Drives both:
- The extract_forms LLM prompt (enumerates the 27 forms to populate per Validate IAP pass).
- The form_id minting (deterministic ids survive multiple Validate IAP passes so the frontend
  can match updates to existing tabs without losing UI state).

Mapping is based on standard federal ICS practice — each position canonically owns or
co-owns these forms in real incident command. SME will eventually deliver an authoritative
per-form matrix (BACKLOG.md → "Still open" #3); when that lands, the titles / kinds change
here and the prompt/frontend follow automatically.

**Form count:** 27 (Fire Officer 3 + 8 support roles × 3). One LLM call generates all 27.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


FormContentKind = Literal["ics_201", "placeholder"]


@dataclass(frozen=True)
class FormTemplate:
    """Metadata for one form tab. `kind` selects the FormContent discriminator the LLM emits.

    `form_id_key` (optional) is the key into `incidents/ics_pdf_templates/schemas.json` for
    forms whose layout is an official ICS Canada interactive PDF. When set, post-LLM
    processing in `extract_forms` swaps the form's content to `FormFieldsContent` (empty
    fields) so the generic field editor + Download PDF flow takes over. LLM prompt and
    output stay on the placeholder shape — kind doesn't change here. (Phase 3 will add AI
    auto-fill into the named fields.)
    """

    role: str  # ActingRole id (frontend's `acting_role`)
    form_type: str  # e.g., "ICS-201", "ICS-202", "OF-288", "AGENCIES-LOG"
    title: str  # display title shown in the tab
    kind: FormContentKind  # ICS-201 has its own schema; everything else uses PlaceholderFormContent
    form_id_key: str | None = None  # schema key in ics_pdf_templates/schemas.json (PDF-backed forms only)


# Ordered: Fire Officer first, then ICS Command, Command Staff, Section Chiefs (top-to-bottom
# in the standard ICS org chart). Each role's three forms are grouped together.
FORM_TEMPLATES: list[FormTemplate] = [
    # --- Fire Officer (field) ---
    FormTemplate("fire-officer", "ICS-201", "Incident Briefing", "ics_201", form_id_key="ics_201"),
    FormTemplate("fire-officer", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),
    FormTemplate("fire-officer", "ICS-213", "General Message", "placeholder"),
    # --- Incident Commander (ICS Command) ---
    FormTemplate("incident-commander", "ICS-202", "Incident Objectives", "placeholder", form_id_key="ics_202"),
    FormTemplate("incident-commander", "ICS-207", "Incident Organization Chart", "placeholder", form_id_key="ics_207"),
    FormTemplate("incident-commander", "ICS-209", "Incident Status Summary", "placeholder"),
    # --- Safety Officer (ICS Command Staff) ---
    FormTemplate("safety-officer", "ICS-208", "Site Safety and Health Plan", "placeholder", form_id_key="ics_208"),
    FormTemplate("safety-officer", "ICS-215A", "IAP Safety Analysis", "placeholder", form_id_key="ics_215a"),
    FormTemplate("safety-officer", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),
    # --- Liaison Officer (ICS Command Staff) ---
    FormTemplate(
        "liaison-officer", "AGENCIES-LOG", "Cooperating/Assisting Agencies Log", "placeholder"
    ),
    FormTemplate("liaison-officer", "ICS-213", "General Message", "placeholder"),
    FormTemplate("liaison-officer", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),
    # --- Information Officer / PIO (ICS Command Staff) ---
    FormTemplate("information-officer", "MEDIA-LOG", "Media Contact Log", "placeholder"),
    FormTemplate("information-officer", "PRESS-LOG", "Press Release Log", "placeholder"),
    FormTemplate("information-officer", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),
    # --- Section Chief — Operations ---
    FormTemplate("section-chief-operations", "ICS-204", "Assignment List", "placeholder", form_id_key="ics_204"),
    FormTemplate(
        "section-chief-operations", "ICS-215", "Operational Planning Worksheet", "placeholder", form_id_key="ics_215"
    ),
    FormTemplate("section-chief-operations", "ICS-210", "Resource Status Change", "placeholder"),
    # --- Section Chief — Planning ---
    FormTemplate("section-chief-planning", "ICS-203", "Organization Assignment List", "placeholder", form_id_key="ics_203"),
    FormTemplate("section-chief-planning", "ICS-211", "Incident Check-In List", "placeholder", form_id_key="ics_211"),
    FormTemplate("section-chief-planning", "ICS-209", "Incident Status Summary", "placeholder"),
    # --- Section Chief — Logistics ---
    FormTemplate(
        "section-chief-logistics", "ICS-205", "Incident Radio Communications Plan", "placeholder", form_id_key="ics_205"
    ),
    FormTemplate("section-chief-logistics", "ICS-206", "Medical Plan", "placeholder"),
    FormTemplate(
        "section-chief-logistics", "ICS-218", "Support Vehicle/Equipment Inventory", "placeholder"
    ),
    # --- Section Chief — Finance/Admin ---
    FormTemplate("section-chief-finance", "OF-288", "Emergency Firefighter Time Report", "placeholder"),
    FormTemplate("section-chief-finance", "ICS-226", "Individual Performance Rating", "placeholder"),
    FormTemplate("section-chief-finance", "ICS-219", "Resource Status Card (T-Card)", "placeholder"),
]


def stable_form_id(role: str, form_type: str) -> str:
    """Deterministic form_id so Validate IAP updates land on the same tab each time.

    Frontend uses form_id as the React key; matching on (role, form_type) keeps tab UI state
    (which tab is open, scroll position) across refreshes.
    """
    slug = (
        form_type.lower()
        .replace(" ", "-")
        .replace("/", "-")
        .replace("(", "")
        .replace(")", "")
    )
    return f"f-{role}-{slug}"

