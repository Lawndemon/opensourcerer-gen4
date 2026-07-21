"""
Form templates — single source of truth for which role gets which forms.

Drives both:
- The extract_forms LLM prompt (enumerates each role's forms to populate per Validate IAP pass).
- The form_id minting (deterministic ids survive multiple Validate IAP passes so the frontend
  can match updates to existing tabs without losing UI state).

**Per-role counts are variable** (not a fixed 3 per role). The mapping below follows ICS Canada
doctrine + the SME's Planning P deck (Officer / Supervisor / Command modes):
- Fire Officer (Officer Mode): 201, 208, 214 — the small "FO acting as IC" set.
- Incident Commander: 201, 202, 203, 207, 209, 214 — supervisor/command ownership.
- Safety Officer: 208, 215A, 214.
- Liaison / Information Officer: 213, 214 — general messaging + activity log.
- Section Chiefs each own their function's forms + ICS-214 (each role maintains their own
  activity log per the deck's Command Mode matrix).

Updated 2026-05-29 (Dave): removed the artificial 3-per-role cap and the custom non-ICS
forms (AGENCIES-LOG, MEDIA-LOG, PRESS-LOG); switched to a strict ICS Canada mapping.

`form_id_key` (optional) is the schemas.json key for PDF-backed forms. When set, post-LLM
processing in `extract_forms` swaps the form's content to `FormFieldsContent` (empty fields
populated by the AI mapping) so the generic field editor + Download PDF flow takes over.
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
    fields) so the generic field editor + Download PDF flow takes over.
    """

    role: str  # ActingRole id (frontend's `acting_role`)
    form_type: str  # e.g., "ICS-201", "ICS-202"
    title: str  # display title shown in the tab
    kind: FormContentKind  # ICS-201 has its own schema; everything else uses PlaceholderFormContent
    form_id_key: str | None = None  # schema key in ics_pdf_templates/schemas.json (PDF-backed forms only)


# Display titles for the ActingRole ids that carry forms. Used to stamp role-identity
# fields on shared forms (e.g. ICS-214's "5. ICS POSITION" — one AI fill is shared across
# all roles' copies of the form, then each copy gets its owner's position stamped).
ROLE_TITLES: dict[str, str] = {
    "fire-officer": "Fire Officer",
    "incident-commander": "Incident Commander",
    "safety-officer": "Safety Officer",
    "liaison-officer": "Liaison Officer",
    "information-officer": "Information Officer",
    "section-chief-operations": "Operations Section Chief",
    "section-chief-planning": "Planning Section Chief",
    "section-chief-logistics": "Logistics Section Chief",
    "section-chief-finance": "Finance/Administration Section Chief",
}

# Per-role mapping derived from ICS Canada doctrine + SME Planning P deck.
# Order within a role's group is presentation order on the tab strip.
FORM_TEMPLATES: list[FormTemplate] = [
    # --- Fire Officer (Officer Mode — single-unit response; FO acts as IC) ---
    FormTemplate("fire-officer", "ICS-201", "Incident Briefing", "ics_201", form_id_key="ics_201"),
    FormTemplate("fire-officer", "ICS-208", "Site Safety and Health Plan", "placeholder", form_id_key="ics_208"),
    FormTemplate("fire-officer", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),

    # --- Incident Commander (Supervisor/Command Mode) ---
    FormTemplate("incident-commander", "ICS-201", "Incident Briefing", "ics_201", form_id_key="ics_201"),
    FormTemplate("incident-commander", "ICS-202", "Incident Objectives", "placeholder", form_id_key="ics_202"),
    FormTemplate("incident-commander", "ICS-203", "Organization Assignment List", "placeholder", form_id_key="ics_203"),
    FormTemplate("incident-commander", "ICS-207", "Incident Organization Chart", "placeholder", form_id_key="ics_207"),
    FormTemplate("incident-commander", "ICS-209", "Incident Status Summary", "placeholder"),  # No PDF in v1
    FormTemplate("incident-commander", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),

    # --- Safety Officer ---
    FormTemplate("safety-officer", "ICS-208", "Site Safety and Health Plan", "placeholder", form_id_key="ics_208"),
    FormTemplate("safety-officer", "ICS-215A", "IAP Safety Analysis", "placeholder", form_id_key="ics_215a"),
    FormTemplate("safety-officer", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),

    # --- Liaison Officer ---
    FormTemplate("liaison-officer", "ICS-213", "General Message", "placeholder"),  # No PDF in v1
    FormTemplate("liaison-officer", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),

    # --- Information Officer (PIO) ---
    FormTemplate("information-officer", "ICS-213", "General Message", "placeholder"),  # No PDF in v1
    FormTemplate("information-officer", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),

    # --- Operations Section Chief ---
    FormTemplate("section-chief-operations", "ICS-204", "Assignment List", "placeholder", form_id_key="ics_204"),
    FormTemplate(
        "section-chief-operations", "ICS-215", "Operational Planning Worksheet", "placeholder", form_id_key="ics_215"
    ),
    FormTemplate("section-chief-operations", "ICS-210", "Resource Status Change", "placeholder"),  # No PDF in v1
    FormTemplate("section-chief-operations", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),

    # --- Planning Section Chief ---
    FormTemplate("section-chief-planning", "ICS-203", "Organization Assignment List", "placeholder", form_id_key="ics_203"),
    FormTemplate("section-chief-planning", "ICS-211", "Incident Check-In List", "placeholder", form_id_key="ics_211"),
    FormTemplate("section-chief-planning", "ICS-209", "Incident Status Summary", "placeholder"),  # No PDF in v1
    FormTemplate("section-chief-planning", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),

    # --- Logistics Section Chief ---
    FormTemplate(
        "section-chief-logistics", "ICS-205", "Incident Radio Communications Plan", "placeholder", form_id_key="ics_205"
    ),
    FormTemplate("section-chief-logistics", "ICS-206", "Medical Plan", "placeholder"),  # No PDF in v1
    FormTemplate(
        "section-chief-logistics", "ICS-218", "Support Vehicle/Equipment Inventory", "placeholder"
    ),  # No PDF in v1
    FormTemplate("section-chief-logistics", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),

    # --- Finance Section Chief ---
    FormTemplate("section-chief-finance", "OF-288", "Emergency Firefighter Time Report", "placeholder"),  # No PDF in v1
    FormTemplate("section-chief-finance", "ICS-226", "Individual Performance Rating", "placeholder"),  # No PDF in v1
    FormTemplate("section-chief-finance", "ICS-219", "Resource Status Card (T-Card)", "placeholder"),  # No PDF in v1
    FormTemplate("section-chief-finance", "ICS-214", "Activity Log", "placeholder", form_id_key="ics_214"),
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
