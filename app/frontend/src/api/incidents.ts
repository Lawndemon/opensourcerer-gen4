/**
 * API client for the incident endpoints (Fire Officer kiosk).
 *
 * Uses relative URLs so the request lands at the same origin as the SPA. Authentication is
 * handled by Container Apps' built-in auth (Easy Auth): the AppServiceAuthSession cookie rides
 * along via `credentials: "include"`, AND every call attaches a fresh bearer token via
 * getBearerAuthHeaders() (2026-07-21). The bearer matters: Easy Auth's injected
 * x-ms-token-aad-access-token header goes stale after ~1h and the backend's OBO exchange then
 * 403s — getBearerAuthHeaders() transparently refreshes via `.auth/refresh`, exactly like the
 * chat API's getToken() path always did.
 *
 * For environments where Easy Auth isn't in front (e.g., local dev with USE_LOGIN=false),
 * getBearerAuthHeaders() returns {} and behavior is unchanged.
 */

import { getBearerAuthHeaders } from "../authConfig";
import type {
    AddCustomRecommendationRequest,
    AttestContributionRequest,
    RoleControlRequest,
    AssignRoleActionRequest,
    RoleActionCommentRequest,
    RoleActionResolveRequest,
    TransferOfCommandRequest,
    ICDecisionRequest,
    LockIncidentRequest,
    SaveFormContentRequest,
    IcsFormSchemas,
    WithdrawContributionRequest,
    AutoPopulateRecommendationsRequest,
    ApplyRefinementRequest,
    ApplyRefinementResponse,
    CloseIncidentRequest,
    CreateIncidentRequest,
    DismissRecommendationRequest,
    ExtractFormsRequest,
    ExtractFormsResponse,
    GetRecommendationsResponse,
    IncidentDocument,
    IncidentEnvelope,
    IncidentListResponse,
    LossStopRequest,
    PublishRecommendationRequest,
    RefineConditionResponse,
    RefreshRecommendationsRequest,
    RemoveConditionRequest,
    SceneConditionAndAction,
    ValidateIAPRequest,
    ValidateIAPResponse
} from "./incidentTypes";

const BACKEND_URI = "";

export class IncidentApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly body: unknown
    ) {
        super(message);
        this.name = "IncidentApiError";
    }
}

export async function validateIAP(request: ValidateIAPRequest, signal?: AbortSignal): Promise<ValidateIAPResponse> {
    const url = `${BACKEND_URI}/api/incidents/${encodeURIComponent(request.incidentId)}/validate-iap`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getBearerAuthHeaders()) },
        body: JSON.stringify(request),
        credentials: "include",
        signal
    });
    if (!response.ok) {
        let body: unknown;
        try { body = await response.json(); } catch { try { body = await response.text(); } catch { body = null; } }
        throw new IncidentApiError(`validateIAP failed: HTTP ${response.status}`, response.status, body);
    }
    return (await response.json()) as ValidateIAPResponse;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${BACKEND_URI}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getBearerAuthHeaders()) },
        body: JSON.stringify(body),
        credentials: "include",
        signal
    });
    if (!response.ok) {
        let parsed: unknown;
        try { parsed = await response.json(); } catch { try { parsed = await response.text(); } catch { parsed = null; } }
        throw new IncidentApiError(`${url} failed: HTTP ${response.status}`, response.status, parsed);
    }
    return (await response.json()) as T;
}

