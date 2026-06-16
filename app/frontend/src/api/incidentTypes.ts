/**
 * TypeScript shapes for the Validate IAP contract.
 * Mirrors the Pydantic models in `app/backend/models/incidents.py`. Wire format is camelCase.
 */

import type { ActingRole } from "../roles";

export type ConditionStatus = "conforming" | "deviating_safe" | "deviating_unsafe";
export type ItemType = "condition" | "action";
export type IncidentPhase = "response" | "transition_to_recovery" | "recovery";
export type CitationTier = "client" | "region" | "federal" | "domain";

export interface Actor {
    role: ActingRole | string;
    userId: string;
}

export interface ConditionCitation {
    sourceFile: string;
    sourceTier: CitationTier;
    pageOrSection: string;
    excerpt: string;
}

export interface ConditionRefinement {
    timestamp: string;
    selectedStatement: string;
    selectedBy: Actor;
}

export interface SceneConditionAndAction {
    id: string;
    type: ItemType;
    text: string;
    status: ConditionStatus;
    publishedPlanContext: string | null;
    clientPlanContext: string | null;
    delta: string | null;
    citations: ConditionCitation[];
    removed: boolean;
    removedAt: string | null;
    removedBy: Actor | null;
    refinements: ConditionRefinement[];
    firstDetectedAt: string;
    lastConfirmedAt: string;
}

export type RecommendationCategory = "life_safety" | "incident_stabilization" | "property_conservation";

export type ContributionICStatus = "not_gated" | "pending" | "approved" | "rejected" | "safety_bypass";

export interface SupportContribution {
    id: string;
    text: string;
    source: "recommended" | "custom";
    /** ICS urgency category; null = uncategorized (groups under "Other"). */
    category: RecommendationCategory | null;
    /** "ai" = machine-suggested, not yet human-confirmed; "hic" = Human In Charge owns it. */
    provenance: "ai" | "hic";
    /** IC content gate state. Shown on the FO kiosk when not_gated / approved / safety_bypass. */
    icStatus: ContributionICStatus;
    /** Soft-deleted by the owning support role or the IC. Hidden from the kiosk; retained for audit. */
    withdrawn: boolean;
    addedBy: Actor;
    addedAt: string;
}

export interface SceneSummary {
    text: string;
    lastUpdated: string;
}

export interface FormSection {
    heading: string;
    body: string;
}

export interface ICS201Content {
    kind: "ics_201";
    formType: "ICS-201";
    incidentName: string;
    dateTimeInitiated: string;
    situationSummary: string;
    currentObjectives: string;
    currentActions: string;
    resourceSummary: string;
    preparedBy: string;
}

export interface PlaceholderFormContent {
    kind: "placeholder";
    formType: string;
    title: string;
    sections: FormSection[];
}

/** Generic field-map content for official ICS Canada PDF-backed forms.
 *  Key in `form_id_key` references the backend schemas at /api/ics-forms/schemas. */
export interface FormFieldsContent {
    kind: "form_fields";
    formType: string;
    formIdKey: string;
    fields: Record<string, string>;
}

/** ICS PDF schema as returned by GET /api/ics-forms/schemas (form_id_key -> schema). */
export interface IcsFormFieldDef {
    /** AcroForm field name (`/T`). Used as the key in `FormFieldsContent.fields` and the
     *  fill target in the official PDF on export. Often opaque (e.g. "Text01"). */
    name: string;
    /** Cleaned human-readable label derived from the AcroForm `/TU` tooltip if present,
     *  otherwise the field name. Use this for display in editors. */
    label: string;
    type: string;
    maxLen: number | null;
}
export interface IcsFormSchema {
    formId: string;
    title: string;
    pdfFile: string;
    pageCount: number;
    fieldCount: number;
    fields: IcsFormFieldDef[];
}
export type IcsFormSchemas = Record<string, IcsFormSchema>;

export type FormContent = ICS201Content | PlaceholderFormContent | FormFieldsContent;

export interface FormSummary {
    formId: string;
    title: string;
    role: ActingRole | string;
    status: "active" | "locked";
    content: FormContent;
    lastUpdated: string;
}

export interface ValidateIAPRequest {
    incidentId: string;
    transcript: string;
    actingRole: ActingRole | string;
}

