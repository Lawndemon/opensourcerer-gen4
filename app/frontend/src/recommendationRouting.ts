/**
 * recommendationRouting — the single source of truth for "what can this role do with a
 * recommendation right now". One shared core, role-specific extensions (SME bug batch
 * 2026-06-10). Both the support-pane RecommendationRow buttons and the IC approval pane
 * read from here so routing rules live in exactly one place.
 *
 * BACKEND TWIN: app/backend/incidents/routing.py enforces these same rules server-side
 * (403s). Any rule change lands in BOTH files.
 *
 * Master gate: a human can only act once they are the Human-In-Charge (HIC) of the role.
 *  - Support roles become HIC by pressing Take Control (roleControls[role].controller === "human").
 *  - The Incident Commander is inherently HIC once command has been transferred.
 * When a role is AI-in-Control the whole support pane is observe-only (Dave, 2026-06-10).
 *
 * Pre-ToC restrictions (Dave, 2026-06-11): until the IC takes command, ONLY the FO-bypass
 * roles (Safety Officer, Ops Section Chief) can be taken control of by a human — and even
 * they can only self-assign (own) or send to FO, because there is no human IC to route to.
 *
 * Routing options:
 *  - Every support role: "own"; "send to IC" only once command has been transferred.
 *  - "send to FO" additionally for the FO-bypass roles (Safety Officer, Ops Section Chief).
 *  - Incident Commander override: "own" + "send to FO" + "assign to an active HIC support
 *    role"; the IC never gets "send to IC" (it would route to itself).
 */

import type { IncidentDocument, SupportContribution } from "./api/incidentTypes";

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

/**
 * A human may take control of `role` right now (Dave, 2026-06-11): before Transfer of
 * Command only the FO-bypass roles are takeable — every other support role unlocks once
 * the IC is in command. Never applies to the IC (it becomes HIC via ToC, not Take Control).
 */
export function canTakeControl(role: string, incident: IncidentDocument): boolean {
    if (role === "incident-commander") return false;
    return FO_BYPASS_ROLES.has(role) || incident.commandTransferredAt != null;
}

/** Routing actions available to `role` for a pending recommendation. Empty when not HIC. */
export function routingActionsFor(role: string, incident: IncidentDocument): RoutingAction[] {
    if (!isHumanInCharge(role, incident)) return [];
    if (role === "incident-commander") {
        return ["own", "send_to_fo", "assign_to_role"];
    }
    const actions: RoutingAction[] = ["own"];
    // No human IC pre-ToC — nothing to route to (Dave, 2026-06-11).
    if (incident.commandTransferredAt != null) actions.push("send_to_ic");
    if (FO_BYPASS_ROLES.has(role)) actions.push("send_to_fo");
    return actions;
}

/**
 * The support contributions the Fire Officer can see on the kiosk: not withdrawn, and gated to
 * a FO-visible status (not_gated pre-ToC, IC-approved, or SO/OSC safety_bypass). Centralized so
 * the FO kiosk and the IC's "Visible to the Fire Officer" pane render the exact same set — the
 * IC must see everything reaching the FO before, during, and after a human takes control
 * (SME, 2026-06-16). Display filter only (no routing authority), so it lives frontend-side.
 */
export function foVisibleContributions(source: { supportContributions: SupportContribution[] }): SupportContribution[] {
    return source.supportContributions.filter(
        c => !c.withdrawn && (c.icStatus === "not_gated" || c.icStatus === "approved" || c.icStatus === "safety_bypass")
    );
}

/** Support roles a human has taken control of — the IC's valid assignment targets (the IC's HIC list). */
export function activeHicSupportRoles(incident: IncidentDocument): string[] {
    return incident.roleControls
        .filter(rc => rc.controller === "human" && rc.role !== "incident-commander")
        .map(rc => rc.role);
}