async function jsonRequest<T>(method: "GET" | "DELETE", url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = {
        method,
        credentials: "include",
        signal,
        headers: { "Content-Type": "application/json", ...(await getBearerAuthHeaders()) }
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${BACKEND_URI}${url}`, init);
    if (!response.ok) {
        let parsed: unknown;
        try { parsed = await response.json(); } catch { try { parsed = await response.text(); } catch { parsed = null; } }
        throw new IncidentApiError(`${url} failed: HTTP ${response.status}`, response.status, parsed);
    }
    return (await response.json()) as T;
}

export async function createIncident(request: CreateIncidentRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>("/api/incidents", request, signal);
    return envelope.incident;
}

/**
 * GET /api/incidents — list incidents in the requesting user's tenant.
 *
 * Used by the IMT incident dashboard. Returns full IncidentDocument objects (no separate
 * lookup needed when opening one). Newest first; recovery-phase incidents excluded.
 */
export async function listIncidents(signal?: AbortSignal): Promise<IncidentDocument[]> {
    const response = await jsonRequest<IncidentListResponse>("GET", "/api/incidents", undefined, signal);
    return response.incidents;
}

export async function getIncident(incidentId: string, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await jsonRequest<IncidentEnvelope>("GET", `/api/incidents/${encodeURIComponent(incidentId)}`, undefined, signal);
    return envelope.incident;
}

export async function lossStop(incidentId: string, request: LossStopRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/loss-stop`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/transfer-of-command — the Incident Commander assumes command
 * (the gatekeeper workflow). One-way in v1. Returns the updated incident.
 */
export async function transferOfCommand(incidentId: string, request: TransferOfCommandRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/transfer-of-command`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/roles/{role}/take-control — the human acting as `role` takes control
 * of it (AI -> human). Returns the updated incident.
 */
export async function takeRoleControl(incidentId: string, role: string, request: RoleControlRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/roles/${encodeURIComponent(role)}/take-control`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/roles/{role}/stand-down — the human acting as `role` stands down
 * (human -> AI). Returns the updated incident.
 */
export async function standDownRoleControl(incidentId: string, role: string, request: RoleControlRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/roles/${encodeURIComponent(role)}/stand-down`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/fire-officer/resume — the Fire Officer reconnects to an active
 * incident after an accidental logout/reload. Logs a fire_officer_resumed audit event; no
 * alternate control state. Returns the updated incident.
 */
export async function resumeFireOfficer(incidentId: string, request: RoleControlRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/fire-officer/resume`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/role-actions — create a Role Action (self-assigned Take Ownership,
 * or IC-assigned). Returns the updated incident.
 */
export async function assignRoleAction(incidentId: string, request: AssignRoleActionRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/role-actions`, request, signal);
    return envelope.incident;
}

/** POST /api/incidents/{id}/role-actions/{actionId}/comment — append a comment to a Role Action. */
export async function commentRoleAction(incidentId: string, actionId: string, request: RoleActionCommentRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/role-actions/${encodeURIComponent(actionId)}/comment`, request, signal);
    return envelope.incident;
}

/** POST /api/incidents/{id}/role-actions/{actionId}/resolve — resolve (close) a Role Action. */
export async function resolveRoleAction(incidentId: string, actionId: string, request: RoleActionResolveRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/role-actions/${encodeURIComponent(actionId)}/resolve`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/support-contributions/{cid}/ic-decision — IC approves or rejects a
 * gated contribution (active after Transfer of Command). Returns the updated incident.
 */
export async function icDecision(incidentId: string, contributionId: string, request: ICDecisionRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/support-contributions/${encodeURIComponent(contributionId)}/ic-decision`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/lock — terminal seal. IC or Site-Admin only.
 * Once locked, every mutation endpoint rejects 423. One-way in v1.
 */
export async function lockIncident(incidentId: string, request: LockIncidentRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/lock`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/forms/{formId}/content — save edited form content during cleanup.
 * IC or Site-Admin only.
 */
export async function saveFormContent(incidentId: string, formId: string, request: SaveFormContentRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/forms/${encodeURIComponent(formId)}/content`, request, signal);
    return envelope.incident;
}

/**
 * GET /api/ics-forms/schemas — AcroForm schemas for the 11 official ICS Canada PDFs.
 * Used by the generic FormFieldsContent editor to build inputs from the field list.
 */
export async function getIcsFormSchemas(signal?: AbortSignal): Promise<IcsFormSchemas> {
    const res = await fetch("/api/ics-forms/schemas", { credentials: "include", signal, headers: await getBearerAuthHeaders() });
    if (!res.ok) throw new IncidentApiError(`Failed to load ICS form schemas: ${res.status}`, res.status, undefined);
    return res.json();
}

/** Direct URL for downloading a filled form as PDF. Hit via window.open / anchor. */
export function formPdfDownloadUrl(incidentId: string, formId: string): string {
    return `/api/incidents/${encodeURIComponent(incidentId)}/forms/${encodeURIComponent(formId)}/pdf`;
}

/**
 * POST /api/incidents/{id}/support-contributions/{cid}/withdraw — pull back an AI-published
 * recommendation. Authorized for the owning support role (added_by.role match) or the IC.
 */
export async function withdrawSupportContribution(incidentId: string, contributionId: string, request: WithdrawContributionRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/support-contributions/${encodeURIComponent(contributionId)}/withdraw`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/support-contributions/{contributionId}/attest — confirm an
 * AI-suggested contribution, flipping its provenance AI -> HIC. Returns the updated incident.
 */
export async function attestContribution(incidentId: string, contributionId: string, request: AttestContributionRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/support-contributions/${encodeURIComponent(contributionId)}/attest`, request, signal);
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/auto-populate-recommendations — generate recommendations for ALL
 * support roles and surface them on the FO pane tagged AI. Fired in the background by the
 * kiosk after the Fire Officer confirms the scene Type. Returns the updated incident.
 */
export async function autoPopulateRecommendations(incidentId: string, request: AutoPopulateRecommendationsRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(`/api/incidents/${encodeURIComponent(incidentId)}/auto-populate-recommendations`, request, signal);
    return envelope.incident;
}

export async function removeCondition(incidentId: string, conditionId: string, request: RemoveConditionRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    return (await jsonRequest<IncidentEnvelope>("DELETE", `/api/incidents/${encodeURIComponent(incidentId)}/conditions/${encodeURIComponent(conditionId)}`, request, signal)).incident;
}

export async function getRefinementOptions(incidentId: string, conditionId: string, signal?: AbortSignal): Promise<RefineConditionResponse> {
    return await postJson<RefineConditionResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/conditions/${encodeURIComponent(conditionId)}/refine`,
        {},
        signal
    );
}

export async function applyRefinement(incidentId: string, conditionId: string, request: ApplyRefinementRequest, signal?: AbortSignal): Promise<SceneConditionAndAction> {
    const response = await postJson<ApplyRefinementResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/conditions/${encodeURIComponent(conditionId)}/refine/apply`,
        request,
        signal
    );
    return response.updatedCondition;
}

// ============================================================================
// SUPPORT-ROLE RECOMMENDATIONS (Session 5b backend; 5c frontend)
// ============================================================================

/**
 * GET /api/incidents/{id}/support-recommendations?role=X — read the role's pending
 * working set. Returns an empty list (with lastGeneratedAt=null) if the role hasn't
 * refreshed yet; the support view auto-fires a refresh on mount in that case.
 */
export async function getSupportRecommendations(
    incidentId: string,
    role: string,
    signal?: AbortSignal
): Promise<GetRecommendationsResponse> {
    const url = `/api/incidents/${encodeURIComponent(incidentId)}/support-recommendations?role=${encodeURIComponent(role)}`;
    return await jsonRequest<GetRecommendationsResponse>("GET", url, undefined, signal);
}

/**
 * POST /api/incidents/{id}/support-recommendations/refresh — regenerate the role's
 * pending list via the LLM. The backend deliberately tells the LLM to avoid
 * already-published items and recently-dismissed items.
 */
export async function refreshSupportRecommendations(
    incidentId: string,
    request: RefreshRecommendationsRequest,
    signal?: AbortSignal
): Promise<GetRecommendationsResponse> {
    return await postJson<GetRecommendationsResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/support-recommendations/refresh`,
        request,
        signal
    );
}

/**
 * POST /api/incidents/{id}/support-recommendations/{recId}/publish — move a pending
 * item onto the incident's supportContributions list (visible to the Fire Officer).
 */
export async function publishRecommendation(
    incidentId: string,
    recommendationId: string,
    request: PublishRecommendationRequest,
    signal?: AbortSignal
): Promise<GetRecommendationsResponse> {
    return await postJson<GetRecommendationsResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/support-recommendations/${encodeURIComponent(recommendationId)}/publish`,
        request,
        signal
    );
}

/**
 * POST /api/incidents/{id}/support-recommendations/{recId}/dismiss — drop a pending
 * item, recording an audit event so the next refresh won't repeat the same text.
 */
export async function dismissRecommendation(
    incidentId: string,
    recommendationId: string,
    request: DismissRecommendationRequest,
    signal?: AbortSignal
): Promise<GetRecommendationsResponse> {
    return await postJson<GetRecommendationsResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/support-recommendations/${encodeURIComponent(recommendationId)}/dismiss`,
        request,
        signal
    );
}

/**
 * POST /api/incidents/{id}/support-recommendations/custom — add a role-typed custom
 * item to the pending list. Still requires an explicit publish before reaching the
 * kiosk (every Fire-Officer-visible item is deliberate).
 */
export async function addCustomRecommendation(
    incidentId: string,
    request: AddCustomRecommendationRequest,
    signal?: AbortSignal
): Promise<GetRecommendationsResponse> {
    return await postJson<GetRecommendationsResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/support-recommendations/custom`,
        request,
        signal
    );
}

