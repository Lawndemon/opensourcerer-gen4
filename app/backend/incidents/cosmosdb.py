"""
Cosmos persistence layer for the Fire Officer kiosk's incident records.

Mirrors the shape of `chat_history/cosmosdb.py` — a Quart Blueprint that owns its own
CosmosClient lifecycle (set up in `@before_app_serving`, torn down in `@after_app_serving`)
and exposes a small async CRUD surface used by the route handlers in `app.py`.

The container itself is provisioned by Bicep alongside the chat-history container under the
same Cosmos account. See `infra/main.bicep` → the `cosmosDb` module's `containers` list.

Partition key: hierarchical `[/tenantId, /id]` per BACKLOG.md → "Multi-tenant Entra
architecture". Tenant isolation is enforced at the storage layer in addition to query
filters; `tenant_id` defaults to `"default"` until the `tid` claim wiring lands.

Immutability contract — see BACKLOG.md → "Chat and transcript immutability":
- `event_log` entries are append-only forever; no delete operation is exposed here.
- `transcript` chunks are append-only forever.
- Removing a Scene Condition or Action is a *flag flip* (`removed=True`), never a delete.
- Closed incidents are read-only; we do not expose a delete-incident operation anywhere.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from azure.cosmos.aio import ContainerProxy, CosmosClient
from azure.identity.aio import AzureDeveloperCliCredential, ManagedIdentityCredential
from quart import current_app

from config import (
    CONFIG_COSMOS_HISTORY_CLIENT,
    CONFIG_COSMOS_INCIDENTS_CONTAINER,
    CONFIG_CREDENTIAL,
    CONFIG_INCIDENTS_COSMOS_ENABLED,
)
from models.incidents import (
    Actor,
    AuditEvent,
    AuditEventType,
    IncidentDocument,
    RecommendationCategory,
    SceneConditionAndAction,
)


# === Module constants ===========================================================

# The env var that flips chat-history Cosmos on also flips incidents persistence on. One
# flag, one Cosmos account, two containers. Keep this in sync with chat_history/cosmosdb.py.
_USE_CHAT_HISTORY_COSMOS_ENV = "USE_CHAT_HISTORY_COSMOS"

# Bicep provisions this container under the chat-history database. Override via env if you
# need a per-deploy container (e.g., `incidents-v2` for a schema migration).
_DEFAULT_INCIDENTS_CONTAINER_NAME = "incidents"


# === Time helpers ===============================================================


def _now_iso() -> str:
    """ISO-8601 UTC timestamp with `Z` suffix — matches the rest of the audit log format."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# === Audit event factory ========================================================


def make_audit_event(
    *,
    incident_id: str,
    event_type: AuditEventType,
    actor: Actor | str,
    payload: dict[str, Any] | None = None,
) -> AuditEvent:
    """Build an AuditEvent with a fresh id and current timestamp.

    `actor` accepts either an Actor (a real human acting through the system) or the literal
    string `"system"` (LLM extraction, automatic phase transition, etc.) per the AuditEvent
    contract.
    """
    return AuditEvent(
        id=str(uuid.uuid4()),
        incident_id=incident_id,
        type=event_type,
        timestamp=_now_iso(),
        actor=actor,  # type: ignore[arg-type]  # validated by Pydantic to match the union.
        payload=payload or {},
    )


# === Container accessors ========================================================


def _container() -> ContainerProxy | None:
    """Return the configured incidents container, or None if persistence is disabled.

    Routes should check `current_app.config[CONFIG_INCIDENTS_COSMOS_ENABLED]` first and
    return a 503 before calling deeper into this module; this helper exists so the lower
    helpers don't all have to repeat the None-check pattern.
    """
    return current_app.config.get(CONFIG_COSMOS_INCIDENTS_CONTAINER)


def _partition_key(tenant_id: str, incident_id: str) -> list[str]:
    """Build the hierarchical partition key list expected by the Cosmos SDK."""
    return [tenant_id, incident_id]


# === Document <-> dict helpers ==================================================
#
# Cosmos's Python SDK takes dicts in and returns dicts out. We round-trip through
# Pydantic for validation: incoming dicts get parsed into IncidentDocument so contract
# drift surfaces immediately, and outgoing documents are serialized via `model_dump`
# with camelCase aliases so the wire format matches the frontend's contract.


def _dump_document(doc: IncidentDocument) -> dict[str, Any]:
    """Pydantic → dict for Cosmos. camelCase keys; preserves None for nullable fields."""
    return doc.model_dump(by_alias=True, mode="json")


