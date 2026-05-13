"""
RefineConditionApproach — two LLM calls supporting the Fire Officer's "Refine Condition" UX.

Workflow:
  1. Fire Officer taps a row's Refine button on the kiosk.
  2. Frontend calls POST /api/incidents/{id}/conditions/{condId}/refine.
  3. Backend uses `generate_narrowing_statements()` here to return 3 short statements.
  4. Fire Officer picks one (or "None of the above") with a single tap.
  5. Frontend calls POST /api/incidents/{id}/conditions/{condId}/refine/apply.
  6. Backend uses `apply_refinement()` here to re-evaluate the row and persist.

This approach is intentionally narrower than `ValidateIAPApproach`:
- Two single-purpose prompts, each producing a tiny JSON shape.
- No KB retrieval in v1 (matches Session 1 / 4 scope).
- No persistence concerns here; the route handler owns Cosmos writes.

See:
- docs/prototype_plan.md → Session 4
- prompts/extraction/fire_officer_refine_condition.md
- prompts/extraction/fire_officer_apply_refinement.md
"""

from __future__ import annotations

import json
import logging
import pathlib
from typing import Optional

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel, Field, ValidationError
from pydantic.alias_generators import to_camel

from models.incidents import ConditionStatus, SceneConditionAndAction

logger = logging.getLogger(__name__)


# === Small Pydantic shapes for the two LLM responses =============================
#
# These don't live in models/incidents.py because they're LLM-output-shaped, not
# contract-with-frontend-shaped. The frontend-facing response models in
# models/incidents.py (RefineConditionResponse, ApplyRefinementResponse) wrap these.


class _LLMNarrowingResponse(BaseModel):
    """Three short, mutually-distinct narrowing statements from the LLM."""

    model_config = {"alias_generator": to_camel, "populate_by_name": True, "extra": "forbid"}
    narrowing_statements: list[str] = Field(min_length=3, max_length=3)


class _LLMReevaluatedCondition(BaseModel):
    """LLM's re-evaluation of a refined condition."""

    model_config = {"alias_generator": to_camel, "populate_by_name": True, "extra": "forbid"}
    status: ConditionStatus
    published_plan_context: str = ""
    delta: Optional[str] = None


class RefineConditionApproach:
    """
    Two LLM calls (refine + apply) keyed off a single condition + the incident transcript.

    Constructor injects the OpenAI client and model deployment; a singleton is registered as
    `CONFIG_REFINE_CONDITION_APPROACH` in `setup_clients()` and pulled out by the route handlers.
    """

    NARROWING_PROMPT_FILE = (
        pathlib.Path(__file__).parent.parent
        / "prompts"
        / "extraction"
        / "fire_officer_refine_condition.md"
    )
    APPLY_PROMPT_FILE = (
        pathlib.Path(__file__).parent.parent
        / "prompts"
        / "extraction"
        / "fire_officer_apply_refinement.md"
    )

    def __init__(
        self,
        *,
        openai_client: AsyncOpenAI,
        chatgpt_model: str,
        chatgpt_deployment: Optional[str] = None,
        # Slightly higher temperature for the narrowing call so we get genuinely distinct
        # statements (rather than three near-paraphrases of each other). The apply call
        # stays deterministic — we want the same re-evaluation given the same inputs.
        narrowing_temperature: float = 0.45,
        apply_temperature: float = 0.15,
    ):
        self.openai_client = openai_client
        self.chatgpt_model = chatgpt_model
        self.chatgpt_deployment = chatgpt_deployment
        self.narrowing_temperature = narrowing_temperature
        self.apply_temperature = apply_temperature
        self.narrowing_prompt = self._load_prompt(self.NARROWING_PROMPT_FILE)
        self.apply_prompt = self._load_prompt(self.APPLY_PROMPT_FILE)

    @staticmethod
    def _load_prompt(path: pathlib.Path) -> str:
        if not path.exists():
            raise FileNotFoundError(f"Refine prompt not found at {path}")
        return path.read_text(encoding="utf-8")

    # === Step 1: generate three narrowing statements ============================

    async def generate_narrowing_statements(
        self,
        *,
        condition: SceneConditionAndAction,
        transcript: str,
    ) -> list[str]:
        """Return exactly three short narrowing statements for the Fire Officer to pick from."""
        user_message = (
            f"Condition or Action: {condition.text}\n"
            f"Current status: {condition.status}\n"
            f"Published plan context (current): {condition.published_plan_context or '(none)'}\n\n"
            f"Transcript:\n{transcript}"
        )
        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": self.narrowing_prompt},
            {"role": "user", "content": user_message},
        ]
        completion = await self.openai_client.chat.completions.create(
            model=self.chatgpt_deployment or self.chatgpt_model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=self.narrowing_temperature,
        )
        raw = completion.choices[0].message.content
        if not raw:
            raise RuntimeError("LLM returned empty content for narrowing statements")
        try:
            parsed = _LLMNarrowingResponse.model_validate_json(raw)
        except ValidationError as e:
            logger.error(
                "Narrowing-statements LLM output did not validate. Error: %s. Raw: %s",
                e, raw[:600],
            )
            raise RuntimeError(f"Narrowing-statements LLM output invalid: {e}") from e
        return parsed.narrowing_statements

    # === Step 2: apply the chosen refinement =====================================

    async def apply_refinement(
        self,
        *,
        condition: SceneConditionAndAction,
        transcript: str,
        selected_statement: Optional[str],
    ) -> tuple[ConditionStatus, str, Optional[str]]:
        """
        Re-evaluate the condition under the narrowed scenario.

        Returns a tuple of (new_status, new_published_plan_context, delta_note). The route
        handler maps these back onto the persisted SceneConditionAndAction and writes the
        audit event.

        If selected_statement is None ("None of the above"), the LLM is instructed to leave
        status unchanged and emit `delta="none_of_the_above"`.
        """
        user_message = (
            f"Original condition: {condition.text}\n"
            f"Current status: {condition.status}\n"
            f"Original published plan context: {condition.published_plan_context or '(none)'}\n"
            f"Selected narrowing statement: {json.dumps(selected_statement)}\n\n"
            f"Transcript:\n{transcript}"
        )
        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": self.apply_prompt},
            {"role": "user", "content": user_message},
        ]
        completion = await self.openai_client.chat.completions.create(
            model=self.chatgpt_deployment or self.chatgpt_model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=self.apply_temperature,
        )
        raw = completion.choices[0].message.content
        if not raw:
            raise RuntimeError("LLM returned empty content for apply-refinement")
        try:
            parsed = _LLMReevaluatedCondition.model_validate_json(raw)
        except ValidationError as e:
            logger.error(
                "Apply-refinement LLM output did not validate. Error: %s. Raw: %s",
                e, raw[:600],
            )
            raise RuntimeError(f"Apply-refinement LLM output invalid: {e}") from e
        return parsed.status, parsed.published_plan_context, parsed.delta
