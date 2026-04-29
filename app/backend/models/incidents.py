"""
Pydantic models for the Validate IAP contract.

Mirrors the TypeScript contract in `docs/prototype_plan.md` Decisions section. JSON serialization
uses camelCase (`alias_generator=to_camel`) so the wire format matches the frontend's expectations
while Python attributes stay snake_case per PEP 8.

Field semantics that aren't obvious from types:

- `SceneConditionAndAction.status` — encodes life-risk severity per SME 2026-04-29: `conforming` is
  green, `deviating_safe` is yellow (deviates from KB but does NOT put human life at risk),
  `deviating_unsafe` is red (deviates AND puts human life at risk).
- `SceneConditionAndAction.removed` — Fire Officer curation. Sticky-by-default but new transcript
  evidence post-`removed_at` can resurface (per the SME's "fire on / fire off / fire back on"
  semantics). The extraction prompt is responsible for honoring this.
- `IncidentDocument.event_log` — append-only audit trail. Source of truth for state changes. Current
  state fields (sceneSummary, sceneConditionsAndActions, etc.) are derived but persisted for read
  efficiency.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# === SHARED CONFIG ===


class _IncidentBase(BaseModel):
    """Base for every incident-related model. camelCase JSON ↔ snake_case Python."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        # Forbid extra fields on the wire to catch contract drift early.
        extra="forbid",
    )


# === ENUMS / DISCRIMINATORS ===


ConditionStatus = Literal["conforming", "deviating_safe", "deviating_unsafe"]
"""
Traffic-light status encoding life-risk severity.

- `conforming` — green check; conforms with KB guidance.
- `deviating_safe` — yellow !; deviates from KB but does NOT put human life at risk.
- `deviating_unsafe` — red X; deviates from KB AND puts human life at risk.
"""

ItemType = Literal["condition", "action"]
"""
- `condition` — observed state (e.g., "fire on scene").
- `action` — command or operation taken (e.g., "RIT team deployed").
"""

IncidentPhase = Literal["response", "transition_to_recovery", "recovery"]
"""
- `response` — live; Fire Officer driving the scene.
- `transition_to_recovery` — Loss Stop pressed; supporting roles enriching/closing forms.
- `recovery` — fully locked; reviewable. Future scope.
"""

CitationTier = Literal["client", "region", "federal", "domain"]
"""Document precedence tier. Client > Region > Federal > Domain."""


# === ACTOR ===


class Actor(_IncidentBase):
    """The role+user that performed an action. Audit-log-friendly."""

    role: str  # ActingRole values from the frontend taxonomy; not Literal-constrained here so the
    # backend doesn't need to track every role rename.
    user_id: str


# === CITATIONS ===


class ConditionCitation(_IncidentBase):
    """Single supporting passage from the knowledgebase."""

    source_file: str
    source_tier: CitationTier
    page_or_section: str
    excerpt: str


# === REFINEMENTS ===


class ConditionRefinement(_IncidentBase):
    """One refinement event applied to a Scene Condition or Action."""

    timestamp: str
    selected_statement: str
    selected_by: Actor


# === SCENE / SUPPORT ITEMS ===


class SceneConditionAndAction(_IncidentBase):
    """
    A single row in the Scene Conditions and Actions panel.

    Either an observed condition or a taken action. Status encodes life-risk severity.
    """

    id: str
    type: ItemType
    text: str
    status: ConditionStatus
    published_plan_context: str | None = None
    client_plan_context: str | None = None
    delta: str | None = None
    citations: list[ConditionCitation] = Field(default_factory=list)
    removed: bool = False
    removed_at: str | None = None
    removed_by: Actor | None = None
    refinements: list[ConditionRefinement] = Field(default_factory=list)
    first_detected_at: str
    last_confirmed_at: str


class SupportContribution(_IncidentBase):
    """
    A single entry in the Support Contributions panel.

    Either KB-recommended-and-accepted by a support role, or custom-added by a support role.
    Display format on the Fire Officer view: `[support role] support condition text`, ordered by role.
    """

    id: str
    text: str
    source: Literal["recommended", "custom"]
    added_by: Actor
    added_at: str


# === SCENE SUMMARY ===


class SceneSummary(_IncidentBase):
    """
    Top-of-screen synopsis of the current scene state.

    Free text, max ~3 lines (the extraction prompt enforces brevity).
    """

    text: str
    last_updated: str


# === FORMS ===


class FormSection(_IncidentBase):
    """One section of a placeholder form."""

    heading: str
    body: str


class ICS201Content(_IncidentBase):
    """
    Structured ICS Form 201 (Incident Briefing) content. Discriminated by `kind`.

    Fields mirror the real form layout so the frontend can render in a SME-recognizable shape
    rather than as free-form markdown.
    """

    kind: Literal["ics_201"] = "ics_201"
    form_type: Literal["ICS-201"] = "ICS-201"
    incident_name: str
    date_time_initiated: str
    situation_summary: str
    current_objectives: str
    current_actions: str
    resource_summary: str
    prepared_by: str