def _parse_document(item: dict[str, Any]) -> IncidentDocument:
    """Cosmos dict → Pydantic. Strips internal Cosmos fields (`_rid`, `_etag`, etc.).

    Cosmos adds a handful of underscore-prefixed system fields to every item it returns.
    Pydantic with `extra='forbid'` would reject them, so we drop them before validating.
    """
    cleaned = {k: v for k, v in item.items() if not k.startswith("_")}
    # Legacy-field tolerance: scene tiers (5->1) were removed from the model. Incidents persisted
    # before that still carry these derived fields; drop them so extra="forbid" does not reject the
    # whole document on read. The immutable event_log is preserved untouched.
    cleaned.pop("sceneType", None)
    cleaned.pop("sceneTypeEstimate", None)
    return IncidentDocument.model_validate(cleaned)


# === CRUD operations ============================================================


async def create_incident(doc: IncidentDocument) -> IncidentDocument:
    """Insert a brand-new incident document.

    Caller is responsible for populating `created_at`, `created_by`, an initial `event_log`
    entry (`phase_transitioned` → `response`), and an initial `scene_summary`. We don't
    invent any of that here because the audit trail must reflect *who* created the incident.
    """
    container = _container()
    if container is None:
        raise RuntimeError("Incidents Cosmos container not configured")
    response = await container.create_item(body=_dump_document(doc))
    return _parse_document(response)


async def get_incident(tenant_id: str, incident_id: str) -> IncidentDocument | None:
    """Point-read a single incident. Returns None if it doesn't exist.

    Hierarchical partition keys require both values for a point-read; we never want to
    cross-tenant scan, so this signature is deliberate.
    """
    container = _container()
    if container is None:
        raise RuntimeError("Incidents Cosmos container not configured")
    try:
        item = await container.read_item(item=incident_id, partition_key=_partition_key(tenant_id, incident_id))
    except Exception as e:  # azure.cosmos.exceptions.CosmosResourceNotFoundError is the typical case
        if getattr(e, "status_code", None) == 404:
            return None
        raise
    return _parse_document(item)


async def list_incidents(tenant_id: str, *, exclude_recovery: bool = True) -> list[IncidentDocument]:
    """Cross-partition query for all incidents in a tenant, newest first.

    Hierarchical partition keys let us scope to a single tenant by supplying only the first
    level of the key (`[tenant_id]`); Cosmos handles the partition prefix scan. The query
    excludes `recovery` phase by default because v1 doesn't ship that lifecycle yet — those
    documents shouldn't appear in the IMT list.

    The result set is small enough in v1 (handfuls of incidents per tenant) that we pull it
    all into memory; once volume grows we'll add pagination via continuation tokens.
    """
    container = _container()
    if container is None:
        raise RuntimeError("Incidents Cosmos container not configured")

    where_clauses = ["c.tenantId = @tid"]
    parameters: list[dict[str, Any]] = [{"name": "@tid", "value": tenant_id}]
    if exclude_recovery:
        where_clauses.append("c.phase != 'recovery'")
    query = (
        f"SELECT * FROM c WHERE {' AND '.join(where_clauses)} "
        f"ORDER BY c.createdAt DESC"
    )

    items: list[IncidentDocument] = []
    pager = container.query_items(
        query=query,
        parameters=parameters,
        partition_key=[tenant_id],  # partial hierarchical key — scope to this tenant
        max_item_count=100,
    )
    async for page in pager.by_page():
        async for raw in page:
            items.append(_parse_document(raw))
    return items


async def replace_incident(doc: IncidentDocument) -> IncidentDocument:
    """Replace the full incident document. Use for state updates after audit-event append.

    We do not use the ETag-based optimistic concurrency pattern in v1 — the kiosk is the
    only writer for an active incident's scene state. Support-role contributions and the
    multi-writer concurrent edits will come in a later session and that's when ETags will
    matter.
    """
    container = _container()
    if container is None:
        raise RuntimeError("Incidents Cosmos container not configured")
    # Centralized lock guard: once an incident is locked, no further mutations are accepted.
    # The lock transition itself passes because the persisted doc is still unlocked when
    # lock_incident calls this.
    existing = await get_incident(doc.tenant_id, doc.id)
    if existing is not None and existing.locked_at is not None:
        raise IncidentLockedError("Incident is locked; no further mutations allowed.")
    response = await container.replace_item(item=doc.id, body=_dump_document(doc))
    return _parse_document(response)


