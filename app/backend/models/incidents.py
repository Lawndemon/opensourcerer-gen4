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

RecommendationCategory = Literal["life_safety", "incident_stabilization", "property_conservation"]
"""
ICS resource-priority category for a support recommendation, in urgency order:
life safety (most urgent) > incident stabilization > property conservation. Groups
recommendations under section headers in the support pane. `None` = uncategorized (e.g. a
human-typed custom item not yet categorized); uncategorized items are excluded from the Fire
Officer's auto-surfaced grouping.
"""


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


ContributionICStatus = Literal["not_gated", "pending", "approved", "rejected", "safety_bypass"]


class SupportContribution(_IncidentBase):
    """
    A single entry in the Support Contributions panel.

    Either KB-recommended-and-accepted by a support role, or custom-added by a support role.
    Display format on the Fire Officer view: `[support role] support condition text`, ordered by role.
    """

    id: str
    text: str
    source: Literal["recommended", "custom"]
    category: RecommendationCategory | None = None
    provenance: Literal["ai", "hic"] = "hic"  # "ai" = machine-suggested, not yet human-confirmed;
    # "hic" = Human In Charge has taken ownership. Defaults "hic" because every human publish is
    # an act of ownership; auto-generated contributions set "ai" explicitly.
    added_by: Actor
    added_at: str
    ic_status: ContributionICStatus = "not_gated"
    withdrawn: bool = False  # Soft-deleted by a support role (or IC) — hidden from kiosk but
    # retained for audit. Only AI-published items (provenance="ai") are withdrawable in v1.  # IC content gate: not_gated (pre-ToC,
    # visible), pending (awaiting IC), approved/rejected (IC decided), safety_bypass (Safety
    # Officer items go direct to the FO kiosk flagged, even with the gate active).


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


class FormFieldsContent(_IncidentBase):
    """
    Generic field-map content for ICS Canada forms whose layouts are the official
    interactive AcroForm PDFs (Forms 201, 202, 203, 204, 205, 207, 208, 211, 214, 215, 215A).

    `form_id_key` matches a key in `incidents/ics_pdf_templates/schemas.json`. On export,
    `incidents/pdf_filler.fill_form_pdf()` opens the official template and stamps `fields`
    into it; the user-visible PDF is pixel-identical to the official form. Edit UX is a
    generic field-list renderer driven by the schema — no per-form bespoke layout code.
    """

    kind: Literal["form_fields"] = "form_fields"
    form_type: str  # human-facing label, e.g. "ICS-208"
    form_id_key: str  # schema key, e.g. "ics_208"
    fields: dict[str, str] = Field(default_factory=dict)  # AcroForm field name -> value


