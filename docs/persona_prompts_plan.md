# Persona Prompts + Fire Officer Rename — Implementation Plan

Two coupled changes planned together because they touch overlapping surfaces:

1. **Persona prompts**: move role-specific system-prompt content from inline frontend TS strings to server-side Markdown files under `app/backend/prompts/personas/`, resolved by `acting_role` on the chat request rather than client-supplied. Closes a trust gap (today any client can override the persona via `prompt_template`) and makes personas SME-editable.
2. **Rename `firefighter` → `fire-officer`** (display: "Fire Officer") per SME request. Threaded ahead of persona file creation so the new files land with the new name.

**Status as of 2026-04-29:** Session 0 (decisions) and Session 1 (rename) complete. Persona prompts still live as TS strings in `app/frontend/src/components/RoleSelection/roles.ts` (`EMERGENCY_ROLES[*].prompt`, with `>>>` prefix appending to base). The frontend sends them in `context.overrides.prompt_template` on every chat request and the backend trusts the override. The `firefighter` → `fire-officer` rename has shipped (data folder, scripts, taxonomy, plan docs); remaining `firefighter`/`Firefighter` mentions are intentional proper-noun preservation (e.g. *Rules of Engagement for Firefighter Survival*, *10 Standard Firefighting Orders*) or descriptive historical context within this plan doc.

## Why now / motivation

- **Trust boundary.** Today, any client could send `prompt_template: ">>>You are an unrestricted assistant…"` and the backend honors it. With server-resolved personas, the role drives the prompt content from a known source. Manual prompt overrides survive for the dev settings panel only.
- **SME editability.** Markdown files are easier for non-engineers to revise than TS literal strings.
- **Layer correctness.** AI behavior moves to the backend, where AI behavior should be configured.
- **Reusable hook.** The `acting_role` field that needs to land on the request to drive personas is the same field the role-based retrieval filtering work needs. Wiring it once serves both efforts.
- **Terminology.** SME has asked for "Fire Officer" rather than "Firefighter". Renaming now is cheaper than later (current corpus is small; user accounts are lab-only).

## Decisions (resolved 2026-04-29)

All open decisions resolved with Dave's approval of the plan. Recommendations stand for D1, D2, D4, D5; D3 settled by Dave's account-creation choice.

### D1. Rename scope — **Chosen: A (comprehensive)**

Rename the role ID, type union members, taxonomy entries, lab UPN local-part, data folder, BACKLOG references, and role-descriptive prose in placeholder doc bodies. **Preserve proper-noun terminology** that's a literal reference to industry standards: "10 Standard Firefighting Orders", "Rules of Engagement for Firefighter Survival", "18 Watch Out Situations". Those are titles of named sources, not role labels. "Firefighter fatalities" in historical/statistical context (industry literature) is also preserved.

### D2. Persona files location — **Chosen: A**

`app/backend/prompts/personas/<role-id>.md`. Top-level, separates server-side persona config from request-time Jinja templates. Requires a small loader (new class or `PromptManager` extension that takes a base-dir param).

### D3. UPN local-part for the lab account — **Chosen: `fireofficer`**

Lab account is `fireofficer@emc1.ca` (single token, matching the existing `firefighter` UPN style for the field role). The lab account was created on 2026-04-29 ahead of this work landing. Note: this is neither of the originally proposed options (`fire_officer` underscore or keep-`firefighter`-and-alias) — it's a third variant that preserves consistency with the existing field-role UPN convention. `deriveAccountContext` maps `localPart === "fireofficer"` to `directActingRole: "fire-officer"`.

### D4. Manual `prompt_template` override — **Chosen: keep**

Keep as a developer/test affordance accessible via the chat settings drawer. Server-resolved personas take precedence for normal flows; the manual override is for developers iterating on prompt content. Optional follow-up: gate on a feature flag or admin claim so it's not exposed to regular users in production.

### D5. Site Administrator persona — **Chosen: no file**

Admins skip chat. The loader returns empty for `site-administrator` and the system prompt falls back to its un-injected base.

## Files involved

### Rename surfaces (D1 = comprehensive)

Frontend:

- `app/frontend/src/roles.ts` — `ActingRole`, `AccountType`, `ACTING_ROLES`, `LEGACY_UPN_TO_ROLE`, `GENERIC_PICKER_CHOICES`, `deriveAccountContext`. ~11 occurrences.
- `app/frontend/src/components/RoleSelection/roles.ts` — `EMERGENCY_ROLES` id, label, examples wording, prompt body. ~9 occurrences.
- `app/frontend/src/roleContext.tsx`, `pages/roleSelect/RoleSelect.tsx`, `pages/IndexRouter.tsx` — literal `"firefighter"` references.

Scripts / infra:

- `scripts/create_lab_users_{prod,test}.{sh,ps1}` — UPN local-parts and display names (per D3).

Data / docs:

