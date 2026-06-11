/**
 * recommendationRouting — the single source of truth for "what can this role do with a
 * recommendation right now". One shared core, role-specific extensions (SME bug batch
 * 2026-06-10). Both the support-pane RecommendationRow buttons and the IC approval pane
 * read from here so routing rules live in exactly one place.
 *
 * Master gate: a human can only act once they are the Human-In-Charge (HIC) of the role.
 *  - Support roles become HIC by pressing Take Control (roleControls[role].controller === "human").
 *  - The Incident Commander is inherently HIC once command has been transferred.
 * When a role is AI-in-Control the whole support pane is observe-only (Dave, 2026-06-10).
 *
 * Routing options:
 *  - Every support role: "own" + "send to IC".
 *  - "send to FO" additionally for the FO-bypass roles (Safety Officer, Ops Section Chief).
 *  - Incident Commander override: "own" + "send to FO" + "assign to an active HIC support
 *    role"; the IC never gets "send to IC" (it would route to itself).
 */

import type { IncidentDocument } from "./api/incidentTypes";

export type RoutingAction = "own" | "send_to_ic" | "send_to_fo" | "assign_to_role";

/** Roles that may push a recommendation straight to the Fire Officer kiosk. */
const FO_BYPASS_ROLES = new Set<string>(["safety-officer", "section-chief-operations"]);

/** A human is in charge of `role` and may act on its recommendations. */
export function isHumanInCharge(role: string, incident: IncidentDocument): boolean {
    if (role === "incident-commander") {
        return incident.commandTransferredAt != null;
    }
    return incident.roleControls.find(rc => rc.role === role)?.controller === "human";
}

/** Routing actions available to `role` for a pending recommendation. Empty when not HIC. */
export function routingActionsFor(role: string, incident: IncidentDocument): RoutingAction[] {
    if (!isHumanInCharge(role, incident)) return [];
    if (role === "incident-commander") {
        return ["own", "send_to_fo", "assign_to_role"];
    }
    const actions: RoutingAction[] = ["own", "send_to_ic"];
    if (FO_BYPASS_ROLES.has(role)) actions.push("send_to_fo");
    return actions;
}

/** Support roles a human has taken control of — the IC's valid assignment targets. */
export function activeHicSupportRoles(incident: IncidentDocument): string[] {
    return incident.roleControls
        .filter(rc => rc.controller === "human" && rc.role !== "incident-commander")
        .map(rc => rc.role);
}
