# Role-Based Retrieval — Implementation Plan

Detailed implementation plan for the BACKLOG item *Role-based document retrieval filtering (with core-document foundation)*. This document is the working plan; BACKLOG.md retains the high-level summary and links here.

**Status as of 2026-04-29:** not started. The folder structure (`data/<role>/`) and per-role placeholder docs exist, but ingestion treats the corpus as flat. The frontend tracks `actingRole` but does not send it to the backend. The search index has no role field. Selecting a role today changes only the system-prompt voice.

## Goal

When a user signs in as Fire Officer (or any other ICS role), retrieval should return only documents tagged with their role plus universal "core" docs (jurisdictional standards, frameworks, legal). Site Administrator sees everything.

## Design recap

Single multi-valued string field on the search index: `allowed_roles: Collection(Edm.String)`. Values are literal role IDs (`fire-officer`, `safety-officer`, …) or the sentinel `"core"`. Each query carries an OData `$filter` of the form:

```
allowed_roles/any(r: r eq 'fire-officer' or r eq 'core')
```

This mirrors the existing `oids/groups` ACL pattern in `searchmanager.py`, so it's well-trodden territory.

## Open decisions before starting

These need a call before Session 1 begins; flagging here so we don't stall mid-implementation.

1. **Default role for unauthenticated / dev-mode requests.** Options: (a) `"core"` only — safest, conservative; (b) no filter at all — matches today's behavior, useful for local dev with no auth. Recommend (a) with a dev-mode override env var.
2. **Site Administrator retrieval scope.** Options: (a) sees everything (no filter applied); (b) sees `"core"` only and uses the aggregate views for cross-event work. Recommend (a) — admin queries are explicitly cross-cutting.
3. **Roles-manifest location and format.** Recommend `data/roles-manifest.json`, keyed by relative path from `data/` to the file, value `{ allowed_roles: string[] }`. Folder name is the default; manifest entry overrides.
4. **Backward compatibility during the rollout window.** Adding a `Collection(Edm.String)` field to an existing Azure Search index is non-breaking, but old documents will have empty `allowed_roles` and the OData `any` filter will exclude them. Plan: schema upgrade → immediate re-ingest of the full corpus → only then enable the filter clause. Sessions are sequenced to enforce this.

## Files involved

Concrete anchor points so each session knows exactly what to touch:

- `app/backend/prepdocslib/searchmanager.py` (~line 240) — index field list. Add `allowed_roles` next to `category` / `oids` / `groups`.
- `app/backend/prepdocs.py` — entry point for ingestion. Needs to compute `allowed_roles` per file from `(parent_folder, manifest_override)` and pass it down to the document writer.
- `app/backend/prepdocslib/` (the file/section that builds the per-document payload sent to Azure Search) — accept and write the new field.
- `app/backend/approaches/approach.py` (`build_filter`, line 285) — append the role clause when the request carries an acting role.
- `app/backend/app.py` (~lines 212/241, `context = request_json.get("context", {})`) — read `acting_role` off the request context and thread into the approach call path.
- `app/frontend/src/api/api.ts` and `models.ts` — add `actingRole` to the chat request body, read from `RoleContext`.
- `app/frontend/src/pages/chat/Chat.tsx` — pass `actingRole` from `useRole()` into the `chatApi` call.
- `data/roles-manifest.json` — new file, override map for multi-role docs (e.g. *Rules of Engagement for Firefighter Survival*).
- `tests/test_searchmanager.py`, `tests/test_prepdocs.py`, `tests/test_chatapproach.py` — extend with role-tag and role-filter coverage.
- `infra/` — verify nothing in Bicep needs to change for the schema (the index is created at ingest time by `searchmanager.py`, not by Bicep — confirm during Session 1).

## Sessions

### Session 1 — Schema + ingestion (data side complete)

Land the `allowed_roles` field and have prepdocs populate it. No retrieval changes yet.

