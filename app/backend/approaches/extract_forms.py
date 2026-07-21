"""
ExtractFormsApproach — downstream extraction that populates the role-tagged forms.

Runs AFTER ValidateIAPApproach completes. Takes the primary scene extraction's result (the
Scene Summary and the Scene Conditions and Actions list) plus the original transcript as
input, and produces FormSummary content for every role × form-type combination defined in
`incidents/form_templates.py`.

Architectural rationale (2026-05-19):

- Keeps the primary scene-extraction prompt focused on the hardest judgment (life-risk
  status assessment for Monitor rows). Form generation is a different concern with
  different acceptance criteria — bundling them dilutes both.
- Lets us iterate on form-quality prompts (Phase 2: per-form-type prompt specialization)
  without disturbing the scene-extraction prompt.
- Graceful degradation: if form extraction fails, the scene state still updates. The
  validate-iap endpoint can choose whether to return an error or fall back to an empty
  forms list when the second call errors.

Phase 1 scope: one LLM call generates every form in `FORM_TEMPLATES` (variable per-role
count per ICS Canada doctrine — see incidents/form_templates.py). Phase 2 will likely
split into parallel per-role or per-form-type calls for quality.
"""

from __future__ import annotations

import asyncio
import json
import logging
import pathlib
from datetime import datetime
from typing import Optional

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import TypeAdapter

from incidents.form_templates import FORM_TEMPLATES, ROLE_TITLES, stable_form_id
from incidents.pdf_filler import ai_fillable_fields, get_form_schema
from models.incidents import FormFieldsContent, FormSummary, ICS201Content, SceneConditionAndAction, SceneSummary

logger = logging.getLogger(__name__)


# Reusable TypeAdapter avoids re-building the validator on every call.
_FormListAdapter: TypeAdapter[list[FormSummary]] = TypeAdapter(list[FormSummary])


def _ics201_typed_to_acroform(typed: ICS201Content) -> dict[str, str]:
    """Map the typed ICS201Content's 7 fields onto the official Form-201.pdf AcroForm names.

    Lets the AI auto-fill (which still produces ICS201Content shape) carry through to the
    field map used by the PDF filler + generic editor. Field names match
    `ics_pdf_templates/schemas.json` for `ics_201`. PREPARED BY is repeated on each of the
    4 pages of the official form, so we stamp it on all four.
    """
    return {
        "1 INCIDENT NAME": typed.incident_name or "",
        "2 DATE PREPARED": typed.date_time_initiated or "",
        "5. SITUATION SUMMARY AND SAFETY BRIEFING": typed.situation_summary or "",
        "7. CURRENT AND PLANNED OBJECTIVES": typed.current_objectives or "",
        "Action Row 1": typed.current_actions or "",
        "Resources OrderedRow1": typed.resource_summary or "",
        "6. PREPARED BY Name and Position": typed.prepared_by or "",
        "9. PREPARED BY Name and Position": typed.prepared_by or "",
        "11. PREPARED BY Name and Position": typed.prepared_by or "",
        "13. PREPARED BY Name and Position": typed.prepared_by or "",
    }


