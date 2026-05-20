"""
ExtractFormsApproach — downstream extraction that populates all 27 role-tagged forms.

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

Phase 1 scope: one LLM call generates all 27 forms. Phase 2 will likely split into
parallel per-role or per-form-type calls for quality.
"""

from __future__ import annotations

import json
import logging
import pathlib
from typing import Optional

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import TypeAdapter

from incidents.form_templates import FORM_TEMPLATES, stable_form_id
from models.incidents import FormSummary, SceneConditionAndAction, SceneSummary

logger = logging.getLogger(__name__)


# Reusable TypeAdapter avoids re-building the validator on every call.
_FormListAdapter: TypeAdapter[list[FormSummary]] = TypeAdapter(list[FormSummary])


class ExtractFormsApproach:
    """
    Downstream extractor: takes the primary scene extraction result and produces the
    27 role-tagged forms in a single LLM call.

    Registered as a singleton in the Quart app config (CONFIG_EXTRACT_FORMS_APPROACH) and
    pulled out by the validate-iap endpoint handler.
    """

    PROMPT_FILE = (
        pathlib.Path(__file__).parent.parent
        / "prompts"
        / "extraction"
        / "extract_forms.md"
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

    def _load_prompt(self) -> str:
        if not self.PROMPT_FILE.exists():
            raise FileNotFoundError(f"Forms extraction prompt not found at {self.PROMPT_FILE}")
        return self.PROMPT_FILE.read_text(encoding="utf-8")

    async def run(
        self,
        *,
        incident_id: str,
        transcript: str,
        scene_summary: SceneSummary,
        scene_conditions_and_actions: list[SceneConditionAndAction],
    ) -> list[FormSummary]:
        """Extract the 27 role-tagged forms.

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
            canonical.append(llm_form)

        return canonical

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

        # Scene conditions: condensed to one line each so the prompt stays compact.
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
        scene_block = "\n".join(scene_lines) if scene_lines else "(no scene items yet)"

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