- Add the field to the index schema in `searchmanager.py`. Filterable, multi-valued, not searchable (it's a filter facet, not full-text content).
- Walk `data/<role>/<file>` in prepdocs; default `allowed_roles = [<folder-name>]`. For files at `data/core/`, default is `["core"]`.
- Load `data/roles-manifest.json` if present; for any file listed, replace the default with the manifest's `allowed_roles`.
- Pass `allowed_roles` through to the index document payload alongside `category`/`sourcefile`.
- Drop and rebuild the index for now (still small enough). Re-ingest all of `data/`.
- Verify in Azure Search Explorer that documents carry the expected role tags. Spot-check one core doc, one role-specific (Fire Officer placeholder), and one multi-role (Rules of Engagement once the manifest entry lands).

**End state:** index has tagged documents, retrieval still returns the flat corpus to every role. No regression risk because no read-path code changed.

**Estimated:** half a session.

### Session 2 — Retrieval filter end-to-end (vertical slice for Fire Officer)

Wire the filter from frontend through backend to Azure Search. Prove it for Fire Officer; the other roles light up for free since the data is already tagged.

- Frontend: extend `ChatRequest`/`AskRequest` types in `models.ts` with `actingRole`. Update `api.ts` to include it. Update `Chat.tsx` (and `Ask.tsx` if applicable) to pull `actingRole` from `useRole()` and pass to the API call.
- Backend: in `app.py`, read `acting_role` off the request context (or top-level body — match wherever ACL `auth_claims` is currently read for consistency). Validate it against the known role list; reject unknown values with a 400.
- Threading: pass `acting_role` into the approach instance call and into `build_filter(overrides)` via overrides or a dedicated param. Lean toward a dedicated param so it's not bypassable from the client via overrides.
- `build_filter`: when `acting_role` is present, append `allowed_roles/any(r: r eq '<role>' or r eq 'core')`. Skip the clause for Site Administrator (per Decision 2). Apply the dev-mode default per Decision 1.
- Manual verification: log in as `fireofficer@…` → ask the placeholder's distinctive test phrase ("LACES protocol enforcement on the fireline") → confirm hit. Log in as `safety_officer@…` → ask the same query → confirm the fire-officer doc is *not* returned, but core docs still are.

**End state:** retrieval is role-filtered. Fire Officer sees fire-officer + core; each ICS role sees its own + core; admin sees everything.

**Estimated:** one session.

### Session 3 — Tests, multi-role docs, polish

- Add unit tests for `build_filter` covering: no role → no clause, valid role → clause appended, admin → no clause, role + include_category → clauses ANDed correctly.
- Add a prepdocs test that asserts manifest overrides win over folder defaults.
- Populate `data/roles-manifest.json` with the *Rules of Engagement for Firefighter Survival* multi-role override (`fire-officer`, `section-chief-operations`, `safety-officer`, `incident-commander` per BACKLOG).
- Re-ingest. Verify the multi-role doc appears for each of the four tagged roles and not for the others.
- Update `docs/data_ingestion.md` with a short section on role tagging and the manifest format.
- Update the BACKLOG entry to mark this item shipped, link the closing PR.

**Estimated:** half to one session.

### Session 4 — Follow-ups (deferred unless needed)

Captured here so they don't get lost; not in the critical path.

- Telemetry: log `acting_role` and the resulting filter on each search call, so we can audit retrieval behavior per role over time.
- Document upload UX: when a new doc is uploaded via the admin path, the admin should pick `allowed_roles` rather than relying on the folder convention (folder convention is bulk-import only).
- Role-aware re-ranking weights (out of scope for this work item — separate experiment).

## Test plan

Per session, the verification is described above. Cross-cutting checks before declaring the work done:

- Each of the 10 acting roles can sign in, run a query containing its own placeholder distinctive phrase, and get its own placeholder doc back.
- Cross-role contamination check: a Fire Officer query for "*span-of-control escalation thresholds for Type 1 incidents*" (Incident Commander's phrase) must return zero hits.
- Core docs (Emergency Management Framework, Alberta Emergency Plan, Emergency Management Strategy) appear for every role.
- Site Administrator sees everything when querying a known role-specific phrase.
- No regressions in the existing eval suite (`evals/`) — re-run after Session 2.

## Rollback considerations

- Schema: adding `allowed_roles` is a non-breaking field add. Removing it later requires an index rebuild, but the field can also just be ignored — low rollback risk.
- Filter: the OData filter is request-scoped; reverting `build_filter` to the pre-change implementation cleanly disables it without re-indexing.
- Frontend: sending an extra request field that the backend ignores is harmless if backend changes need to be pulled.

## Out of scope for this plan

- Role-based **system prompt** content (already wired via `actingRole` → prompt selection). This plan only adds retrieval filtering.
- Per-event document scoping (separate BACKLOG item).
- ACL via Entra group membership for documents (different concern; uses `oids`/`groups`, not `allowed_roles`).
