"""
role_narratives — server-side mirror of the one-line ICS role descriptions in
`app/frontend/src/roles.ts` (`ACTING_ROLES[].description`).

Used to bias KB retrieval per role: the support-recommendation query is built from the scene
state PLUS the acting role's narrative, so the search leans toward that role's concerns even
though the index is queried unfiltered (every role can see every document). This is the
deliberate first experiment (2026-06-16): test whether the existing role definitions are
enough to surface role-relevant content before investing in `allowed_roles` doc tagging.

Keep in lockstep with roles.ts — if a description changes there, mirror it here.
"""

from __future__ import annotations

# role id -> "<Display Name>: <description>" (verbatim from roles.ts)
ROLE_NARRATIVES: dict[str, str] = {
    "fire-officer": "Fire Officer: Field personnel responding to the incident.",
    "incident-commander": "Incident Commander: Overall authority and responsibility for the incident.",
    "safety-officer": "Safety Officer: Monitors hazardous conditions and develops measures for responder safety.",
    "liaison-officer": "Liaison Officer: Primary contact for representatives of cooperating and assisting agencies.",
    "information-officer": "Information Officer (PIO): Interfaces with media and public; manages information release.",
    "section-chief-operations": "Section Chief — Operations: Directs tactical operations carrying out the incident action plan.",
    "section-chief-planning": "Section Chief — Planning: Collects and disseminates incident information; maintains resource status.",
    "section-chief-logistics": "Section Chief — Logistics: Provides facilities, services, and materials required for the incident.",
    "section-chief-finance": "Section Chief — Finance/Admin: Tracks incident-related costs; handles procurement and compensation.",
    "site-administrator": "Site Administrator: Application admin: cross-event aggregation, event closure, report generation.",
}


def narrative_for(role: str) -> str:
    """Return the role's narrative, or the bare role id if we have no mirror for it."""
    return ROLE_NARRATIVES.get(role, role)