class PlaceholderFormContent(_IncidentBase):
    """
    Generic placeholder form for v1 forms that don't have their own schema yet.
    Discriminated by `kind`.
    """

    kind: Literal["placeholder"] = "placeholder"
    form_type: str  # e.g., "AIPform1", "SafetyOfficerForm1"
    title: str
    sections: list[FormSection] = Field(default_factory=list)


FormContent = Annotated[
    Union[ICS201Content, PlaceholderFormContent],
    Field(discriminator="kind"),
]


class FormSummary(_IncidentBase):
    """
    A single form attached to an incident. Per-role: each role has their own form tab strip.
    """

    form_id: str
    title: str
    role: str  # ActingRole; which role's tab strip this belongs to.
    status: Literal["active", "locked"]
    content: FormContent
    last_updated: str


# === AUDIT LOG ===


AuditEventType = Literal[
    "condition_extracted",
    "condition_status_changed",
    "condition_removed",
    "condition_resurfaced",
    "condition_refined",
    "support_contribution_added",
    "support_recommendation_dismissed",
    "form_generated",
    "form_locked",
    "phase_transitioned",
]


class AuditEvent(_IncidentBase):
    """
    One entry in the incident's append-only event log.

    The event log is the source of truth for state changes; the current-state fields
    (`scene_conditions_and_actions`, etc.) on the incident document are derived but
    persisted for read efficiency.
    """

    id: str
    incident_id: str
    type: AuditEventType
    timestamp: str
    # `actor` is either an Actor or the literal string "system" (LLM/automated extraction).
    actor: Actor | Literal["system"]
    payload: dict[str, Any] = Field(default_factory=dict)


# === TRANSCRIPT ===


class TranscriptChunk(_IncidentBase):
    """
    One chunk of incident transcript. Append-only.

    `text` is the raw captured text (radio chatter). `de_noised` is a derived artifact
    produced by the de-noising preprocessor; both are retained per the immutability principle.
    """

    chunk_id: str
    timestamp: str
    text: str
    de_noised: str | None = None


# === REQUEST / RESPONSE ===


class ValidateIAPRequest(_IncidentBase):
    """
    Request body for POST /api/incidents/{id}/validate-iap.

    For Session 1 the prototype accepts a single `transcript` string for simplicity. Once
    streaming STT lands, the backend reads the appended TranscriptChunks from the incident
    record instead of taking the transcript on each request.
    """

    incident_id: str
    transcript: str
    acting_role: str  # "fire-officer" for the kiosk path; ActingRole from the frontend taxonomy.


class ValidateIAPResponse(_IncidentBase):
    """
    Response body for POST /api/incidents/{id}/validate-iap.

    `forms` is filtered server-side to the requesting role's forms.
    `support_contributions` is empty in the v1 prototype (placeholder; full implementation post-demo).
    """

    incident_id: str
    phase: IncidentPhase
    scene_summary: SceneSummary
    scene_conditions_and_actions: list[SceneConditionAndAction] = Field(default_factory=list)
    support_contributions: list[SupportContribution] = Field(default_factory=list)
    forms: list[FormSummary] = Field(default_factory=list)


# === REFINE CONDITION REQUEST / RESPONSE ===


class RefineConditionResponse(_IncidentBase):
    """
    Response body for POST /api/incidents/{id}/conditions/{conditionId}/refine.

    `narrowing_statements` contains exactly 3 LLM-generated statements derived from the KB.
    The frontend appends a "None of the above" option in the popup.
    """

    condition_id: str
    narrowing_statements: list[str]


class ApplyRefinementRequest(_IncidentBase):
    """
    Request body for POST /api/incidents/{id}/conditions/{conditionId}/refine/apply.

    `selected_statement` is the chosen narrowing statement, or `None` for "None of the above".
    """

    selected_statement: str | None
    acting_role: str
    user_id: str


class ApplyRefinementResponse(_IncidentBase):
    """Returns the re-evaluated condition after refinement is applied."""

    updated_condition: SceneConditionAndAction


# === INCIDENT DOCUMENT (Cosmos persistence — Session 3) ===


class IncidentDocument(_IncidentBase):
    """
    Persistence shape for an incident record in Cosmos.

    Combines current-state fields with the append-only event log. Session 1 doesn't yet
    persist; this model lives here so Session 3's Cosmos integration matches the contract.
    """

    id: str  # = incident_id; Cosmos partition key.
    tenant_id: str = "default"  # placeholder until multi-tenant is wired.
    phase: IncidentPhase
    created_by: Actor
    created_at: str
    loss_stopped_at: str | None = None
    closed_at: str | None = None
    transcript: list[TranscriptChunk] = Field(default_factory=list)
    scene_summary: SceneSummary
    scene_conditions_and_actions: list[SceneConditionAndAction] = Field(default_factory=list)
    support_contributions: list[SupportContribution] = Field(default_factory=list)
    forms: list[FormSummary] = Field(default_factory=list)
    event_log: list[AuditEvent] = Field(default_factory=list)
