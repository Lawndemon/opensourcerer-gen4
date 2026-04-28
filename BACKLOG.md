# Backlog

Durable task list for opensourcerer-gen4, an emergency-response RAG built on the `azure-search-openai-demo` template. This file is the source of truth between sessions; session-scoped task lists inside the IDE are transient and should be reconciled against this document.

**Last updated:** 2026-04-21

---

## In flight

_Nothing in flight — pick up from "Next up"._

---

## Next up

### Make fresh-deploy work with auth on by default

Currently, a clean deployment on a new machine would deploy Bicep with `useAuthentication=true` but `auth_init` would skip (because it reads `AZURE_USE_AUTHENTICATION` directly from azd env, not parameters.json) — landing in a broken state with auth enabled but no app registrations. Fix by inverting the gate logic in `scripts/auth_init.ps1` and `scripts/auth_init.sh`: "skip only if explicitly `false`" instead of "run only if explicitly `true`". Trade-off: small divergence from upstream `azure-search-openai-demo` that may cause merge conflicts on those two files during future rebases.

Not on the critical path — can wait until current deploy is stable. Touching scripts, not infra; no redeploy needed after the edit.

### Enable persistent chat history via Cosmos DB

Blocked on auth being live (because chat history partitions by Entra user ID). Stock template capability, gated by `USE_CHAT_HISTORY_COSMOS=true`. One `azd env set` plus `azd up`. Provisions a Cosmos DB serverless account (~5-10 min added to deploy, single-digit dollars/month at lab usage). Backend code in `app/backend/chat_history/cosmosdb.py` handles the rest.

This is a prerequisite for the event-level workflow below but is useful on its own as "each user sees their own chat history across sessions".

---

## Design & build

### Event-level workflow and audit log (the big one)

The defining feature of the emergency-response variant — takes the template's per-user chat history and layers on concurrent-use + auditability + end-of-event report generation.

**Foundational principles (non-negotiable):**

- **Chat messages are append-only forever.** No edit, no delete, no admin override. Corrections happen by typing a new message; originals stay. Transcript is the legal record.
- **Event metadata IS editable** (description, location, scenario, enrichment) with an append-only change log. UI must distinguish "event details" (mutable) from "event log" (immutable transcript) so users never confuse them.
- **Generated reports are derived artifacts**, not source of truth. Reports must include or link to raw transcript so any summary claim can be traced to message + timestamp.
- **No event deletion.** Spurious/false-alarm events get closed with a corrective changelog note, not purged.
- **Two-axis model (refined 2026-04-21 after SME consult):**
  - **Account type** (how you sign in): `firefighter`, `incident_management_team`, `site_administrator`, `generic_user`. Determines the login flow and which acting-role choices the user is offered.
  - **Acting role** (the persona that drives RAG retrieval/tone and audit logging): one of 10 values — `firefighter`, `incident-commander`, `safety-officer`, `liaison-officer`, `information-officer`, `section-chief-operations`, `section-chief-planning`, `section-chief-logistics`, `section-chief-finance`, `site-administrator`.
- **Account-to-role flow:**
  - `firefighter@...` → acting role is Firefighter, no picker, straight to chat.
  - `incident_management_team@...` → shows an ICS sub-picker with the 8 ICS roles (Incident Commander, Safety Officer, Liaison Officer, Information Officer, the 4 Section Chiefs); picked role becomes acting role for the session.
  - `site_administrator@...` → skips all pickers, goes to admin landing (stub initially; full aggregate/closure/report tooling comes later).
  - `generic_user@...` → demo/fallback. Initial picker offers three options: Firefighter, Incident Management Team, Site Administrator. Selecting one routes to that account type's flow. Lets one credential exercise all three flows for client demos.
- **Detection of account type for MVP:** parse the UPN prefix (`firefighter@` → Firefighter type, etc.). Lab-specific hack; real deployments would look this up from an Entra group membership or a Cosmos user record. Tracked as future work under Task #9 follow-on.
- **Existing single-role test accounts remain in Entra** for advanced-client demo scenarios where a client genuinely wants per-role Entra accounts (direct account-to-acting-role mapping with no picker). Not used by the default two-account-type flow but kept for flexibility.
- **Admin powers** (cross-event aggregate, event closure, report generation, taxonomy management) are granted by having acting role `site-administrator`. A firefighter who is also a shift supervisor signs in to a different account (or in demo, picks Site Administrator from the generic flow) when they need admin powers. Accepted trade-off for lab MVP; revisit if users genuinely wear both hats in one session.

**Architecture:**

