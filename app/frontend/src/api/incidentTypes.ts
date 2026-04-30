/**
 * TypeScript shapes for the Validate IAP contract.
 *
 * Mirrors the Pydantic models in `app/backend/models/incidents.py` and the contract documented in
 * `docs/prototype_plan.md` Decisions section. Wire format is camelCase.
 */

import type { ActingRole } from "../roles";

// ============================================================================
// ENUMS / DISCRIMINATORS
// ============================================================================

/**
 * Traffic-light status encoding life-risk severity.
 *
 * - `conforming`         green check;  conforms with KB guidance.
 * - `deviating_safe`     yellow !;     deviates from KB but does NOT put human life at risk.
 * - `deviating_unsafe`   red X;        deviates from KB AND puts human life at risk.
 */
export type ConditionStatus = "conforming" | "deviating_safe" | "deviating_unsafe";

/**
 * Whether a row in the Scene Conditions and Actions list represents an observed condition
 * or an action the Fire Officer / crew has taken.
 */
export type ItemType = "condition" | "action";

/**
 * Incident lifecycle phase. v1 prototype only ships `response`; the others exist as
 * architectural hooks (BACKLOG.md → Incident-centric architecture → Incident lifecycle).
 */
export type IncidentPhase = "response" | "transition_to_recovery" | "recovery";

/**
 * Document precedence tier for citations in the retrieval cascade.
 * Client > Region > Federal > Domain.
 */
export type CitationTier = "client" | "region" | "federal" | "domain";

// ============================================================================
// SHARED TYPES
// ============================================================================

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

// ============================================================================
// SCENE / SUPPORT ITEMS
// ============================================================================

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

// ============================================================================
// SCENE SUMMARY
// ============================================================================

export interface SceneSummary {
    text: string;
    lastUpdated: string;
}

// ============================================================================
// FORMS
// ============================================================================

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

// ============================================================================
// REQUEST / RESPONSE
// ============================================================================

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
