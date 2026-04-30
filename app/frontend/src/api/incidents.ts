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

import type { ValidateIAPRequest, ValidateIAPResponse } from "./incidentTypes";

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

/**
 * Generate a simple incident ID for the prototype.
 *
 * Format: `incident-YYYYMMDDHHmmss-XXXX` where XXXX is a short random suffix.
 * Once Cosmos persistence lands (Session 3), the backend will issue these via a
 * dedicated `POST /api/incidents` endpoint and the frontend will stop minting them.
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
