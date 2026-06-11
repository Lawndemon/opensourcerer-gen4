"""
routing — server-side twin of `app/frontend/src/recommendationRouting.ts`.

The frontend module drives which buttons render; THIS module is the enforcement layer the
endpoints actually trust (the UI gate alone was the accepted demo gap from 2026-06-10 —
closed here). Keep the two files in lockstep: any rule change lands in BOTH, and the rules
live nowhere else on their side of the wire.

Master gate (Dave, 2026-06-10):
 - A human may only act on a role's recommendations once they are Human-In-Charge (HIC).
 - Support roles become HIC via Take Control (role_controls[role].controller == "human").
 - The Incident Commander is inherently HIC once command has been transferred (and is
   never HIC before Transfer of Command).
 - AI-in-Control == the whole support pane is observe-only.

Routing options:
 - Every support role: "own" + "send_to_ic".
 - "send_to_fo" additionally for the FO-bypass roles (Safety Officer, Ops Section Chief).
 - IC override: "own" + "send_to_fo" + "assign_to_role"; the IC never gets "send_to_ic".
 - IC assignment targets are restricted to ACTIVE HIC support roles, never the IC itself.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from models.incidents import IncidentDocument

# Roles that may push a recommendation straight to the Fire Officer kiosk, bypassing the IC
# gate after Transfer of Command — life-safety / front-line ops must not wait on an approval
# queue. Single source of truth; `cosmosdb._DIRECT_TO_FO_ROLES` aliases this set.
FO_BYPASS_ROLES: set[str] = {"safety-officer", "section-chief-operations"}


def is_human_in_charge(doc: "IncidentDocument", role: str) -> bool:
    """A human is in charge of `role` and may act on its recommendations."""
    if role == "incident-commander":
        return doc.command_transferred_at is not None
    return any(rc.role == role and rc.controller == "human" for rc in doc.role_controls)


def assert_human_in_charge(doc: "IncidentDocument", role: str) -> None:
    """Raise PermissionError unless a human is in charge of `role` (maps to HTTP 403)."""
    if not is_human_in_charge(doc, role):
        if role == "incident-commander":
            raise PermissionError(
                "The Incident Commander may only act after Transfer of Command."
            )
        raise PermissionError(
            f"AI is in control of {role} — take control of the role before acting on its recommendations."
        )


def routing_actions_for(doc: "IncidentDocument", role: str) -> set[str]:
    """Routing actions available to `role` for a pending recommendation. Empty when not HIC."""
    if not is_human_in_charge(doc, role):
        return set()
    if role == "incident-commander":
        return {"own", "send_to_fo", "assign_to_role"}
    actions = {"own", "send_to_ic"}
    if role in FO_BYPASS_ROLES:
        actions.add("send_to_fo")
    return actions


def assert_publish_target_allowed(doc: "IncidentDocument", role: str, target: str | None) -> None:
    """Validate an explicit publish routing target ("fo" / "ic" / None) against the role's
    allowed routing actions. None (role-default routing) is always permitted for a HIC role."""
    if target is None:
        return
    required = {"fo": "send_to_fo", "ic": "send_to_ic"}.get(target)
    if required is None:
        raise ValueError(f"Unknown publish target: {target}")
    if required not in routing_actions_for(doc, role):
        raise PermissionError(f"The {role} role cannot route a recommendation to target '{target}'.")


def active_hic_support_roles(doc: "IncidentDocument") -> list[str]:
    """Support roles a human has taken control of — the IC's valid assignment targets."""
    return [
        rc.role
        for rc in doc.role_controls
        if rc.controller == "human" and rc.role != "incident-commander"
    ]