- Cosmos single source of truth. New `events` container keyed by `eventId`. Each chat entry tagged with `eventId`; same entries queried individually (by userId) or cross-user by eventId (admin-only aggregate view).
- Admin flag is one field on user record in Cosmos.

**Event record:**

- Core: eventId, scenario (hierarchical top-level + sub-type, admin-editable taxonomy), short description, status (active|closed), createdBy, createdAt, closedBy, closedAt.
- Optional/enrichable: location, severity, affected persons, incident commander, jurisdiction, additional free-text.
- Participants array (auto-populated on first chat by a user; captures user + role-at-join).
- ChangeLog array embedded on record (append-only, metadata only, never chat): `{ when, who, role, field, oldValue, newValue, action: add|change }`.

**Landing-page workflow (refined 2026-04-21):**

Post-login behavior is driven by account type, not by default-role lookup. UPN prefix determines account type for MVP.

- **Firefighter account** → no picker; acting role set to Firefighter; proceed to chat.
- **IMT account** → ICS role sub-picker (8 options); selection becomes acting role; proceed to chat.
- **Site Administrator account** → no picker; skip chat; go to Site Administrator landing (stub today, real admin tooling later).
- **Generic account** → intermediate picker with 3 options (Firefighter / IMT / Site Admin); selection routes to the corresponding account-type flow as if they'd logged in as that account.

Selected acting role is session-scoped (sessionStorage), logged on every event/chat action. No "always use this role" persistence in MVP — that lands when Cosmos user records are built. No mid-session role switching (matches immutability design); user signs out and back in to change.
2. Event list, three layered groups: "Your recent events" (active, user-participated, most-recent-activity first) → "Other active events" (most-recent-activity first) → "Closed events" (expandable, most-recent-close first).
3. User selects existing or creates new. Empty-state "No active events. [Create new event]" CTA.

**Event creation form:** Required = scenario + short description. Everything else addable post-creation. 3am-creation must be < 15 seconds.

**Role resolution chain (for multi-agency deployability):** Entra groups (if tenant configured) → in-app user record → user explicit selection. Each step is a fallback. User selection is always authoritative.

**RAG integration:** (scenario, role) tuple feeds retrieval bias and system-prompt shaping. E.g. (hazmat/chlorine, firefighter) → operational protocols; (hazmat/chlorine, media liaison) → authorized public-comms templates. This is the real differentiator vs. generic RAG.

**Close-event flow:** admin invokes close → backend aggregates all chat for that eventId across users → generates end-of-event form (PDF/DOCX) with inline transcript links → stores in blob or pushes downstream → event record frozen (status=closed, closedBy, closedAt).

**Admin capabilities (when role=`site-administrator`):** cross-event aggregate views, close events, generate reports, manage taxonomies (role list, scenario list), invite users.
**Admin CANNOT:** edit chat (nobody can), delete events (nobody can).

**Explicitly out of scope:**

- Permission hierarchies beyond the single admin flag
- Any chat mutation or deletion, ever, by anyone
- Event deletion or soft-delete
- "End of session" as a trigger for anything (unreliable in emergency conditions)
- Mid-conversation event switching
- Per-event role override (session-scoped only for MVP)

### Role-based document retrieval filtering (with core-document foundation)