async def append_audit_event(
    tenant_id: str,
    incident_id: str,
    event: AuditEvent,
) -> IncidentDocument:
    """Append an event to the incident's `event_log` and persist.

    Reads-then-writes the whole document. Acceptable for v1 throughput (one Fire Officer
    per incident, a handful of curation events per incident). Will move to a patch
    operation if write contention ever becomes a problem.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    doc.event_log.append(event)
    return await replace_incident(doc)


# === Higher-level state-changing operations =====================================
#
# Each of these (a) updates the incident's state fields and (b) appends a matching
# audit-log entry, in a single replace_item call. The pattern is intentionally explicit
# at every callsite: state change without an audit entry is a bug, and an audit entry
# without a state change is also a bug.


async def apply_validate_iap_result(
    *,
    tenant_id: str,
    incident_id: str,
    new_scene_summary,
    new_conditions: list[SceneConditionAndAction],
    actor: Actor | str = "system",
) -> IncidentDocument:
    """Persist the result of a Validate IAP pass (scene state only).

    Reconciles the LLM's freshly-extracted scene state with the document's existing state:
    items the Fire Officer previously removed stay removed (sticky-by-default) unless the
    new extraction explicitly re-surfaces them. The reconciliation is intentionally minimal
    in v1 — match by `id` from the LLM output. The extraction prompt is responsible for
    issuing stable ids across passes.

    Forms are NOT touched here (5d.1): they're generated by the decoupled extract-forms
    endpoint and persisted via `apply_extracted_forms`, so a scene re-validation preserves
    whatever forms were last generated until the background forms pass replaces them.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    _assert_scene_open(doc)

    # Build a map of previously-removed condition ids → their removed metadata. New
    # conditions with the same id retain removed=True per sticky-by-default semantics.
    previously_removed: dict[str, SceneConditionAndAction] = {
        c.id: c for c in doc.scene_conditions_and_actions if c.removed
    }

    reconciled: list[SceneConditionAndAction] = []
    resurfaced_ids: list[str] = []
    for item in new_conditions:
        if item.id in previously_removed:
            # Sticky: even though the LLM re-emitted it, keep the removed flag. If the
            # extraction prompt judged it materially new, it should have minted a fresh id.
            stale = previously_removed[item.id]
            item.removed = True
            item.removed_at = stale.removed_at
            item.removed_by = stale.removed_by
        reconciled.append(item)

    # Detect newly-resurfaced conditions: ids previously absent that re-appear. (For v1 we
    # don't track this distinctly — the LLM minted a fresh id — but the audit hook is here.)
    _ = resurfaced_ids  # placeholder; real resurface detection lands with the extraction-prompt iteration.

    doc.scene_summary = new_scene_summary
    doc.scene_conditions_and_actions = reconciled
    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="condition_extracted",
            actor=actor,
            payload={"condition_count": len(reconciled)},
        )
    )
    return await replace_incident(doc)


async def apply_extracted_forms(
    *,
    tenant_id: str,
    incident_id: str,
    new_forms,
    actor: Actor | str = "system",
) -> IncidentDocument:
    """Persist the result of a decoupled forms-extraction pass (5d.1).

    Replaces the incident's `forms` wholesale with the freshly-generated set and appends a
    `form_generated` audit event. Forms are derived artifacts (regenerated from scene state
    each pass), so a wholesale replace is correct — there's no per-form curation state to
    preserve the way there is for scene conditions.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")

    doc.forms = new_forms
    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="form_generated",
            actor=actor,
            payload={"form_count": len(new_forms)},
        )
    )
    return await replace_incident(doc)


async def remove_condition(
    *,
    tenant_id: str,
    incident_id: str,
    condition_id: str,
    actor: Actor,
) -> IncidentDocument:
    """Mark a Scene Condition or Action as removed by the Fire Officer.

    Flag flip, not delete. Sticky-by-default for subsequent Validate IAP passes (see
    `apply_validate_iap_result`). Resurfacing on new transcript evidence is a job of the
    extraction prompt, not this function.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    _assert_scene_open(doc)

    target = next((c for c in doc.scene_conditions_and_actions if c.id == condition_id), None)
    if target is None:
        raise ValueError(f"Condition not found on incident {incident_id}: {condition_id}")
    if target.removed:
        # Idempotent: removing an already-removed condition is a no-op. Don't emit a second
        # audit event for the same removal; that would be noise.
        return doc

    target.removed = True
    target.removed_at = _now_iso()
    target.removed_by = actor

    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="condition_removed",
            actor=actor,
            payload={"condition_id": condition_id, "condition_text": target.text},
        )
    )
    return await replace_incident(doc)


async def refresh_role_recommendations(
    *,
    tenant_id: str,
    incident_id: str,
    role: str,
    new_items_with_category: list[tuple[str, "RecommendationCategory | None"]],
    actor: Actor,
):
    """Replace the role's pending recommendations with a freshly-generated list.

    `new_items_with_category` is the LLM output as (text, category) pairs; we mint ids and
    timestamps server-side so the role's view has stable identifiers for publish/dismiss calls.

    Writes one audit event recording the refresh. Items themselves do not get individual
    "created" events — that would be noisy. Each subsequent publish/dismiss IS audited
    because it represents a deliberate role decision.
    """
    from models.incidents import PendingRecommendation, RoleRecommendations  # local import to dodge cycles
    import uuid

    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")

    now = _now_iso()
    new_items = [
        PendingRecommendation(
            id=str(uuid.uuid4()),
            text=text,
            source="kb",
            category=category,
            created_at=now,
            created_by=actor,
        )
        for (text, category) in new_items_with_category
    ]

    # Find existing role entry or insert a new one.
    existing = next((rr for rr in doc.role_recommendations if rr.role == role), None)
    if existing is not None:
        existing.items = new_items
        existing.last_generated_at = now
    else:
        doc.role_recommendations.append(
            RoleRecommendations(role=role, items=new_items, last_generated_at=now)
        )

    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="condition_extracted",  # closest existing type for "LLM produced suggestions"
            actor=actor,
            payload={
                "kind": "support_recommendations_refreshed",
                "role": role,
                "count": len(new_items),
            },
        )
    )
    return await replace_incident(doc)