export interface ValidateIAPResponse {
    incidentId: string;
    phase: IncidentPhase;
    sceneSummary: SceneSummary;
    sceneConditionsAndActions: SceneConditionAndAction[];
    supportContributions: SupportContribution[];
    forms: FormSummary[];
}

// ============================================================================
// PERSISTENCE — INCIDENT DOCUMENT + AUDIT LOG (Session 3)
// ============================================================================

export type AuditEventType =
    | "condition_extracted"
    | "condition_status_changed"
    | "condition_removed"
    | "condition_resurfaced"
    | "condition_refined"
    | "support_contribution_added"
    | "support_recommendation_dismissed"
    | "form_generated"
    | "form_locked"
    | "phase_transitioned"
    | "role_control_taken"
    | "role_control_released"
    | "fire_officer_resumed"
    | "role_action_assigned"
    | "role_action_commented"
    | "role_action_resolved";

export interface AuditEvent {
    id: string;
    incidentId: string;
    type: AuditEventType;
    timestamp: string;
    actor: Actor | "system";
    payload: Record<string, unknown>;
}

export interface TranscriptChunk {
    chunkId: string;
    timestamp: string;
    text: string;
    deNoised: string | null;
}

export interface IncidentDocument {
    id: string;
    tenantId: string;
    phase: IncidentPhase;
    createdBy: Actor;
    createdAt: string;
    lossStoppedAt: string | null;
    /** null = Fire Officer in charge; set = IC has taken command (Transfer of Command, one-way v1). */
    commandTransferredAt: string | null;
    closedAt: string | null;
    /** Terminal seal. Once set, ALL user mutations are rejected (final corporate/municipal/federal record). */
    lockedAt: string | null;
    lockedBy: Actor | null;
    transcript: TranscriptChunk[];
    sceneSummary: SceneSummary;
    sceneConditionsAndActions: SceneConditionAndAction[];
    supportContributions: SupportContribution[];
    forms: FormSummary[];
    eventLog: AuditEvent[];
    // Session 5b: per-role pending recommendation working sets. One entry per role
    // that has joined the incident. Items require an explicit publish step before
    // they appear on the Fire Officer's kiosk.
    roleRecommendations: RoleRecommendations[];
    // Per-role control state (SME 2026-06): which support roles a human has taken control of.
    // Role absent == AI-in-control (the default). Derived from append-only role_control events.
    roleControls: RoleControl[];
    // Role Actions (SME 2026-06): per-role units of work (IC-assigned or self-assigned).
    roleActions: RoleAction[];
}

// ============================================================================
// REQUEST / RESPONSE — INCIDENT CRUD (Session 3)
// ============================================================================

export interface CreateIncidentRequest {
    actingRole: ActingRole | string;
    transcript?: string;
    tenantId?: string;
}

export interface IncidentEnvelope {
    incident: IncidentDocument;
}

/** Response body for `GET /api/incidents` (Session 5 — IMT incident dashboard). */
export interface IncidentListResponse {
    incidents: IncidentDocument[];
}

export interface LossStopRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface RoleControlRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface AssignRoleActionRequest {
    text: string;
    assignedTo: ActingRole | string;
    source?: "ic_assigned" | "self_assigned";
    sourceRecommendationId?: string | null;
    actingRole: ActingRole | string;
    userId: string;
}

export interface RoleActionCommentRequest {
    text: string;
    actingRole: ActingRole | string;
    userId: string;
}

export interface RoleActionResolveRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface TransferOfCommandRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface ICDecisionRequest {
    decision: "approved" | "rejected";
    actingRole: ActingRole | string;
    userId: string;
}

export interface LockIncidentRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface SaveFormContentRequest {
    content: FormContent;
    actingRole: ActingRole | string;
    userId: string;
}

export interface WithdrawContributionRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface AttestContributionRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface AutoPopulateRecommendationsRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface RemoveConditionRequest {
    actingRole: ActingRole | string;
    userId: string;
}

// ============================================================================
// REQUEST / RESPONSE — REFINE CONDITION (Session 4)
// ============================================================================

export interface RefineConditionResponse {
    conditionId: string;
    narrowingStatements: string[];
}

export interface ApplyRefinementRequest {
    /** Selected narrowing statement, or null for "None of the above". */
    selectedStatement: string | null;
    actingRole: ActingRole | string;
    userId: string;
}