FormContent = Annotated[
    Union[ICS201Content, PlaceholderFormContent, FormFieldsContent],
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
    "support_recommendation_attested",
    "form_generated",
    "form_locked",
    "phase_transitioned",
    "command_transferred",
    "support_contribution_ic_decided",
    "incident_locked",
    "form_content_edited",
    "support_contribution_withdrawn",
    # Legacy (read-only): scene tiers (5->1) were removed; incidents created before that may
    # still carry this event in their append-only log, so the type must still deserialize.
    # Never emitted by new code.
    "scene_type_confirmed",
    "role_control_taken",
    "role_control_released",
    "role_action_assigned",
    "role_action_commented",
    "role_action_resolved",
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


class PendingRecommendation(_IncidentBase):
    """
    One LLM-generated (or custom-added) support action waiting for a support role's
    publish / dismiss decision.

    Stays in the role's pending working set until either:
    - the role taps "check" (publish) → the item is converted into a SupportContribution
      and moved into IncidentDocument.support_contributions.
    - the role taps "X" (dismiss) → the item is removed from pending; an audit event
      records that this suggestion was considered and declined.

    `source` distinguishes KB-generated suggestions from role-typed custom entries; both
    require an explicit "check" before publishing to the Fire Officer's kiosk.
    """

    id: str
    text: str
    source: Literal["kb", "custom"]
    category: RecommendationCategory | None = None
    created_at: str
    created_by: Actor


class RoleRecommendations(_IncidentBase):
    """
    Per-role pending working set on an incident.

    Each support role that joins an incident gets one of these. Refreshing replaces the
    `items` list (the LLM regenerates from the current scene + already-published items +
    recently-dismissed items). The `last_generated_at` timestamp drives staleness
    detection on the frontend (button turns yellow when the scene has moved on since the
    role last refreshed).
    """

    role: str  # ActingRole — the support role that owns this list.
    items: list[PendingRecommendation] = Field(default_factory=list)
    last_generated_at: str | None = None


class RoleControl(_IncidentBase):
    """
    Who is currently driving a support role: the AI (default) or a human who took control.

    Per SME (2026-06): every support role starts AI-in-control. A human logged in as that role
    can "Take Control" (controller -> "human", recorded in `controlled_by`) and later "Stand
    Down" (controller -> "ai"). Absence of an entry for a role == AI-in-control. The append-only
    `role_control_taken` / `role_control_released` events are the source of truth; this is the
    derived current value. Drives the three application modes (Officer / Supervisor / Incident)
    and the AI->HIC provenance of that role's contributions.
    """

    role: str  # ActingRole whose control this represents.
    controller: Literal["ai", "human"] = "ai"
    controlled_by: Actor | None = None  # the human now driving the role; None when AI-controlled.
    since: str  # ISO-8601 timestamp of the last control change.


class RoleActionComment(_IncidentBase):
    """One append-only comment on a Role Action. Renders as a bullet under the action."""

    text: str
    author: Actor
    timestamp: str


class RoleAction(_IncidentBase):
    """A unit of work assigned to a support role — by the IC (Assign to <role>) or self-assigned
    (Take Ownership). Lives in that role's Role Actions pane. Comments are append-only; Resolve
    closes it. Every assign / comment / resolve is an append-only audit event.
    """

    id: str
    text: str
    assigned_to: str  # ActingRole that owns this action.
    assigned_by: Actor  # who assigned it (the IC, or the role itself for self-assignment).
    source: Literal["ic_assigned", "self_assigned"] = "self_assigned"
    source_recommendation_id: str | None = None  # the support contribution this came from, if any.
    status: Literal["open", "resolved"] = "open"
    comments: list[RoleActionComment] = Field(default_factory=list)
    created_at: str
    resolved_at: str | None = None
    resolved_by: Actor | None = None


class IncidentDocument(_IncidentBase):
    """
    Persistence shape for an incident record in Cosmos.

    Combines current-state fields with the append-only event log. Single source of truth
    per incident — point-read by (tenant_id, id) returns full state including the audit log.

    **Partition key:** hierarchical `[/tenantId, /id]`. Strong tenant isolation at the
    storage layer per BACKLOG.md → "Multi-tenant Entra architecture". `tenant_id` defaults
    to `"default"` until real tenants are wired through the `tid` claim.

    **Immutability contract:** `event_log` is append-only forever. `transcript` is
    append-only forever (radio chatter is audit-of-record per BACKLOG.md). The current-state
    fields (`scene_*`, `forms`, etc.) are *derived* but persisted for read efficiency — every
    state change must produce both a state-field update and an `event_log` entry recording it.
    """

    id: str  # = incident_id; second level of the hierarchical partition key.
    tenant_id: str = "default"  # first level of the hierarchical partition key.
    phase: IncidentPhase
    created_by: Actor
    created_at: str
    loss_stopped_at: str | None = None
    command_transferred_at: str | None = None  # None = Fire Officer in charge; set = IC has
    # taken command (one-way v1). Append-only `command_transferred` event is the source of truth.
    closed_at: str | None = None
    locked_at: str | None = None  # Terminal seal — set by IC/Admin via CloseoutAdmin. Once set,
    # ALL user mutations are rejected (the incident is the final corporate/municipal/federal record).
    locked_by: Actor | None = None
    transcript: list[TranscriptChunk] = Field(default_factory=list)
    scene_summary: SceneSummary
    scene_conditions_and_actions: list[SceneConditionAndAction] = Field(default_factory=list)
    support_contributions: list[SupportContribution] = Field(default_factory=list)
    forms: list[FormSummary] = Field(default_factory=list)
    event_log: list[AuditEvent] = Field(default_factory=list)
    # Session 5b: per-role pending recommendation working sets. One entry per role that has
    # joined the incident. Items are LLM-generated or custom-added and require explicit
    # publish ("check") to appear on the Fire Officer kiosk's Support Contributions pane.
    role_recommendations: list[RoleRecommendations] = Field(default_factory=list)
    # Per-role control state (SME 2026-06): which support roles a human has taken control of.
    # Role absent == AI-in-control (the default). Source of truth is the append-only
    # role_control_taken / role_control_released events; this is the derived current value.
    role_controls: list[RoleControl] = Field(default_factory=list)
    # Role Actions (SME 2026-06): per-role units of work assigned by the IC or self-assigned
    # (Take Ownership). Append-only comments + a resolve flag; surfaced in the Role Actions pane.
    role_actions: list[RoleAction] = Field(default_factory=list)


# === INCIDENT CRUD REQUEST / RESPONSE (Session 3) ===


class CreateIncidentRequest(_IncidentBase):
    """
    Request body for `POST /api/incidents`.

    Optional `transcript` lets the kiosk pre-seed an incident with fixture text in the
    prototype. Once streaming STT lands, incidents will be created empty and the transcript
    appended chunk-by-chunk from the mic.
    """

    acting_role: str
    transcript: str | None = None
    tenant_id: str | None = None  # overridable for testing; falls back to "default" or auth tid.


class LossStopRequest(_IncidentBase):
    """
    Request body for `POST /api/incidents/{id}/loss-stop`.

    `acting_role` and `user_id` are recorded on the resulting `phase_transitioned` audit
    event. Only Fire Officer (or admin) is authorized to press Loss Stop in v1; enforcement
    will tighten as the role system matures.
    """

    acting_role: str
    user_id: str


class RoleControlRequest(_IncidentBase):
    """Request body for take-control / stand-down on a support role.

    `acting_role` is the role the human is logged in as; it must match the role in the URL path
    (a human may only take or release control of their OWN role). `user_id` is recorded on the
    `role_control_taken` / `role_control_released` audit event.
    """

    acting_role: str
    user_id: str


class AssignRoleActionRequest(_IncidentBase):
    """Create a Role Action. `assigned_to` is the role that will own it. `source` is
    "self_assigned" (Take Ownership; assigned_to must equal acting_role) or "ic_assigned"
    (the IC assigns to a role; acting_role must be the Incident Commander).
    """

    text: str
    assigned_to: str
    source: Literal["ic_assigned", "self_assigned"] = "self_assigned"
    source_recommendation_id: str | None = None
    acting_role: str
    user_id: str


class RoleActionCommentRequest(_IncidentBase):
    """Append a comment to a Role Action (renders as a bullet)."""

    text: str
    acting_role: str
    user_id: str


class RoleActionResolveRequest(_IncidentBase):
    """Resolve (close) a Role Action."""

    acting_role: str
    user_id: str


class TransferOfCommandRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/transfer-of-command`.

    The Incident Commander deliberately assumes command (the gatekeeper workflow), distinct
    from merely being logged in. One-way in v1: command stays with the IC until the incident
    closes. `acting_role` must be the IC; `user_id` is recorded on the `command_transferred`
    audit event.
    """

    acting_role: str
    user_id: str


class ICDecisionRequest(_IncidentBase):
    """Request body for the IC approve/reject of a gated support contribution (post-ToC)."""

    decision: Literal["approved", "rejected"]
    acting_role: str
    user_id: str


class LockIncidentRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/lock` — final, terminal seal of the incident."""

    acting_role: str
    user_id: str


class UpdateAllFormsRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/forms/update-all` — regenerate every role's forms."""

    acting_role: str
    user_id: str


class SaveFormContentRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/forms/{formId}/content` — manual edit of a form's content during cleanup."""

    content: FormContent
    acting_role: str
    user_id: str


class WithdrawContributionRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/support-contributions/{cid}/withdraw`.

    A human user (the role that originally owns the AI item, or the IC as override) pulls
    back an AI-published recommendation. Hides it from the kiosk; retained for audit.
    """

    acting_role: str
    user_id: str


class AttestContributionRequest(_IncidentBase):
    """
    Request body for `POST /api/incidents/{id}/support-contributions/{contributionId}/attest`.

    `acting_role` and `user_id` are the human confirming an AI-suggested recommendation;
    recorded on the resulting `support_recommendation_attested` audit event (the AI -> HIC flip).
    """

    acting_role: str
    user_id: str


class RemoveConditionRequest(_IncidentBase):
    """
    Request body for `DELETE /api/incidents/{id}/conditions/{conditionId}`.

    Per immutability principle, removal is a *flag* (`removed=True`), never a delete.
    Sticky-with-resurfacing: a removed condition can re-surface on a later Validate IAP if
    new transcript evidence supports it (audit event type `condition_resurfaced`).
    """

    acting_role: str
    user_id: str


# === SUPPORT ROLE RECOMMENDATIONS (Session 5b) ============================


class RefreshRecommendationsRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/support-recommendations/refresh`."""

    acting_role: str
    user_id: str


class AutoPopulateRecommendationsRequest(_IncidentBase):
    """
    Request body for `POST /api/incidents/{id}/auto-populate-recommendations`.

    `acting_role` / `user_id` identify the human (Fire Officer) who triggered auto-population
    by confirming the scene Type. Generated items are tagged to each support role; the actor
    here is just the triggerer.
    """

    acting_role: str
    user_id: str


class GetRecommendationsResponse(_IncidentBase):
    """Response body for the GET and refresh endpoints. Returns the role's current list."""

    role: str
    items: list[PendingRecommendation] = Field(default_factory=list)
    last_generated_at: str | None = None
    # The frontend uses this to drive the Refresh button's stale/fresh state. If the
    # incident's scene state has moved on since `last_generated_at`, recommendations are
    # stale.
    scene_last_updated: str | None = None


class PublishRecommendationRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/support-recommendations/{recId}/publish`."""

    acting_role: str
    user_id: str


class DismissRecommendationRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/support-recommendations/{recId}/dismiss`."""

    acting_role: str
    user_id: str


class AddCustomRecommendationRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/support-recommendations/custom`.

    Custom items go into the role's pending list (source="custom") and require the same
    "check" publish step as KB-generated items — matches the spec from 2026-05-13.
    """

    text: str
    acting_role: str
    user_id: str


# === EXTRACT FORMS (5d.1 — decoupled forms extraction) ====================


class ExtractFormsRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/extract-forms`.

    Runs the downstream forms extraction off the critical path so the Fire Officer's
    scene dashboard renders immediately and forms populate in the background.

    Scene source resolution (server-side):
    - If the incident is persisted in Cosmos, the endpoint reads the authoritative scene
      state from the persisted document and IGNORES the optional scene fields below.
    - If the incident is NOT persisted (ephemeral demo path, Cosmos disabled), the
      endpoint uses `scene_summary` + `scene_conditions_and_actions` from this request.
      They are required in that case.
    """

    acting_role: str
    # Optional (5e): the kiosk passes the scenario transcript directly. The support-role
    # "Update forms" path omits it — the endpoint then derives the transcript from the
    # persisted incident's transcript chunks (or falls back to scene-state-only).
    transcript: str = ""
    scene_summary: SceneSummary | None = None
    scene_conditions_and_actions: list[SceneConditionAndAction] = Field(default_factory=list)


class ExtractFormsResponse(_IncidentBase):
    """Response body for `POST /api/incidents/{id}/extract-forms`."""

    forms: list[FormSummary] = Field(default_factory=list)


class CloseIncidentRequest(_IncidentBase):
    """Request body for `POST /api/incidents/{id}/close` (5e).

    Closing transitions the incident to the terminal `recovery` phase, which drops it from
    the support-role incident list (`list_incidents(exclude_recovery=True)`). The record is
    NOT deleted — it stays auditable per the immutability principle.

    Authorization (enforced in the endpoint): `acting_role` must be `safety-officer` or
    `site-administrator`, and the incident must be in `transition_to_recovery`.
    """

    acting_role: str
    user_id: str