Different functional roles should see different retrieval results — e.g. sensitive tactical playbooks for firefighters/ops but not for media liaisons. On top of role-specific partitioning, a universal "core" foundation of standards, legal/jurisdictional docs, and templates is visible to every role regardless of acting role (refined 2026-04-23 at Dave's request).

**Data model:**

Single multi-valued field on the search index: `allowed_roles: string[]`. Values are either literal ICS role IDs (`firefighter`, `incident-commander`, `safety-officer`, etc.) OR the special sentinel `"core"` meaning "universal — every role sees this." A doc can carry multiple role tags (`["firefighter", "section-chief-operations"]`) to show up for specific multiple roles without being universal.

**Retriever logic:**

For every query, the effective allowed-roles filter is `[userActingRole, "core"]`. Azure Search `$filter`:

```
allowed_roles/any(r: r eq 'firefighter' or r eq 'core')
```

This is hard access control (not just biasing) — documents without a matching tag won't be retrieved, period. No wildcards, no hierarchy, just literal string match.

**Ingestion — folder convention with manifest override:**

```
data/
  core/                              # default allowed_roles = ["core"]
  firefighter/                       # default allowed_roles = ["firefighter"]
  incident-commander/                # default allowed_roles = ["incident-commander"]
  ...                                # one folder per role as content grows
  roles-manifest.json                # per-file overrides for multi-role / edge-case docs
```

Folder name sets the default tag. `roles-manifest.json` (filename → `{ allowed_roles: [...] }`) overrides for documents that don't fit cleanly into one folder. Prepdocs reads folder first, then applies manifest override if present.

**Concrete work:**

1. Add `allowed_roles` multi-valued string field to the search index schema (Bicep + index definition in `app/backend/prepdocs.py` or schema module).
2. Reorganize `data/` into role folders. Current corpus: 3 core (Emergency Management Framework, Alberta Emergency Plan, Emergency Management Strategy), 1 multi-role (Rules of Engagement for Firefighter Survival — primary folder `firefighter/` with manifest granting access also to `section-chief-operations`, `safety-officer`, `incident-commander`).
3. Update `prepdocs.py` / ingestion to read folder + manifest and write `allowed_roles`.
4. Update retriever in `app/backend/approaches/*.py` to add the `$filter` clause based on the user's acting role.
5. Frontend: send `actingRole` from RoleContext with each chat request. Small touch in `src/api/api.ts`.
6. Backend: accept and use the `actingRole` field in the request. Small touch in `app/backend/app.py`.
7. Re-index existing docs after schema change.

Peer to the event workflow above, not a blocker. Once shipped, role selection actually *does* something (filters retrieval), not just tunes prompt tone.

### Trigger search re-index from admin portal after blob changes

After granting admin users (e.g. jhughes) the ability to add/remove documents in the `content` blob container, the RAG won't see those changes until the search index is rebuilt. Need a way to trigger this without `azd up` or running prepdocs locally.

**Three approaches worth evaluating:**

1. **Azure AI Search indexer + blob trigger (cloud-native)** — configure the search service to pull from the blob container automatically on a schedule or via Event Grid notifications. Most elegant; zero manual triggering. Limitation: the template's `prepdocs.py` does richer chunking/embedding than the built-in indexer; quality may drop.
2. **Event Grid → Azure Function → run prepdocs** — when blobs change in the container, Event Grid fires; a Function picks it up and re-runs the prepdocs ingestion logic. Preserves chunking quality. Adds Function App infra.
3. **Backend endpoint with admin auth, exposed in admin landing UI** — admin clicks "Re-index now" button, backend kicks off prepdocs as a background task and returns a status URL. Long-running; needs status polling. Simplest UX but explicit-action.

**Decision points:**
- Quality of cloud-indexer vs. prepdocs (test before committing)
- Auto-trigger vs. explicit admin action
- Re-index everything vs. only changed blobs (incremental)

Practical implication: this should land before real document curation begins. Today admins can upload but docs are invisible to RAG until someone re-indexes manually.

### Swap RAG LLM from Azure OpenAI to Anthropic Claude

Replace the chat-completion path in `app/backend/approaches/*.py` (currently Azure OpenAI, GPT-4.1-mini) with Anthropic's API. Embeddings stay on OpenAI since Anthropic does not offer an embeddings model — or alternately swap to Voyage AI / Cohere embeddings, which is a separate decision with its own re-indexing cost.

**What this actually touches:**

- Every approach class: `chatreadretrieveread.py`, `retrievethenread.py`, `chatapproach.py`, etc. All use the OpenAI SDK calling Azure OpenAI endpoints.
- System prompts — Claude is more steerable but has different best practices than GPT-4.1. The role prompts we wrote (Firefighter, ICS roles, etc.) may need tuning to get equivalent output quality.
- Streaming format — the SSE chunk shape differs between OpenAI's `chat.completions` and Anthropic's `messages` stream.
- Tool/function-calling — different schema; affects anything using the agentic-retrieval features.
- Secrets management — Anthropic API key into Key Vault, referenced from the Container App. Different from the Azure-native managed-identity flow we use for AOAI today.
- Content filtering — Azure OpenAI has integrated safety filters that Anthropic handles differently. Align on what the policy is.

**Options for the backend:**

1. **Anthropic API direct** — simplest code path, but introduces a cross-cloud dependency (egress from Azure to Anthropic's endpoints). Billing is separate from Azure.
2. **Claude via AWS Bedrock or Google Vertex** — also cross-cloud, also separate billing.
3. **Azure AI Foundry Anthropic models** — if available in the region. As of the last check (May 2025) Anthropic models were not in Azure OpenAI Service; check the Azure portal for current state. This would be the cleanest Azure-native option if it exists.

**Decision points to resolve before coding:**

- Which hosting path (Anthropic direct / Bedrock / Vertex / Azure Foundry)
- Whether to also swap embeddings (defer initially — unnecessary blast radius)
- Which Claude model tier (Haiku / Sonnet / Opus — trade cost vs. quality for the RAG use case)
- Prompt re-tuning scope — start with a direct swap and only re-tune where output quality regresses

**Not a one-line config swap.** Plan multi-session. First session is probably: decide hosting path, add Anthropic SDK dependency, stub a single approach class with Claude, validate end-to-end for one role before touching the rest.

---

## Notes on the deploy / template

- Template is upstream `azure-samples/azure-search-openai-demo`. Merges from upstream may conflict with:
  - `scripts/auth_init.ps1` / `.sh` if we invert the gate logic (see "Next up")
  - `infra/main.parameters.json` where we've hardcoded auth-on defaults
- The azd env file at `.azure/emergencyresponse/.env` is gitignored and persists on disk. Contains the app registration IDs and server app secret after first auth-enabled deploy. Back it up before destructive ops: `Copy-Item .azure/emergencyresponse/.env .azure/emergencyresponse/.env.preauth`.
- `azd up` takes roughly an hour end-to-end and has real cost. Batch changes where possible; don't deploy for single-flag flips.

---

## How to maintain this file

- Checkboxes for concrete work items, prose for design rationale.
- When something non-obvious is decided — *especially* tradeoffs where we rejected a reasonable-sounding alternative — capture the *why*, not just the *what*. Future-you will thank present-you.
- When a task is done, move its contents into a dated entry below, don't delete it. Record of decisions.
- If this file gets unwieldy (> ~400 lines), that's the signal to migrate to ADO.

---

## Done

### 2026-04-21 — Locked down public access with Entra authentication

**Outcome:** Container App no longer accepts anonymous traffic; all requests redirect to `login.microsoftonline.com` and require a valid Entra sign-in from the `emc1.ca` tenant.

**What changed:**

- `infra/main.parameters.json` — flipped `useAuthentication` default to `true`, set `authTenantId` default to `dc701977-419d-4e3d-87c0-d53cf7ef56a0`. Dynamic auth values (server/client app IDs, server secret) intentionally left sourced from azd env because they're produced at runtime by `scripts/auth_init.py`.
- `.azure/emergencyresponse/.env` — `AZURE_USE_AUTHENTICATION=true`, `AZURE_AUTH_TENANT_ID=<tenant>` set via `azd env set` (needed to beat the existing `"false"` value and kick `auth_init` into action).
- Two Entra app registrations created in the Evolve Management Consulting tenant by `auth_init` during `azd provision`:
  - Client (SPA): `e5ae100b-7372-4edb-a043-e5036e48ec05`
  - Server (API): `f313726c-e3b9-4b51-a096-d5239c1eabf1`
- Server app secret stored in azd env as `AZURE_SERVER_APP_SECRET`; Bicep wires it to the Container App as a secret reference.
- Container App revision rolled with new auth env vars; new search reader role assigned to backend identity (part of `useAuthentication=true` Bicep branch).

**Verified:** anonymous incognito request redirected to Microsoft sign-in; `dhewlett@emc1.ca` signed in successfully and saw the chat UI.

**Known gaps:** fresh-deploy on a different machine would still hit the `auth_init`-skips-on-empty-env footgun until the "next up" item is done.

### 2026-04-21 — Created lab test user cohort + tightened MFA to admins only

**Outcome:** Tenant now has 11 test users representing the ICS-based role taxonomy plus a generic user, created without first-login friction for fast iteration. MFA is still enforced on the admin accounts that matter, not on test users.

**What changed:**

- `scripts/create_lab_users_test.sh` / `.ps1` — creates 11 test users with `--force-change-password-next-sign-in false`.
- `scripts/create_lab_users_prod.sh` / `.ps1` — parallel variant for production-style validation (forced password change, security defaults assumed on).
- Tenant security defaults **disabled** via portal (Microsoft Entra ID → Properties → Manage security defaults → Disabled). Side-effect: MFA no longer auto-enforced on every account.
- Admin accounts manually re-enforced via legacy per-user MFA portal (https://account.activedirectory.windowsazure.com/UserManagement/MultifactorVerification.aspx), transitioned through Enabled → Enforced.

**Trade-offs accepted:**

- Legacy per-user MFA is deprecated. Microsoft will eventually retire the UI and API. Revisit if/when that happens or if real users warrant P1/Conditional Access.
- Security defaults off means the tenant loses its baseline blanket protection; we're now relying on per-user MFA for admins and password-only for test users. OK for a personal lab with a handful of accounts.

**Verified:** admin MFA prompt on sign-in still works; test users sign in password-only.