async def add_custom_recommendation(
    *,
    tenant_id: str,
    incident_id: str,
    role: str,
    text: str,
    actor: Actor,
):
    """Append a user-typed item to the role's pending list (source='custom').

    Per the spec, custom items still require an explicit publish ("check") step before
    they appear on the Fire Officer's kiosk — same UX as KB-generated items.
    """
    from models.incidents import PendingRecommendation, RoleRecommendations
    import uuid

    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    now = _now_iso()
    item = PendingRecommendation(
        id=str(uuid.uuid4()),
        text=text,
        source="custom",
        created_at=now,
        created_by=actor,
    )

    # SME bug fix 2026-05-27: under Transfer of Command the IC is the gate, so the support
    # user's own pending working set becomes a redundant extra step. When command is
    # transferred, custom-add bypasses the working set and creates the SupportContribution
    # directly (stamped pending / safety_bypass via _initial_ic_status) so it shows up on the
    # IC's approval queue immediately.
    if doc.command_transferred_at is not None:
        from models.incidents import SupportContribution
        contribution = SupportContribution(
            id=str(uuid.uuid4()),
            text=text,
            source="custom",
            category=None,
            provenance="hic",
            ic_status=_initial_ic_status(doc, role),
            added_by=actor,
            added_at=now,
        )
        doc.support_contributions.append(contribution)
        doc.event_log.append(
            make_audit_event(
                incident_id=incident_id,
                event_type="support_contribution_added",
                actor=actor,
                payload={
                    "role": role,
                    "contribution_id": contribution.id,
                    "source": "custom",
                    "text": text,
                    "via": "custom_add_toc_bypass",
                },
            )
        )
        return await replace_incident(doc)

    existing = next((rr for rr in doc.role_recommendations if rr.role == role), None)
    if existing is not None:
        existing.items.append(item)
    else:
        doc.role_recommendations.append(
            RoleRecommendations(role=role, items=[item], last_generated_at=now)
        )

    # No audit event for "added to private list" — the publish step (if it happens) gets
    # one. If the role types-then-dismisses, that's a non-event; nothing to record.
    return await replace_incident(doc)


def _initial_ic_status(doc: "IncidentDocument", role: str) -> str:
    """Gate state for a newly-surfaced contribution given command status + originating role.

    Before Transfer of Command everything is ungated (current behavior). After ToC the IC gates
    content to the Fire Officer — except Safety Officer items, which bypass straight to the kiosk
    (flagged), because life-safety must not wait on an approval queue.
    """
    if doc.command_transferred_at is None:
        return "not_gated"
    if role == "safety-officer":
        return "safety_bypass"
    return "pending"


async def publish_recommendation(
    *,
    tenant_id: str,
    incident_id: str,
    role: str,
    recommendation_id: str,
    actor: Actor,
):
    """Move an item from the role's pending list into the incident's support_contributions.

    Records a `support_contribution_added` audit event. The newly-published item becomes
    visible to the Fire Officer's kiosk on its next poll/refresh.
    """
    from models.incidents import SupportContribution
    import uuid

    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")

    role_entry = next((rr for rr in doc.role_recommendations if rr.role == role), None)
    if role_entry is None:
        raise ValueError(f"No recommendations for role {role} on incident {incident_id}")
    item = next((i for i in role_entry.items if i.id == recommendation_id), None)
    if item is None:
        raise ValueError(f"Recommendation not found: {recommendation_id}")

    # Mint a fresh SupportContribution. We use a new id on the contribution side so the
    # pending-recommendation id can be reused later (e.g., if the role un-publishes —
    # not in v1 but the IDs being independent leaves that door open).
    contribution = SupportContribution(
        id=str(uuid.uuid4()),
        text=item.text,
        source="recommended" if item.source == "kb" else "custom",
        category=item.category,
        provenance="hic",  # a human publish is itself an act of ownership.
        ic_status=_initial_ic_status(doc, role),
        added_by=actor,
        added_at=_now_iso(),
    )
    doc.support_contributions.append(contribution)
    role_entry.items = [i for i in role_entry.items if i.id != recommendation_id]

    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="support_contribution_added",
            actor=actor,
            payload={
                "role": role,
                "contribution_id": contribution.id,
                "source": contribution.source,
                "text": contribution.text,
                "pending_id": recommendation_id,
            },
        )
    )
    return await replace_incident(doc)


