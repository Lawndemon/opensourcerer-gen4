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

export interface SupportContribution {
    id: string;
    text: string;
    source: "recommended" | "custom";
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

export type FormContent = ICS201Content | PlaceholderFormContent;

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
    | "phase_transitioned";

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
    closedAt: string | null;
    transcript: TranscriptChunk[];
    sceneSummary: SceneSummary;
    sceneConditionsAndActions: SceneConditionAndAction[];
    supportContributions: SupportContribution[];
    forms: FormSummary[];
    eventLog: AuditEvent[];
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
