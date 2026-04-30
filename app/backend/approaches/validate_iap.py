"""
ValidateIAPApproach — extracts a structured ValidateIAPResponse from a Fire Officer's transcript
by calling the LLM with the extraction prompt and OpenAI's structured-output mode.

Session 1 scope: pure LLM extraction.
- No KB retrieval (tagged-and-merged cascade is deferred — see docs/role_based_retrieval_plan.md).
- No Cosmos persistence (Session 3 — see docs/prototype_plan.md).
- No streaming STT input (the request carries the accumulated transcript as a string).

Future iterations will:
- Inject KB retrieval results into the prompt for grounded plan-conformance assessment.
- Pass previously-removed conditions to honor sticky-with-resurfacing semantics.
- Persist results and audit events to Cosmos.
"""

from __future__ import annotations

import logging
import pathlib
from typing import Optional

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from models.incidents import ValidateIAPRequest, ValidateIAPResponse

logger = logging.getLogger(__name__)


class ValidateIAPApproach:
    """
    Calls the LLM with the Fire Officer extraction prompt and returns a typed response.

    Constructor injects all dependencies; an instance is registered as a singleton in the Quart
    app config (CONFIG_VALIDATE_IAP_APPROACH) and pulled out by the /api/incidents/{id}/validate-iap
    endpoint handler.
    """

    PROMPT_FILE = (
        pathlib.Path(__file__).parent.parent
        / "prompts"
        / "extraction"
        / "fire_officer_validate_iap.md"
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
            raise FileNotFoundError(f"Extraction prompt not found at {self.PROMPT_FILE}")
        return self.PROMPT_FILE.read_text(encoding="utf-8")

    async def run(self, request: ValidateIAPRequest) -> ValidateIAPResponse:
        """
        Extract a structured ValidateIAPResponse from the transcript.

        Uses OpenAI's JSON-mode (`response_format={"type": "json_object"}`) — the LLM produces
        valid JSON, and we parse it into the Pydantic contract on our side. We do NOT use
        `chat.completions.parse()` with a Pydantic model directly, because OpenAI's strict
        structured-output mode rejects schemas with `oneOf` + `discriminator` patterns (our
        FormContent discriminated union) and `default` keywords. Pydantic-side parsing gives
        us schema validation without the LLM-side schema constraints.
        """
        logger.info(
            "ValidateIAP for incident %s, transcript length %d chars, acting role %s",
            request.incident_id,
            len(request.transcript),
            request.acting_role,
        )

        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": self._format_user_message(request)},
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
                "LLM returned empty content for incident %s. Refusal: %s",
                request.incident_id,
                refusal,
            )
            raise RuntimeError(
                f"LLM returned empty content. Refusal: {refusal}"
            )

        try:
            result = ValidateIAPResponse.model_validate_json(raw_content)
        except Exception as e:
            logger.error(
                "Failed to parse LLM output as ValidateIAPResponse for incident %s. Error: %s. Raw: %s",
                request.incident_id,
                e,
                raw_content[:1000],
            )
            raise RuntimeError(
                f"LLM output did not match ValidateIAPResponse schema: {e}"
            ) from e

        # Override fields the LLM should not decide. The contract gives the LLM autonomy over the
        # extracted content, but identity (incident_id) and lifecycle phase come from the request
        # and the server, not from the LLM's interpretation.
        result.incident_id = request.incident_id
        result.phase = "response"

        return result

    def _format_user_message(self, request: ValidateIAPRequest) -> str:
        """
        Format the user-message payload for the LLM.

        For Session 1 the message is a brief framing followed by the raw transcript. Future
        iterations will append:
        - Previously-removed conditions context block (for sticky-with-resurfacing).
        - KB retrieval results (for grounded plan-conformance assessment).
        - Prior validation state (for stateful reconciliation across re-presses).
        """
        return (
            f"Acting role: {request.acting_role}\n"
            f"Incident ID: {request.incident_id}\n\n"
            f"Transcript:\n{request.transcript}"
        )