export interface ApplyRefinementResponse {
    updatedCondition: SceneConditionAndAction;
}

// ============================================================================
// REQUEST / RESPONSE — SUPPORT-ROLE RECOMMENDATIONS (Session 5b)
// ============================================================================

/**
 * One LLM-generated (or custom-added) support action waiting for a support role's
 * publish / dismiss decision. Stays in the role's pending working set until either
 * published (becomes a SupportContribution visible to the Fire Officer) or dismissed
 * (removed, audit event recorded so the next refresh can avoid repeating it).
 */
export interface PendingRecommendation {
    id: string;
    text: string;
    source: "kb" | "custom";
    /** ICS urgency category; null = uncategorized. */
    category: RecommendationCategory | null;
    createdAt: string;
    createdBy: Actor;
}

/**
 * Per-role pending working set on an incident. Each support role that has joined the
 * incident gets one entry. Refreshing replaces `items` (LLM regenerates from the
 * current scene + already-published items + recently-dismissed items).
 */
export interface RoleRecommendations {
    role: ActingRole | string;
    items: PendingRecommendation[];
    lastGeneratedAt: string | null;
}

/** Who currently drives a support role: the AI (default) or a human who took control. */
export interface RoleControl {
    role: ActingRole | string;
    controller: "ai" | "human";
    controlledBy: Actor | null;
    since: string;
}

/** One append-only comment on a Role Action (renders as a bullet under the action). */
export interface RoleActionComment {
    text: string;
    author: Actor;
    timestamp: string;
}

/** A unit of work owned by a support role — IC-assigned or self-assigned (Take Ownership). */
export interface RoleAction {
    id: string;
    text: string;
    assignedTo: ActingRole | string;
    assignedBy: Actor;
    source: "ic_assigned" | "self_assigned";
    sourceRecommendationId: string | null;
    status: "open" | "resolved";
    comments: RoleActionComment[];
    createdAt: string;
    resolvedAt: string | null;
    resolvedBy: Actor | null;
}

/**
 * Response shape for the GET and refresh endpoints. `sceneLastUpdated` is the
 * scene-summary's last-updated timestamp; the frontend uses it (alongside its own
 * scene-items hash) to drive the Refresh button's stale/fresh state.
 */
export interface GetRecommendationsResponse {
    role: ActingRole | string;
    items: PendingRecommendation[];
    lastGeneratedAt: string | null;
    sceneLastUpdated: string | null;
}

export interface RefreshRecommendationsRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface PublishRecommendationRequest {
    actingRole: ActingRole | string;
    userId: string;
    /** Route the published item: "fo" = direct to Fire Officer; "ic" = to the IC approval queue. */
    target?: "fo" | "ic";
}

export interface DismissRecommendationRequest {
    actingRole: ActingRole | string;
    userId: string;
}

export interface AddCustomRecommendationRequest {
    text: string;
    actingRole: ActingRole | string;
    userId: string;
    category?: RecommendationCategory | null;
}

// ============================================================================
// REQUEST / RESPONSE — EXTRACT FORMS (5d.1 — decoupled forms extraction)
// ============================================================================

/**
 * Request body for `POST /api/incidents/{id}/extract-forms`.
 *
 * When the incident is persisted, the backend reads the authoritative scene state from
 * Cosmos and ignores the scene fields below. For the ephemeral demo path (Cosmos off),
 * the scene fields are required — the frontend passes what it just got from the scene call.
 */
export interface ExtractFormsRequest {
    actingRole: ActingRole | string;
    /**
     * Optional (5e). The kiosk passes the scenario transcript; the support-role "Update
     * forms" path omits it and the backend derives the transcript from the persisted
     * incident's chunks.
     */
    transcript?: string;
    sceneSummary?: SceneSummary | null;
    sceneConditionsAndActions?: SceneConditionAndAction[];
}

export interface ExtractFormsResponse {
    forms: FormSummary[];
}

/**
 * Request body for `POST /api/incidents/{id}/close` (5e). Closing transitions the incident
 * to the terminal recovery phase, dropping it from the support-role list. Authorized for
 * Safety Officer + Site Administrator, only from Transition to Recovery.
 */
export interface CloseIncidentRequest {
    actingRole: ActingRole | string;
    userId: string;
}