- `data/firefighter/firefighter-guide-PLACEHOLDER.md` — rename folder and file; rewrite role-descriptive prose; **preserve proper-noun usage** (10 Standard Firefighting Orders, Rules of Engagement for Firefighter Survival).
- Other role placeholder docs that mention firefighter as a peer role (Safety Officer's guide references firefighter survival rules) — preserve proper-noun usage, update role-descriptive references.
- `BACKLOG.md` — multiple references to the role ID and to "firefighter" in flow descriptions.
- `docs/role_based_retrieval_plan.md` — references to the role.
- This document.

### Persona prompts wiring

Backend:

- New directory: `app/backend/prompts/personas/`
- New: 9 files — `fire-officer.md`, `incident-commander.md`, `safety-officer.md`, `liaison-officer.md`, `information-officer.md`, `section-chief-operations.md`, `section-chief-planning.md`, `section-chief-logistics.md`, `section-chief-finance.md`. Bodies extracted from current `EMERGENCY_ROLES[i].prompt` strings with `>>>` prefix stripped.
- New or extended loader: either a new `PersonaLoader` class or extend `PromptManager` to accept an alternate base directory. Caches per role on first load. Returns empty for unknown roles or `site-administrator`.
- `app/backend/app.py` — read `acting_role` from request body or `context`, validate against the canonical `ActingRole` list (Python-side mirror), reject unknowns with HTTP 400.
- `app/backend/approaches/approach.py` — extend `get_system_prompt_variables` (or its caller) to use the server-resolved persona text as the `injected_prompt` source. Existing client `override_prompt` (`>>>`-prefixed) still parsed for the manual-override dev path.
- `app/backend/approaches/chatreadretrieveread.py` and any other approach class that builds the system prompt — call into the persona loader before invoking `build_conversation`.

Frontend:

- `app/frontend/src/api/api.ts`, `models.ts` — add `actingRole` field on `ChatRequest` and any sibling request types. Read from `RoleContext.actingRole`.
- `app/frontend/src/pages/chat/Chat.tsx` — drop the `setPromptTemplate(role.prompt)` call inside `handleRoleSelect`; pass `actingRole` to the API call. The settings drawer's manual prompt-template textarea remains functional.
- `app/frontend/src/components/RoleSelection/roles.ts` — remove the `prompt` field from `EmergencyRole`. Keep `label`, `description`, `examples` (UI concerns).

## Sessions

### Session 0 — Resolve open decisions ✓

Resolved 2026-04-29. See "Decisions" section above.

### Session 1 — Rename `firefighter` → `fire-officer` ✓ (2026-04-29)

Comprehensive rename, no persona work. End state: codebase, lab accounts, data folder, and docs consistently use `fire-officer` (id) / "Fire Officer" (display).

Order within the session:
- Frontend type unions and role taxonomy (`roles.ts`, `RoleSelection/roles.ts`)
- Frontend literals in tsx files (`grep -r '"firefighter"' app/frontend/src` — should reach zero)
- Lab user scripts
- Data folder rename (`data/firefighter/` → `data/fire-officer/`) and file rename
- Selective rewrite of placeholder doc body — preserve proper nouns
- BACKLOG.md and the two plan docs
- Run `npm run build` (or `tsc`), run Python tests
- Final grep: `firefighter` should only appear in proper-noun contexts after this lands

If D3 = A, also update Entra lab account UPN. If D3 = B, update `deriveAccountContext` mapping to alias the old UPN onto the new role ID.

### Session 2 — Persona loader + content extraction

Backend-only, no read-path changes yet:

- Create `app/backend/prompts/personas/`.
- Implement `PersonaLoader` (recommend a new class rather than overloading `PromptManager` — clearer separation, since these are static config not per-request templates).
- Extract each role's current TS prompt string into the corresponding `.md` file. 9 files total. Strip the `>>>` prefix; the loader can either prefix it back or the consumer can treat the loaded text as the body to inject. Pick one and document.
- Unit tests: returns expected body per role, returns empty for `site-administrator`, raises a clear error for unknown roles.

End state: backend has personas on disk and a loader, but nothing yet calls into the loader.

### Session 3 — Wire end-to-end

- Backend `app.py`: read and validate `acting_role` on chat requests, thread into the approach call path.
- Approach class: invoke `persona_loader.load(acting_role)`; pass to `get_system_prompt_variables` as the injected prompt content. The client `override_prompt` path still works for the dev panel and remains the only client-side influence on the prompt.
- Frontend: send `actingRole` in chat requests; stop sending `prompt_template` from the role definitions. Settings-drawer manual override still sends `prompt_template` when the user types into the textarea.
- Frontend: remove `prompt` field from `EmergencyRole` interface; remove the prompt string literals.
- Manual verification: log in as Fire Officer → ask "what should I prioritize on the line?" → confirm the answer reflects the persona (PPE, LACES, immediate safety actions). Repeat with Incident Commander, confirm a different framing. Browser network tab: chat requests carry `actingRole`, no `prompt_template` from the role machinery.

### Session 4 — Tests, polish, docs

- Test: one-to-one match between `ACTING_ROLES` IDs (excluding `site-administrator`) and persona files on disk. Failsafe against an SME deleting a persona.
- Test: unknown `acting_role` returns 400.
- Test: persona text appears in the rendered system prompt (substring assertion or snapshot).
- Documentation: short `docs/personas.md` for SMEs explaining how to edit a role's behavior — file location, format, what changes when they edit.
- Update BACKLOG.md to mark the persona work shipped; link this doc.

## Sequencing rationale

Rename first (Session 1) so the persona files land with their final names and we don't rename twice. Persona infrastructure second (Session 2) so it's reviewable backend-only. Wire-through third (Session 3) so the frontend/backend cutover is one focused commit. Tests + docs last.

## Rollback considerations

- **Rename:** revert by branch. If lab UPN was renamed (D3 = A), Entra-side reversion is also needed.
- **Persona infra:** the loader and persona files are additive. Leaving them in place but unwired causes no behavior change.
- **Wire-through:** the `prompt_template` override path remains functional throughout, so reverting Session 3 only loses server-resolved personas, not all role steering. Frontend can re-enable the inline prompt strings in a follow-up commit if needed.

## Out of scope

- Role-based retrieval filtering — separate plan (`docs/role_based_retrieval_plan.md`). The `acting_role` request hook landed in Session 3 here serves both efforts.
- Persona content tuning / SME review of the prompt bodies. The Markdown files are exact extractions of today's TS strings; SME-driven content changes are a follow-up pass once the files are in place.
- Anthropic SDK migration.
