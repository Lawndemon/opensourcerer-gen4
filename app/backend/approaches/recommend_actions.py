"""
RecommendActionsApproach — LLM-generated support actions per role per incident.

Used by the support-role view (Session 5b/5c): when a support role opens an incident or
taps Refresh, this approach is called with (role, scene state, already-published items,
recently-dismissed items) and returns only the recommended actions the scene warrants
(0-5). The support role curates the list (check / X / Add Custom) and the curated/published
subset flows to the Fire Officer's kiosk Support Contributions pane.

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

from azure.search.documents.aio import SearchClient
from azure.search.documents.models import QueryType, VectorizedQuery
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam
from pydantic import BaseModel, Field, ValidationError
from pydantic.alias_generators import to_camel

from approaches.role_narratives import narrative_for
from models.incidents import RecommendationCategory, SceneConditionAndAction, SupportContribution

logger = logging.getLogger(__name__)

# Embedding models that accept an explicit output `dimensions` parameter (mirrors
# Approach.compute_text_embedding). ada-002 predates the parameter.
_DIMENSIONS_CAPABLE_EMBEDDING_MODELS = {
    "text-embedding-ada-002": False,
    "text-embedding-3-small": True,
    "text-embedding-3-large": True,
}


class _LLMRecommendation(BaseModel):
    """One LLM-produced recommendation: the action text plus its ICS urgency category."""

    model_config = {"alias_generator": to_camel, "populate_by_name": True, "extra": "forbid"}
    text: str
    category: RecommendationCategory


class _LLMRecommendationsResponse(BaseModel):
    """LLM-output shape; only the recommendations the scene genuinely warrants for the role.

    No minimum — an empty list is a valid, expected answer when nothing this role would
    add is relevant to the current scene type and conditions (SME 2026-05-25: support roles
    must be selective, not exhaustive). Capped at 5 to keep the list scannable under pressure.
    """

    model_config = {"alias_generator": to_camel, "populate_by_name": True, "extra": "forbid"}
    recommended_actions: list[_LLMRecommendation] = Field(default_factory=list, max_length=5)


class RecommendActionsApproach:
    """
    One LLM call producing the support-role recommendations the scene warrants (0-5).

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
        # Low temperature — selectivity and stability matter more than variety here. We want
        # only the genuinely-warranted items, returned consistently across re-validations so the
        # support list doesn't thrash mid-incident.
        temperature: float = 0.2,
        # --- KB retrieval (2026-06-16) ---------------------------------------------------
        # When a search_client is provided, run() retrieves grounding passages from the FULL
        # index (no allowed_roles filter — every role queries every document) using a query
        # built from the scene + the role's narrative, and injects them into the prompt. When
        # it's None (e.g. search not configured / local dev), retrieval is skipped and the
        # approach behaves exactly as before — pure-LLM over the scene.
        search_client: Optional[SearchClient] = None,
        embedding_model: Optional[str] = None,
        embedding_deployment: Optional[str] = None,
        embedding_dimensions: int = 1536,
        embedding_field: str = "embedding",
        query_language: str = "en-us",
        query_speller: str = "lexicon",
        use_semantic_ranker: bool = False,
        retrieve_top: int = 5,
    ):
        self.openai_client = openai_client
        self.chatgpt_model = chatgpt_model
        self.chatgpt_deployment = chatgpt_deployment
        self.temperature = temperature
        self.search_client = search_client
        self.embedding_model = embedding_model
        self.embedding_deployment = embedding_deployment
        self.embedding_dimensions = embedding_dimensions
        self.embedding_field = embedding_field
        self.query_language = query_language
        self.query_speller = query_speller
        self.use_semantic_ranker = use_semantic_ranker
        self.retrieve_top = retrieve_top
        self.system_prompt = self._load_prompt()

    def _load_prompt(self) -> str:
        if not self.PROMPT_FILE.exists():
            raise FileNotFoundError(f"Recommendations prompt not found at {self.PROMPT_FILE}")
        return self.PROMPT_FILE.read_text(encoding="utf-8")

    async def _embed_query(self, text: str) -> VectorizedQuery:
        """Embed the query text (mirrors Approach.compute_text_embedding's dimensions handling)."""
        model = self.embedding_model or "text-embedding-ada-002"
        extra = {"dimensions": self.embedding_dimensions} if _DIMENSIONS_CAPABLE_EMBEDDING_MODELS.get(model, False) else {}
        embedding = await self.openai_client.embeddings.create(
            model=self.embedding_deployment or self.embedding_model,
            input=text,
            **extra,
        )
        return VectorizedQuery(vector=embedding.data[0].embedding, k=50, fields=self.embedding_field)

    async def _retrieve(self, query_text: str) -> list[dict[str, Optional[str]]]:
        """Hybrid (text + vector) retrieval from the FULL index — no role/ACL filter applied.

        Returns lightweight source dicts (sourcefile, sourcepage, content). Best-effort: any
        retrieval failure logs and returns [] so recommendation generation still proceeds
        (degrades to pure-LLM rather than failing the whole call).
        """
        if self.search_client is None:
            return []
        try:
            vector_query = await self._embed_query(query_text)
            if self.use_semantic_ranker:
                results = await self.search_client.search(
                    search_text=query_text,
                    top=self.retrieve_top,
                    vector_queries=[vector_query],
                    query_type=QueryType.SEMANTIC,
                    query_language=self.query_language,
                    query_speller=self.query_speller,
                    semantic_configuration_name="default",
                    semantic_query=query_text,
                )
            else:
                results = await self.search_client.search(
                    search_text=query_text,
                    top=self.retrieve_top,
                    vector_queries=[vector_query],
                )
            sources: list[dict[str, Optional[str]]] = []
            async for doc in results:
                sources.append(
                    {
                        "sourcefile": doc.get("sourcefile"),
                        "sourcepage": doc.get("sourcepage"),
                        "content": doc.get("content"),
                    }
                )
            return sources
        except Exception as e:  # noqa: BLE001 — retrieval is best-effort grounding, never fatal
            logger.warning("recommend_actions retrieval failed (degrading to pure-LLM): %s", e)
            return []

    async def run(
        self,
        *,
        role: str,
        scene_summary_text: str,
        scene_conditions: list[SceneConditionAndAction],
        already_published: list[SupportContribution],
        recently_dismissed: list[str],
    ) -> list[_LLMRecommendation]:
        """Generate the role-appropriate recommended actions the scene warrants (0-5).

        `scene_type` is the Fire Officer's confirmed ICS Type (1-5), or None if not yet
        confirmed; `scene_type_estimate` is the AI's latest estimate, used as a fallback so
        the model can still scale its suggestions before the type is confirmed. The model is
        expected to return fewer (or no) items when the type/conditions don't warrant this
        role weighing in.
        """

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

        # --- KB retrieval (full index, no role filter) ----------------------------------
        # Query = role narrative + scene, so the SAME unfiltered index leans toward this role's
        # concerns. Backend-first (2026-06-16): we log what each role retrieves so we can judge
        # whether the role definitions alone surface relevant content; nothing is persisted yet.
        role_narrative = narrative_for(role)
        conditions_text = "; ".join(c["text"] for c in compact_conditions)
        retrieval_query = f"{role_narrative}\nScene: {scene_summary_text}\nConditions: {conditions_text}".strip()
        kb_sources = await self._retrieve(retrieval_query)
        logger.info(
            "recommend_actions retrieval role=%s sources=%d files=%s",
            role,
            len(kb_sources),
            [s.get("sourcepage") or s.get("sourcefile") for s in kb_sources],
        )

        # Inject the retrieved passages for grounding. The prompt instructs the model to treat
        # these as governing on conflict (Client>Region>Federal>Domain>model knowledge) and to
        # only fall back to general knowledge to fill gaps — never suppressing life-safety.
        kb_for_prompt = [
            {"source": s.get("sourcepage") or s.get("sourcefile"), "content": s.get("content")}
            for s in kb_sources
        ]

        user_message = json.dumps(
            {
                "role": role,
                "roleNarrative": role_narrative,
                "sceneSummary": scene_summary_text,
                "sceneConditionsAndActions": compact_conditions,
                "alreadyPublished": compact_published,
                "recentlyDismissed": recently_dismissed,
                "knowledgeBaseSources": kb_for_prompt,
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