async def attest_support_contribution(
    *,
    tenant_id: str,
    incident_id: str,
    contribution_id: str,
    actor: Actor,
) -> IncidentDocument:
    """Flip a support contribution's provenance AI -> HIC: a named human confirms it.

    This is the human-attestation event the immutability principle calls for — a real person
    takes ownership of an AI-suggested recommendation. Appends a `support_recommendation_attested`
    audit event (who/when, ai -> hic) and sets the contribution's `provenance` to "hic".
    Idempotent: re-confirming an already-HIC item is a no-op (no duplicate event).
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")

    target = next((c for c in doc.support_contributions if c.id == contribution_id), None)
    if target is None:
        raise ValueError(f"Support contribution not found: {contribution_id}")
    if target.provenance == "hic":
        return doc  # already attested; don't duplicate the event.

    target.provenance = "hic"
    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="support_recommendation_attested",
            actor=actor,
            payload={
                "contribution_id": contribution_id,
                "role": target.added_by.role,
                "from": "ai",
                "to": "hic",
                "text": target.text,
            },
        )
    )
    return await replace_incident(doc)


async def apply_auto_populated_ai_contributions(
    *,
    tenant_id: str,
    incident_id: str,
    role_items: list[tuple[str, str, "RecommendationCategory | None"]],
) -> IncidentDocument:
    """Replace the un-attested AI support contributions with a freshly-generated set.

    Called off the critical path after the Fire Officer confirms/changes the scene Type.
    `role_items` is (role, text, category) per generated recommendation across all support
    roles; each is written as a SupportContribution tagged provenance="ai".

    Re-fire behavior (Dave 2026-05-22, SME to confirm): existing AI items are cleared and
    regenerated, but items a human already confirmed to HIC are PRESERVED — re-typing the scene
    refreshes the machine suggestions without wiping human-owned decisions.

    No per-item audit event: auto-generated suggestions are AI generation churn, not a
    screen-facing human decision. The triggering `scene_type_confirmed` event already records
    the human action; human attestation/dismissal of these items is audited when it happens.
    """
    from models.incidents import SupportContribution
    import uuid

    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")

    now = _now_iso()
    # Preserve human-owned (HIC) and custom items; drop the prior un-attested AI set.
    doc.support_contributions = [c for c in doc.support_contributions if c.provenance != "ai"]
    for (role, text, category) in role_items:
        doc.support_contributions.append(
            SupportContribution(
                id=str(uuid.uuid4()),
                text=text,
                source="recommended",
                category=category,
                provenance="ai",
                ic_status=_initial_ic_status(doc, role),
                added_by=Actor(role=role, user_id="ai"),
                added_at=now,
            )
        )
    return await replace_incident(doc)


async def withdraw_support_contribution(
    *,
    tenant_id: str,
    incident_id: str,
    contribution_id: str,
    actor: Actor,
) -> IncidentDocument:
    """Pull back an AI-published support contribution. Soft-delete (hidden from kiosk; retained for audit).

    Authorization: the support role that owns this AI item (added_by.role match) OR the IC as
    override. Only AI items (provenance="ai") are withdrawable in v1 — HIC items reflect a
    human decision and need a different mechanism if they should ever be withdrawable.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    contribution = next((c for c in doc.support_contributions if c.id == contribution_id), None)
    if contribution is None:
        raise ValueError(f"Contribution not found: {contribution_id}")
    if contribution.provenance != "ai":
        raise ValueError("Only AI-published recommendations can be withdrawn.")
    if actor.role != "incident-commander" and actor.role != contribution.added_by.role:
        raise PermissionError(
            f"Only the {contribution.added_by.role} role (or the Incident Commander) can withdraw this AI recommendation."
        )
    if contribution.withdrawn:
        # Idempotent — already withdrawn.
        return doc

    contribution.withdrawn = True
    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="support_contribution_withdrawn",
            actor=actor,
            payload={
                "contribution_id": contribution_id,
                "originating_role": contribution.added_by.role,
                "text": contribution.text,
            },
        )
    )
    return await replace_incident(doc)


