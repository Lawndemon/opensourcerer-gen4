"""
RecommendActionsApproach — LLM-generated support actions per role per incident.

Used by the support-role view (Session 5b/5c): when a support role opens an incident or
taps Refresh, this approach is called with (role, scene state, already-published items,
recently-dismissed items) and returns 3-5 short recommended actions. The support role
curates the list (check / X / Add Custom) and the curated/published subset flows to the
Fire Officer's kiosk Support Contributions pane.

Pattern matches `ValidateIAPApproach` and `RefineConditionApproach`: load prompt from file,
OpenAI JSON-mode, parse into a local Pydantic shape, hand structured strings back to the
caller. No KB retrieval in v1 — the LLM grounds its suggestions in the scene state + role
context only. Real KB retrieval (the Client > Region > Federal > Domain cascade) lands
when the SME's role-to-document spreadsheet arrives.
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

from models.incidents import SceneConditionAndAction, SupportContribution

logger = logging.getLogger(__name__)


class _LLMRecommendationsResponse(BaseModel):
    """LLM-output shape; 3-5 short role-appropriate action strings."""

    model_config = {"alias_generator": to_camel, "populate_by_name": True, "extra": "forbid"}
    recommended_actions: list[str] = Field(min_length=3, max_length=5)


class RecommendActionsApproach:
    """
    One LLM call producing 3-5 recommended actions tailored to a support role.

    Constructor injects OpenAI client + model deployment; the singleton is registered as
    `CONFIG_RECOMMEND_ACTIONS_APPROACH` in `setup_clients()` and pulled out by the route
    handler.
    """

    PROMPT_FILE = (
        pathlib.Path(__file__).parent.parent
        / "prompts"
        / "extraction"
        / "support_role_recommendations.md"
    )

    def __init__(
        self,
        *,
        openai_client: AsyncOpenAI,
        chatgpt_model: str,
        chatgpt_deployment: Optional[str] = None,
        # Moderate temperature — we want variety across the 3-5 items without going off-piste.
        temperature: float = 0.4,
    ):
        self.openai_client = openai_client
        self.chatgpt_model = chatgpt_model
        self.chatgpt_deployment = chatgpt_deployment
        self.temperature = temperature
        self.system_prompt = self._load_prompt()

    def _load_prompt(self) -> str:
        if not self.PROMPT_FILE.exists():
            raise FileNotFoundError(f"Recommendations prompt not found at {self.PROMPT_FILE}")
        return self.PROMPT_FILE.read_text(encoding="utf-8")

    async def run(
        self,
        *,
        role: str,
        scene_summary_text: str,
        scene_conditions: list[SceneConditionAndAction],
        already_published: list[SupportContribution],
        recently_dismissed: list[str],
    ) -> list[str]:
        """Generate 3-5 recommended actions for the role."""

        # Compact scene conditions for the prompt — text + status only; the LLM doesn't
        # need the full citation/refinement metadata for this call.
        compact_conditions = [
            {"text": c.text, "type": c.type, "status": c.status}
            for c in scene_conditions
            if not c.removed
        ]
        compact_published = [
            {"role": p.added_by.role, "text": p.text} for p in already_published
        ]

        user_message = json.dumps(
            {
                "role": role,
                "sceneSummary": scene_summary_text,
                "sceneConditionsAndActions": compact_conditions,
                "alreadyPublished": compact_published,
                "recentlyDismissed": recently_dismissed,
            },
            ensure_ascii=False,
        )

        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_message},
        ]

        completion = await self.openai_client.chat.completions.create(
            model=self.chatgpt_deployment or self.chatgpt_model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=self.temperature,
        )
        raw = completion.choices[0].message.content
        if not raw:
            raise RuntimeError("LLM returned empty content for recommend_actions")
        try:
            parsed = _LLMRecommendationsResponse.model_validate_json(raw)
        except ValidationError as e:
            logger.error(
                "Recommendations LLM output did not validate. Role=%s Error=%s Raw=%s",
                role, e, raw[:600],
            )
            raise RuntimeError(f"Recommendations LLM output invalid: {e}") from e
        return parsed.recommended_actions