/**
 * POST /api/incidents/{id}/extract-forms — generate the 27 role-tagged forms from the
 * incident's scene state. Decoupled from Validate IAP (5d.1) so the kiosk never blocks on
 * form generation — fire this in the background after the scene dashboard has rendered.
 */
export async function extractForms(
    incidentId: string,
    request: ExtractFormsRequest,
    signal?: AbortSignal
): Promise<ExtractFormsResponse> {
    return await postJson<ExtractFormsResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/extract-forms`,
        request,
        signal
    );
}

/**
 * POST /api/incidents/{id}/close — close an incident (5e). Transitions it to the terminal
 * recovery phase so it drops out of the support-role incident list. Authorized for Safety
 * Officer + Site Administrator, only from Transition to Recovery. Returns the updated
 * incident.
 */
export async function closeIncident(
    incidentId: string,
    request: CloseIncidentRequest,
    signal?: AbortSignal
): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(
        `/api/incidents/${encodeURIComponent(incidentId)}/close`,
        request,
        signal
    );
    return envelope.incident;
}

export function generatePrototypeIncidentId(): string {
    const now = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    const timestamp =
        now.getFullYear().toString() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds());
    const suffix = Math.random().toString(36).slice(2, 6);
    return `incident-${timestamp}-${suffix}`;
}