async def decide_gated_contribution(
    *,
    tenant_id: str,
    incident_id: str,
    contribution_id: str,
    decision: str,
    actor: Actor,
) -> IncidentDocument:
    """IC approve/reject of a gated (pending) support contribution. Append-only, audit-logged.

    `approved` makes the item visible on the Fire Officer kiosk; `rejected` keeps it off the
    kiosk (retained in the record for audit). Only meaningful after Transfer of Command.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    contribution = next((c for c in doc.support_contributions if c.id == contribution_id), None)
    if contribution is None:
        raise ValueError(f"Contribution not found: {contribution_id}")

    contribution.ic_status = "approved" if decision == "approved" else "rejected"
    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="support_contribution_ic_decided",
            actor=actor,
            payload={"contribution_id": contribution_id, "decision": decision},
        )
    )
    return await replace_incident(doc)


async def dismiss_recommendation(
    *,
    tenant_id: str,
    incident_id: str,
    role: str,
    recommendation_id: str,
    actor: Actor,
):
    """Remove an item from the role's pending list. Records a dismissal audit event.

    The text of the dismissed item is preserved in the audit payload so future refresh
    calls can pass it to the LLM as `recentlyDismissed` (don't re-suggest).
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")

    role_entry = next((rr for rr in doc.role_recommendations if rr.role == role), None)
    if role_entry is None:
        raise ValueError(f"No recommendations for role {role} on incident {incident_id}")
    item = next((i for i in role_entry.items if i.id == recommendation_id), None)
    if item is None:
        raise ValueError(f"Recommendation not found: {recommendation_id}")

    role_entry.items = [i for i in role_entry.items if i.id != recommendation_id]
    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="support_recommendation_dismissed",
            actor=actor,
            payload={
                "role": role,
                "pending_id": recommendation_id,
                "text": item.text,
                "source": item.source,
            },
        )
    )
    return await replace_incident(doc)


def get_recent_dismissed_texts(doc, role: str, limit: int = 20) -> list[str]:
    """Pull recently-dismissed suggestion texts for a role from the audit log.

    Used to feed the LLM on refresh — don't re-suggest things this role has already said
    no to. Reads from doc.event_log (already loaded as a side-effect of get_incident).
    Synchronous helper because it's pure dict iteration; no Cosmos call.
    """
    texts: list[str] = []
    for ev in reversed(doc.event_log):
        if ev.type == "support_recommendation_dismissed" and ev.payload.get("role") == role:
            text = ev.payload.get("text")
            if text:
                texts.append(text)
                if len(texts) >= limit:
                    break
    return texts


async def apply_refinement(
    *,
    tenant_id: str,
    incident_id: str,
    condition_id: str,
    selected_statement: str | None,
    new_status,  # ConditionStatus — kept untyped here to avoid a circular import with models
    new_published_plan_context: str,
    delta_note: str | None,
    actor: Actor,
):
    """
    Apply a Fire Officer's "Refine Condition" choice to a persisted condition.

    Updates the condition's status / publishedPlanContext / delta, appends a
    `ConditionRefinement` entry to its `refinements[]` history, and writes a
    `condition_refined` audit event. The LLM-side re-evaluation lives in
    `approaches/refine_condition.py`; this function is the pure persistence step.

    `selected_statement=None` represents "None of the above" — the Fire Officer
    declined the suggested refinements. We still record the audit event (it's an
    intentional Fire Officer action) but treat the status as unchanged.
    """
    from models.incidents import ConditionRefinement  # local import to dodge cycles

    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    _assert_scene_open(doc)

    target = next((c for c in doc.scene_conditions_and_actions if c.id == condition_id), None)
    if target is None:
        raise ValueError(f"Condition not found on incident {incident_id}: {condition_id}")
    if target.removed:
        # Refining a removed condition is a UX impossibility (the kiosk hides the
        # Refine button on removed items), so this is defensive — surface as an error
        # rather than silently allow.
        raise ValueError(f"Cannot refine a removed condition: {condition_id}")

    now = _now_iso()

    # Record the refinement event on the condition itself even when the user picked
    # "None of the above" — the audit log should reflect that the FO considered and
    # declined. Use a sentinel string so future analytics can distinguish.
    target.refinements.append(
        ConditionRefinement(
            timestamp=now,
            selected_statement=selected_statement or "(none_of_the_above)",
            selected_by=actor,
        )
    )

    if selected_statement is not None:
        # Apply the LLM's re-evaluation. We only mutate fields the apply prompt produced.
        target.status = new_status
        if new_published_plan_context:
            target.published_plan_context = new_published_plan_context
        target.delta = delta_note

    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="condition_refined",
            actor=actor,
            payload={
                "condition_id": condition_id,
                "selected_statement": selected_statement,
                "new_status": target.status,
                "delta_note": delta_note,
            },
        )
    )
    return await replace_incident(doc)