class ExtractFormsApproach:
    """
    Downstream extractor: takes the primary scene extraction result and produces the
    role-tagged forms (one entry per row in `FORM_TEMPLATES`) in a single LLM call.

    Registered as a singleton in the Quart app config (CONFIG_EXTRACT_FORMS_APPROACH) and
    pulled out by the validate-iap endpoint handler.
    """

    PROMPT_FILE = (
        pathlib.Path(__file__).parent.parent
        / "prompts"
        / "extraction"
        / "extract_forms.md"
    )
    FILL_PROMPT_FILE = (
        pathlib.Path(__file__).parent.parent
        / "prompts"
        / "extraction"
        / "fill_form_fields.md"
    )

    def __init__(
        self,
        *,
        openai_client: AsyncOpenAI,
        chatgpt_model: str,
        chatgpt_deployment: Optional[str] = None,
        temperature: float = 0.2,
    ):
        self.openai_client = openai_client
        self.chatgpt_model = chatgpt_model
        self.chatgpt_deployment = chatgpt_deployment
        self.temperature = temperature
        self.system_prompt = self._load_prompt()
        self.fill_system_prompt = self._load_fill_prompt()

    def _load_prompt(self) -> str:
        if not self.PROMPT_FILE.exists():
            raise FileNotFoundError(f"Forms extraction prompt not found at {self.PROMPT_FILE}")
        return self.PROMPT_FILE.read_text(encoding="utf-8")

    def _load_fill_prompt(self) -> str:
        if not self.FILL_PROMPT_FILE.exists():
            raise FileNotFoundError(f"Form fill prompt not found at {self.FILL_PROMPT_FILE}")
        return self.FILL_PROMPT_FILE.read_text(encoding="utf-8")

    async def run(
        self,
        *,
        incident_id: str,
        transcript: str,
        scene_summary: SceneSummary,
        scene_conditions_and_actions: list[SceneConditionAndAction],
    ) -> list[FormSummary]:
        """Extract the role-tagged forms (one per `FORM_TEMPLATES` entry).

        Raises on LLM refusal or schema mismatch. Callers should catch and decide whether
        to propagate the error or fall back to an empty forms list (which preserves the
        scene state on the incident document even when form generation fails).
        """
        logger.info(
            "ExtractForms for incident %s, transcript %d chars, %d scene items",
            incident_id,
            len(transcript),
            len(scene_conditions_and_actions),
        )

        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": self._format_user_message(
                    incident_id=incident_id,
                    transcript=transcript,
                    scene_summary=scene_summary,
                    scene_conditions_and_actions=scene_conditions_and_actions,
                ),
            },
        ]

        completion = await self.openai_client.chat.completions.create(
            model=self.chatgpt_deployment or self.chatgpt_model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=self.temperature,
        )

        raw_content = completion.choices[0].message.content
        if not raw_content:
            refusal = completion.choices[0].message.refusal
            logger.error(
                "LLM returned empty content for ExtractForms on incident %s. Refusal: %s",
                incident_id,
                refusal,
            )
            raise RuntimeError(f"LLM returned empty content. Refusal: {refusal}")

        try:
            envelope = json.loads(raw_content)
            raw_forms = envelope.get("forms", [])
            forms = _FormListAdapter.validate_python(raw_forms)
        except Exception as e:
            logger.error(
                "Failed to parse ExtractForms output for incident %s. Error: %s. Raw: %s",
                incident_id,
                e,
                raw_content[:1500],
            )
            raise RuntimeError(
                f"LLM output did not match list[FormSummary] schema: {e}"
            ) from e

        # Reconcile: the LLM should have emitted one form per template in the requested order,
        # but in case it duplicated, dropped, or reordered, re-key by (role, form_type) and
        # rebuild the canonical list. Anything the LLM emitted that doesn't match a template
        # is discarded.
        by_key = {(f.role, f.content.form_type): f for f in forms}
        canonical: list[FormSummary] = []
        for tpl in FORM_TEMPLATES:
            key = (tpl.role, tpl.form_type)
            llm_form = by_key.get(key)
            if llm_form is None:
                logger.warning(
                    "ExtractForms LLM omitted form %s for role %s on incident %s; skipping",
                    tpl.form_type,
                    tpl.role,
                    incident_id,
                )
                continue
            # Override identity fields server-side so the LLM can't drift these.
            llm_form.form_id = stable_form_id(tpl.role, tpl.form_type)
            llm_form.role = tpl.role
            llm_form.title = tpl.title
            llm_form.status = "active"
            # Phase 2 (SME forms work, 2026-05-27): for PDF-backed forms, swap the LLM's
            # content shape to FormFieldsContent. The official PDF template + generic field
            # editor take over from here. (Phase 3 will populate the fields via dedicated
            # per-form extraction; for now the IC/Admin fills via the CloseoutAdmin form
            # editor and exports the pixel-identical official PDF.)
            if tpl.form_id_key is not None:
                fields: dict[str, str] = {}
                # ICS-201 special case: the LLM emits typed ICS201Content (7 hand-picked
                # fields), preserved by mapping them onto their AcroForm names so the AI
                # auto-fill keeps working through the migration. The remaining 153 PDF
                # fields stay blank and the user fills them in the form editor.
                if isinstance(llm_form.content, ICS201Content):
                    fields = _ics201_typed_to_acroform(llm_form.content)
                llm_form.content = FormFieldsContent(
                    form_type=tpl.form_type,
                    form_id_key=tpl.form_id_key,
                    fields=fields,
                )
            canonical.append(llm_form)

        # Phase 3 (2026-07-21): AI fill for PDF-backed forms that have curated field maps
        # (incidents/ics_pdf_templates/field_curation.json). One LLM call per distinct
        # form_id_key, run concurrently; the result is merged onto every role's copy of that
        # form. A failed fill logs and leaves that form blank — never fails the extraction.
        await self._fill_curated_pdf_forms(
            canonical,
            incident_id=incident_id,
            transcript=transcript,
            scene_summary=scene_summary,
            scene_conditions_and_actions=scene_conditions_and_actions,
        )

        return canonical

    async def _fill_curated_pdf_forms(
        self,
        canonical: list[FormSummary],
        *,
        incident_id: str,
        transcript: str,
        scene_summary: SceneSummary,
        scene_conditions_and_actions: list[SceneConditionAndAction],
    ) -> None:
        """Populate FormFieldsContent.fields via one fill call per distinct curated form."""
        # Distinct PDF-backed forms present in this run that have curated fillable fields.
        fill_keys: list[str] = []
        for form in canonical:
            if isinstance(form.content, FormFieldsContent):
                key = form.content.form_id_key
                if key not in fill_keys and ai_fillable_fields(key):
                    fill_keys.append(key)
        if not fill_keys:
            return

        results = await asyncio.gather(
            *(
                self._fill_one_form(
                    form_id_key=key,
                    transcript=transcript,
                    scene_summary=scene_summary,
                    scene_conditions_and_actions=scene_conditions_and_actions,
                )
                for key in fill_keys
            ),
            return_exceptions=True,
        )

        for key, result in zip(fill_keys, results):
            if isinstance(result, BaseException):
                logger.warning(
                    "AI fill failed for form %s on incident %s (form left blank): %s",
                    key,
                    incident_id,
                    result,
                )
                continue
            for form in canonical:
                if isinstance(form.content, FormFieldsContent) and form.content.form_id_key == key:
                    # Merge over any seed values (e.g. the ICS-201 typed mapping); the
                    # dedicated fill wins where both provide a value.
                    form.content.fields = {**form.content.fields, **result}
                    # ICS-214 is one shared fill across every role's Activity Log copy;
                    # each copy carries its own role's position (curation marks the field
                    # ai_fill=false so the LLM never competes with this stamp).
                    if key == "ics_214":
                        form.content.fields["5. ICS POSITION"] = ROLE_TITLES.get(form.role, form.role)

    async def _fill_one_form(
        self,
        *,
        form_id_key: str,
        transcript: str,
        scene_summary: SceneSummary,
        scene_conditions_and_actions: list[SceneConditionAndAction],
    ) -> dict[str, str]:
        """One LLM call: fill the curated fields of one official ICS form. Returns {name: value}."""
        schema = get_form_schema(form_id_key)
        fillable = ai_fillable_fields(form_id_key)
        field_lines = "\n".join(
            f"- {f['name']} | {f.get('label') or f['name']} | {f.get('type', 'text')} | {f.get('guidance', '')}"
            for f in fillable
        )
        user_message = (
            f"## Form\n\n{schema.get('title', form_id_key)} ({form_id_key})\n\n"
            f"## Current date/time\n\n{datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"
            "## Fillable fields (fieldName | label | type | guidance)\n\n"
            f"{field_lines}\n\n"
            "## Scene Summary\n\n"
            f"{scene_summary.text}\n\n"
            "## Scene Conditions and Actions\n\n"
            f"{self._scene_block(scene_conditions_and_actions)}\n\n"
            "## Raw transcript\n\n"
            f"{transcript}\n"
        )
        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": self.fill_system_prompt},
            {"role": "user", "content": user_message},
        ]
        completion = await self.openai_client.chat.completions.create(
            model=self.chatgpt_deployment or self.chatgpt_model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=self.temperature,
        )
        raw_content = completion.choices[0].message.content
        if not raw_content:
            raise RuntimeError(f"LLM returned empty content filling {form_id_key}")
        envelope = json.loads(raw_content)
        raw_fields = envelope.get("fields", {})
        if not isinstance(raw_fields, dict):
            raise RuntimeError(f"Fill output for {form_id_key} has no 'fields' object")
        # Keep only known fillable field names; coerce values to strings; drop empties.
        known = {f["name"] for f in fillable}
        return {
            name: str(value).strip()
            for name, value in raw_fields.items()
            if name in known and value is not None and str(value).strip()
        }

    @staticmethod
    def _scene_block(scene_conditions_and_actions: list[SceneConditionAndAction]) -> str:
        """Condense scene items to one line each so prompts stay compact."""
        scene_lines = []
        for c in scene_conditions_and_actions:
            removed = " [REMOVED]" if c.removed else ""
            scene_lines.append(
                f"- [{c.type}/{c.status}] {c.text}{removed}"
                + (
                    f"\n    published: {c.published_plan_context}"
                    if c.published_plan_context
                    else ""
                )
            )
        return "\n".join(scene_lines) if scene_lines else "(no scene items yet)"

    def _format_user_message(
        self,
        *,
        incident_id: str,
        transcript: str,
        scene_summary: SceneSummary,
        scene_conditions_and_actions: list[SceneConditionAndAction],
    ) -> str:
        """Build the user message: forms-to-generate list + scene state + transcript."""

        # Forms-to-generate table — gives the LLM the exact (formId, role, formType, title, kind)
        # tuples it must emit, in order.
        form_lines = []
        for tpl in FORM_TEMPLATES:
            form_lines.append(
                f"- formId={stable_form_id(tpl.role, tpl.form_type)}, role={tpl.role}, "
                f"formType={tpl.form_type}, title={tpl.title!r}, kind={tpl.kind}"
            )
        forms_block = "\n".join(form_lines)

        scene_block = self._scene_block(scene_conditions_and_actions)

        return (
            f"Incident ID: {incident_id}\n\n"
            "## Forms to generate (emit in this order)\n\n"
            f"{forms_block}\n\n"
            "## Scene Summary (from the primary scene extraction)\n\n"
            f"{scene_summary.text}\n\n"
            "## Scene Conditions and Actions (from the primary scene extraction)\n\n"
            f"{scene_block}\n\n"
            "## Raw transcript\n\n"
            f"{transcript}\n"
        )
