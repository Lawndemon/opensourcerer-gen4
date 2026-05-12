/**
 * API client for the incident endpoints (Fire Officer kiosk).
 *
 * Uses relative URLs so the request lands at the same origin as the SPA. Authentication is
 * handled by Container Apps' built-in auth (Easy Auth), which sends the AppServiceAuthSession
 * cookie automatically — no Authorization header needed when `isUsingAppServicesLogin` is true.
 *
 * For environments where Easy Auth isn't in front (e.g., local dev with USE_LOGIN=false), this
 * mirrors the chat API pattern: include `credentials: "include"` so any session cookie is sent
 * along with cross-origin-aware fetches.
 */

import type {
    CreateIncidentRequest,
    IncidentDocument,
    IncidentEnvelope,
    LossStopRequest,
    RemoveConditionRequest,
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

/**
 * POST /api/incidents/{incidentId}/validate-iap
 *
 * Submits a transcript for LLM extraction. The backend returns the structured
 * Scene Summary, Scene Conditions and Actions, Support Contributions, and per-role
 * forms — see ValidateIAPResponse for the full shape.
 *
 * Throws IncidentApiError on non-2xx responses. Network errors propagate as TypeError.
 */
export async function validateIAP(request: ValidateIAPRequest, signal?: AbortSignal): Promise<ValidateIAPResponse> {
    const url = `${BACKEND_URI}/api/incidents/${encodeURIComponent(request.incidentId)}/validate-iap`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        credentials: "include",
        signal
    });

    if (!response.ok) {
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            try {
                body = await response.text();
            } catch {
                body = null;
            }
        }
        throw new IncidentApiError(`validateIAP failed: HTTP ${response.status}`, response.status, body);
    }

    return (await response.json()) as ValidateIAPResponse;
}

// ---------------------------------------------------------------------------
// Incident lifecycle (Session 3)
// ---------------------------------------------------------------------------
//
// These endpoints require backend Cosmos persistence to be enabled
// (USE_CHAT_HISTORY_COSMOS=true at deploy time). When disabled, the backend
// returns 503 on each — the kiosk should handle that case gracefully by
// falling back to the Session 1 flow: mint a client-side incident id with
// `generatePrototypeIncidentId()` and call `validateIAP` directly.

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${BACKEND_URI}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
        signal
    });
    if (!response.ok) {
        let parsed: unknown;
        try {
            parsed = await response.json();
        } catch {
            try {
                parsed = await response.text();
            } catch {
                parsed = null;
            }
        }
        throw new IncidentApiError(`${url} failed: HTTP ${response.status}`, response.status, parsed);
    }
    return (await response.json()) as T;
}

async function jsonRequest<T>(method: "GET" | "DELETE", url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = {
        method,
        credentials: "include",
        signal,
        headers: { "Content-Type": "application/json" }
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${BACKEND_URI}${url}`, init);
    if (!response.ok) {
        let parsed: unknown;
        try {
            parsed = await response.json();
        } catch {
            try {
                parsed = await response.text();
            } catch {
                parsed = null;
            }
        }
        throw new IncidentApiError(`${url} failed: HTTP ${response.status}`, response.status, parsed);
    }
    return (await response.json()) as T;
}

/**
 * POST /api/incidents — create a persisted incident.
 *
 * If `transcript` is supplied, the backend runs Validate IAP inline and the returned
 * document already has scene state populated. Recommended path for the kiosk: pass the
 * fixture transcript so the dashboard is ready to render on first response.
 */
export async function createIncident(request: CreateIncidentRequest, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>("/api/incidents", request, signal);
    return envelope.incident;
}

/**
 * GET /api/incidents/{id} — read a persisted incident. Used to rehydrate kiosk state on
 * page refresh when an incident is in progress.
 */
export async function getIncident(incidentId: string, signal?: AbortSignal): Promise<IncidentDocument> {
    const envelope = await jsonRequest<IncidentEnvelope>(
        "GET",
        `/api/incidents/${encodeURIComponent(incidentId)}`,
        undefined,
        signal
    );
    return envelope.incident;
}

/**
 * POST /api/incidents/{id}/loss-stop — Response → Transition to Recovery.
 *
 * Locks Response-phase forms and appends a `phase_transitioned` audit event. Per
 * BACKLOG.md the Fire Officer's interaction with the incident ends here.
 */
export async function lossStop(
    incidentId: string,
    request: LossStopRequest,
    signal?: AbortSignal
): Promise<IncidentDocument> {
    const envelope = await postJson<IncidentEnvelope>(
        `/api/incidents/${encodeURIComponent(incidentId)}/loss-stop`,
        request,
        signal
    );
    return envelope.incident;
}

/**
 * DELETE /api/incidents/{id}/conditions/{conditionId} — Fire Officer removes a scene item.
 *
 * Flag flip, not hard delete; sticky-with-resurfacing semantics handled server-side. The
 * returned document reflects the new removed state and includes the appended audit event.
 */
export async function removeCondition(
    incidentId: string,
    conditionId: string,
    request: RemoveConditionRequest,
    signal?: AbortSignal
): Promise<IncidentDocument> {
    return (
        await jsonRequest<IncidentEnvelope>(
            "DELETE",
            `/api/incidents/${encodeURIComponent(incidentId)}/conditions/${encodeURIComponent(conditionId)}`,
            request,
            signal
        )
    ).incident;
}

/**
 * Generate a simple incident ID for the prototype.
 *
 * Format: `incident-YYYYMMDDHHmmss-XXXX` where XXXX is a short random suffix.
 * Used only as a fallback when Cosmos persistence is disabled (backend returns 503 on
 * `POST /api/incidents`). With persistence on, the backend mints the ID.
 */
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