async def transition_command_to_ic(
    *,
    tenant_id: str,
    incident_id: str,
    actor: Actor,
) -> IncidentDocument:
    """Transfer of Command: the Incident Commander deliberately assumes command.

    One-way in v1 — once command transfers to the IC it stays there until the incident closes.
    Sets the derived `command_transferred_at` flag and appends an append-only
    `command_transferred` event (the source of truth). Idempotent: re-initiating after command
    is already with the IC is a no-op and won't duplicate events.

    Engaging command transfer flips scene-type authority to the IC and (caller-side) activates
    the IC content gate — support/AI recommendations route through the IC before the kiosk.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    if doc.command_transferred_at is not None:
        # Idempotent — command already with the IC.
        return doc

    doc.command_transferred_at = _now_iso()

    # Re-classify EVERY existing not_gated support contribution (AI + HIC) so the IC can
    # re-validate them all (Dave 2026-05-27). Safety Officer items go safety_bypass and stay
    # visible to the FO; everything else becomes pending. Items already decided
    # (approved / rejected / safety_bypass) and withdrawn items are not touched.
    reclassified_to_pending: list[str] = []
    reclassified_to_safety_bypass: list[str] = []
    for contribution in doc.support_contributions:
        if contribution.ic_status != "not_gated":
            continue
        if contribution.added_by.role == "safety-officer":
            contribution.ic_status = "safety_bypass"
            reclassified_to_safety_bypass.append(contribution.id)
        else:
            contribution.ic_status = "pending"
            reclassified_to_pending.append(contribution.id)

    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="command_transferred",
            actor=actor,
            payload={
                "from": "fire-officer",
                "to": actor.role,
                "reclassified_to_pending": reclassified_to_pending,
                "reclassified_to_safety_bypass": reclassified_to_safety_bypass,
            },
        )
    )
    return await replace_incident(doc)


class IncidentLockedError(Exception):
    """Raised when a mutation is attempted on a locked (sealed) incident. Maps to HTTP 423."""


class SceneFrozenError(Exception):
    """Raised when a scene/transcript mutation is attempted after Loss Stop. Maps to HTTP 409.

    Loss Stop ends the active response — transcript and scene conditions/actions are frozen
    at that point. Forms can still be regenerated/edited during cleanup; the scene cannot.
    """


def _assert_scene_open(doc: "IncidentDocument") -> None:
    if doc.phase != "response":
        raise SceneFrozenError(
            "Scene is frozen — active response has ended (Loss Stop). Transcript and scene "
            "conditions cannot be changed; cleanup operates on forms only."
        )


async def lock_incident(
    *,
    tenant_id: str,
    incident_id: str,
    actor: Actor,
) -> IncidentDocument:
    """Final administrative seal of the incident. Append-only, audit-logged, idempotent.

    Triggered from the CloseoutAdmin page by the IC or Site Administrator after reports are
    finalized. Once set, every subsequent write rejects via the centralized lock guard in
    `replace_incident`. One-way in v1 — there is no unlock action.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    if doc.locked_at is not None:
        # Idempotent — already locked.
        return doc

    doc.locked_at = _now_iso()
    doc.locked_by = actor
    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="incident_locked",
            actor=actor,
            payload={"phase_at_lock": doc.phase, "closed_at": doc.closed_at},
        )
    )
    return await replace_incident(doc)


async def save_form_content(
    *,
    tenant_id: str,
    incident_id: str,
    form_id: str,
    new_content,
    actor: Actor,
) -> IncidentDocument:
    """Replace a form's content with a manually-edited version. Append-only audit event."""
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    form = next((f for f in doc.forms if f.form_id == form_id), None)
    if form is None:
        raise ValueError(f"Form not found: {form_id}")

    form.content = new_content
    form.last_updated = _now_iso()
    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="form_content_edited",
            actor=actor,
            payload={"form_id": form_id},
        )
    )
    return await replace_incident(doc)


async def transition_to_loss_stopped(
    *,
    tenant_id: str,
    incident_id: str,
    actor: Actor,
) -> IncidentDocument:
    """Loss Stop: Response → Transition to Recovery.

    Locks Response-phase forms (ICS 201). Sets `loss_stopped_at`. Per BACKLOG.md the Fire
    Officer's interaction with the incident ends here; supporting roles take over for
    enrichment and recovery checklists.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    if doc.phase != "response":
        # Idempotent on the no-op direction: re-pressing Loss Stop after it's already done
        # shouldn't fail or duplicate audit events.
        return doc

    now = _now_iso()
    previous_phase = doc.phase
    doc.phase = "transition_to_recovery"
    doc.loss_stopped_at = now

    # Lock all forms that were active during Response. The per-form lifecycle from
    # docs/prototype_plan.md says Response-phase forms (ICS 201) lock now; Transition-phase
    # forms (when we add them) stay editable.
    for f in doc.forms:
        if f.status == "active":
            f.status = "locked"
            f.last_updated = now
            doc.event_log.append(
                make_audit_event(
                    incident_id=incident_id,
                    event_type="form_locked",
                    actor=actor,
                    payload={"form_id": f.form_id, "trigger": "loss_stop"},
                )
            )

    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="phase_transitioned",
            actor=actor,
            payload={"from": previous_phase, "to": doc.phase, "trigger": "loss_stop"},
        )
    )
    return await replace_incident(doc)


async def close_incident(
    *,
    tenant_id: str,
    incident_id: str,
    actor: Actor,
) -> IncidentDocument:
    """Close an incident: Transition to Recovery → Recovery (terminal).

    Triggered by the Safety Officer (or Site Administrator) via POST /api/incidents/{id}/close.
    Moving to `recovery` drops the incident from the support-role incident list
    (`list_incidents(exclude_recovery=True)`). The record persists and stays auditable — per
    the immutability principle, incidents are never purged.

    Authorization (role + caller identity) is enforced in the endpoint; this helper only
    guards the phase precondition. Idempotent: closing an already-recovery incident is a no-op.
    """
    doc = await get_incident(tenant_id, incident_id)
    if doc is None:
        raise ValueError(f"Incident not found: tenant={tenant_id} id={incident_id}")
    if doc.phase == "recovery":
        # Already closed — no-op, don't duplicate the audit event.
        return doc
    if doc.phase != "transition_to_recovery":
        # Closable only from Transition to Recovery (decision 2026-05-20). Surfacing this as
        # a ValueError lets the endpoint translate it into a 409.
        raise ValueError(
            f"Incident {incident_id} cannot be closed from phase '{doc.phase}'; "
            "it must be in 'transition_to_recovery'."
        )

    now = _now_iso()
    previous_phase = doc.phase
    doc.phase = "recovery"
    doc.closed_at = now

    # Lock any still-active forms — recovery is reviewable but not editable.
    for f in doc.forms:
        if f.status == "active":
            f.status = "locked"
            f.last_updated = now

    doc.event_log.append(
        make_audit_event(
            incident_id=incident_id,
            event_type="phase_transitioned",
            actor=actor,
            payload={"from": previous_phase, "to": doc.phase, "trigger": "close_incident"},
        )
    )
    return await replace_incident(doc)


# === Blueprint lifecycle hooks ==================================================
#
# We don't register HTTP endpoints here — the incident endpoints live in `app.py`
# beside `validate_iap` so they share the same auth decorator and error-response style.
# This module is imported by `app.py`'s setup_clients to install the container proxy
# into the Quart app config.


async def setup_incidents_cosmos() -> None:
    """Install the incidents container proxy into Quart app config.

    Called from `app.py`'s `@bp.before_app_serving` hook so we share the chat-history
    CosmosClient. If `USE_CHAT_HISTORY_COSMOS` is false, this is a no-op and downstream
    routes will return 503 when called.
    """
    use_cosmos = os.getenv(_USE_CHAT_HISTORY_COSMOS_ENV, "").lower() == "true"
    if not use_cosmos:
        current_app.logger.info(
            "%s is not true; incidents Cosmos persistence disabled.", _USE_CHAT_HISTORY_COSMOS_ENV
        )
        current_app.config[CONFIG_INCIDENTS_COSMOS_ENABLED] = False
        return

    cosmos_client: CosmosClient | None = current_app.config.get(CONFIG_COSMOS_HISTORY_CLIENT)
    if cosmos_client is None:
        # Chat history's blueprint not registered or didn't run its setup yet. Build our
        # own client so the order-of-blueprint-registration doesn't matter.
        account = os.getenv("AZURE_COSMOSDB_ACCOUNT")
        if not account:
            raise ValueError(
                "AZURE_COSMOSDB_ACCOUNT must be set when USE_CHAT_HISTORY_COSMOS is true"
            )
        credential: AzureDeveloperCliCredential | ManagedIdentityCredential = current_app.config[
            CONFIG_CREDENTIAL
        ]
        cosmos_client = CosmosClient(
            url=f"https://{account}.documents.azure.com:443/", credential=credential
        )
        current_app.config[CONFIG_COSMOS_HISTORY_CLIENT] = cosmos_client

    database_name = os.getenv("AZURE_CHAT_HISTORY_DATABASE")
    container_name = os.getenv("AZURE_INCIDENTS_CONTAINER", _DEFAULT_INCIDENTS_CONTAINER_NAME)
    if not database_name:
        raise ValueError("AZURE_CHAT_HISTORY_DATABASE must be set when USE_CHAT_HISTORY_COSMOS is true")

    db = cosmos_client.get_database_client(database_name)
    incidents_container = db.get_container_client(container_name)
    current_app.config[CONFIG_COSMOS_INCIDENTS_CONTAINER] = incidents_container
    current_app.config[CONFIG_INCIDENTS_COSMOS_ENABLED] = True
    current_app.logger.info(
        "Incidents Cosmos persistence enabled (database=%s container=%s)", database_name, container_name
    )


