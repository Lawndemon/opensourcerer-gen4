# Backlog

Durable task list for opensourcerer-gen4, an emergency-response RAG built on the `azure-search-openai-demo` template. This file is the source of truth between sessions; session-scoped task lists inside the IDE are transient and should be reconciled against this document.

**Last updated:** 2026-04-29

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

### Incident-centric architecture (refined 2026-04-29 SME consultation)

> **Build-side plan:** [docs/prototype_plan.md](docs/prototype_plan.md) — vertical-slice prototype of the Fire Officer journey for SME demo. Six sessions from Validate IAP contract through demo polish. Added 2026-04-29.

A multi-day SME consultation refined the application architecture from a chat-centric model to an incident-centric model with role-specific UIs. This section is the current source of truth for the overall product shape; the older "Event-level workflow" and "Role-based document retrieval filtering" entries below remain valid for the pieces they describe but should be read in light of the refinements here.

#### Fire Officer kiosk paradigm

Primary device for the Fire Officer is an industrial-cased iPad. The interaction model is **voice + single-button-press, never keyboard**. Designed for emergency conditions where typing is impractical or unsafe.

Workflow:

- Device is logged in by default as the Fire Officer (Entra account, persisted device login).
- On exit-from-truck, the screen shows a single large **Start Incident** button.
- Pressing **Start Incident**:
  - Generates a new incident ID (date + time + unique ID component).
  - Enables the device microphone; begins building a transcript of radio chatter.
  - Surfaces the in-incident kiosk affordances: **Validate IAP** and **Loss Stop**.
- Pressing **Validate IAP** (one or more times during the incident):
  - Submits the entire transcript-to-date through a de-noising preprocessor, then to the RAG for validation.
  - Refreshes the three-panel dashboard: **Scene Summary**, **Scene Conditions**, **Support Conditions** (see "Validate IAP output structure" below).
- Pressing **Loss Stop** (once, when the active response is over):
  - Ends the live event.
  - Locks the live transcript and any Response-phase forms (e.g., ICS 201).
  - Transitions the incident from Response to Transition to Recovery.
  - **Fire Officer's interaction with the incident ends here** — per the SME, "they go home and watch TV". Subsequent enrichment, checklists, and recovery work are handled by IMT/support roles.

The Fire Officer never types. All affordances must be reachable via mic capture and single button presses.

#### Incident lifecycle

Three phases. **Response** and **Transition to Recovery** are in scope for v1; **Recovery** is future scope with an architectural hook reserved.

1. **Response** (live).
   - Begins: Fire Officer presses **Start Incident** on the kiosk.
   - Active: mic captures radio chatter; Fire Officer can press Validate IAP one or more times to refresh the dashboard; supporting roles join from their dashboard and contribute to **Support Conditions** (they cannot alter Scene Conditions).
   - Includes: response-phase forms such as ICS 201.
   - Ends: Fire Officer presses **Loss Stop**.

2. **Transition to Recovery**.
   - Begins: Loss Stop is pressed. Live transcript and Response-phase forms become uneditable.
   - Active: per-role "what to do next" checklists are generated from the knowledgebase. Supporting roles enrich incident metadata, complete forms/reports, and contribute to recovery documentation. Fire Officer no longer interacts with the incident in this phase.
   - **SME providing detailed content** for what each role sees/does in this phase, and which forms/reports become available.
   - Ends: trigger TBD — see "Open questions".

3. **Recovery** (future scope).
   - Begins: Transition to Recovery closes.
   - Active: government/legal reports generated. All incident information locked. UI is reviewable but not editable.
   - **v1 reserves the lifecycle hook** (incidents can transition to a final-locked state) but does not implement Recovery-phase UI/workflows. SME will provide Recovery requirements when ready.

#### MAD framework — Monitor / Analyze / Detail

A three-tier structure for surfacing extracted incident conditions and actions.

- **Monitor** — single-line row in the Scene Conditions and Actions panel. Each row is either an observed *condition* (e.g., "fire on scene") or a taken *action* (e.g., "RIT team deployed"), shown with a traffic-light icon encoding **life-risk severity** (refined 2026-04-29 SME consultation):
  - **Green check** = `conforming` — conforms with KB guidance.
  - **Yellow exclamation** = `deviating_safe` — deviates from KB but does NOT put human life at risk.
  - **Red X** = `deviating_unsafe` — deviates from KB AND puts human life at risk.
- **Analyze** — pop-up triggered by tapping a row. Surfaces the relevant published action plan content, the client plan content, and any delta between them. Citations are rendered for support roles (Liaison, Information, Finance/Admin etc.) but hidden in the Fire Officer kiosk (kiosk philosophy: simplicity-under-chaos). Driven by the document precedence cascade described below.
- **Detail** — aspirational, not in v1. The framework name preserves the third tier so it can land later without rewiring the UI.

**Refine Condition affordance.** Each Monitor row has a Refine Condition button beside the traffic-light icon. Optional, push-button only (kiosk-friendly). Clicking surfaces 3 KB-generated narrowing statements plus a "None of the above" option; selecting one re-evaluates the row's status against the narrowed context. Replaces the original "no plan documented" red-X concept — the SME's view is that the KB always has *something* applicable, and refinement is the user's tool when initial fit is imperfect.

For v1 we are effectively shipping MA, with MAD as the framework name throughout.

#### Validate IAP output structure

The Validate IAP output is rendered as a kiosk dashboard with three sections plus a per-role form tab strip at the bottom:

1. **Scene Summary** — top of screen. Brief, transcript-derived summary of the emergency scene. **Free text, max 3 lines, extremely concise.** Living entity — updates with each Re-Validate IAP press and (eventually) with streaming chatter and direct Fire Officer feedback.
2. **Scene Conditions and Actions** — the MAD-Monitor list. Each item is either a *condition* (observed state) or an *action* (command/operation taken), rendered as a single-line row with traffic-light icon (per MAD framework above) and a Refine Condition button.
   - **Write authority: scene transcript + direct Fire Officer feedback only.** Supporting roles cannot alter scene items. The Fire Officer can remove an item; removal is sticky-by-default but new transcript evidence post-removal can resurface it (per the SME's "fire on / fire off / fire back on" semantics).
3. **Support Contributions** — supplementary information fed in by supporting roles (IMT, command staff, section chiefs) who logged into the incident.
   - **Write authority: supporting roles only.** Fire Officer reads but does not write here.
   - **Workflow per role**: KB recommends a list of relevant support conditions for that role based on the active IAP. Each recommendation has a checkmark (accept → adds to the support contributions list visible on the Fire Officer's kiosk) and an X (dismiss). A "+ Add New Support Condition" button lets the role add custom contributions.
   - **Display format on Fire Officer view**: `[support role] support condition text`, ordered by role.
   - SME preparing detailed content for v2 implementation; v1 prototype renders a placeholder.

**Re-Validate IAP button** — floating bottom-right, always visible during in-incident mode. Each press re-runs LLM extraction against the accumulated transcript + applied refinements + support contributions, producing an updated dashboard state.

**ICS form tabs at bottom of screen, per role.** Each role has their own form tab strip — Fire Officer sees ICS 201 plus 2 placeholders (`AIPform1`, `AIPform2`); each support role sees their own 3 placeholder forms. Tabs pop up/close when poked. Forms generated as **structured JSON** (not markdown) so the rendered layout mimics the real form's named fields — important for emergency personnel to recognize under chaos.

Per-form lifecycle and role permissions vary:

- **Response-phase forms** (e.g., ICS 201) — active during Response; locked when Loss Stop is pressed (no longer editable in Transition to Recovery or beyond).
- **Transition-to-Recovery forms** — opened for enrichment after Loss Stop; editable by appropriate roles during Transition to Recovery.
- **Recovery-only reports** — generated only after Transition to Recovery closes (e.g., government / legal reports). Future scope.

Approximately 12 forms in scope across all roles. SME providing the full per-form matrix: which roles see/edit each form, and which lifecycle phase each form is active in.

#### Voice input / streaming STT

Voice input is already prototyped in the chat box (replaces typed input today). The kiosk paradigm requires a **streaming STT pipeline** that builds the incident transcript continuously while the mic is active. Microsoft's `cognitive-services-speech-sdk` is the planned starting point.

#### Transcript de-noising

Radio chatter has noise, mishearings, garbles, and overlap. Before validation runs, the raw transcript flows through a **de-noising preprocessor**. SME is providing real transcripts in the next few days; those are the basis for shaping the de-noising prompt/pipeline.

The transcript is part of the incident audit record, which **extends the chat-immutability principle**: the raw transcript is append-only-from-mic, audit-of-record, and not editable by users including admins. The de-noised version is a derived artifact; both are retained.

#### Other-roles incident dashboard

IMT roles, command staff, section chiefs, and Site Administrator no longer land on chat by default. Their landing page is a **list of incidents grouped by phase**:

- **Response** (live) — incidents currently in the Response phase. Most active; supporting roles join here to contribute Support Conditions while the Fire Officer drives the scene.
- **Transition to Recovery** — incidents that have been Loss Stopped. Supporting roles work the per-role checklists, enrich incident metadata, and complete forms/reports here. **Fire Officer does not appear in this list as a participant.**
- **Closed** (Recovery, future scope) — reviewable but not editable.

Each entry shows: incident ID, datetime created (set when Fire Officer first pressed **Start Incident**), short description (parsed from the initial transcript / initial IAP), and current phase indicator.

Once a role joins an incident, they operate within that incident's context. Their write authority depends on the phase:

- **During Response**: they contribute to **Support Conditions** only. Cannot alter Scene Conditions.
- **During Transition to Recovery**: they own enrichment, checklists, and form completion (the Fire Officer is no longer involved).

Keyboard input is allowed for these roles (in contrast to the Fire Officer's voice + button kiosk). Incident list scope (jurisdictional filter beyond the tenant scope already implied by multi-tenant) is an open question — see below.

#### Document hierarchy and retrieval cascade

The flat `data/<role>/` model from the existing role-based retrieval plan expands to a multi-tier hierarchy reflecting jurisdictional levels and tenant ownership.

**Top-level structure** (one of two industry primary categories applies per deployment):

- **Industry** — Oil & Gas, Mining (future verticals).
- **Municipality** — current focus. Municipal emergency response.

**Under Municipality** (the published-standards corpus, eventually maintained by an RPA solution):

- **Domain** — Firefighter (current focus), Medical, Police (future). Published profession standards.
- **Federal** — federal published emergency-response standards.
- **Region** — provincial/state published standards. **Regional wins over Federal** in conflicts.

**Client tier** (root level under `data/`, alongside `Municipality/`):

- **SpacelySprockets**, **CogswellCogs** — simulated client deployments. Real clients will have their own folders here. Client docs are city/county-level customized plans, NOT published standards.
- **Client docs supersede the published-standards tiers** (Domain/Federal/Region) for retrieval purposes.
- BUT both versions are retained at query time (tagged-and-merged retrieval) so the Analyze tier can surface deltas where the client plan diverges from published best practices.

**Precedence cascade** (highest priority first):

1. **Client** — wins over everything below.
2. **Region** — wins over Federal.
3. **Federal**.
4. **Domain** — floor of the cascade. Authoritative for profession-deep topics that the jurisdictional docs don't cover (SCBA technique, fire behavior fundamentals, etc.).

**Retrieval mode: tagged-and-merged.** Every document carries tier and tenant tags. Queries retrieve from all tiers, label each result with its tier; the relevance scores from the RAG do double duty:

- High-confidence matches feed the **Monitor** tier of MAD (the visible condition rows).
- Cross-tier relevance and conflicts feed the **Analyze** tier (delta detection, gap detection).

The existing `roles-manifest.json` data model expands to capture: role tags, tenant scope, tier (Client / Region / Federal / Domain), and industry vertical (Municipality / Oil & Gas / Mining). The SME is providing a spreadsheet mapping documents to roles, which **unblocks Session 1 of the role-based retrieval plan** (currently waiting on that input).

#### Multi-tenant Entra architecture

Per-client deployment is the fallback; **multi-tenant Entra is the goal**. Cost matters — this is a non-profit emergency-response project, not a commercial SaaS.

Plan:

- One Azure deployment serves multiple tenants (clients).
- Per-client Entra accounts identify the tenant via the `tid` claim in the access token.
- Backend extracts `tid` from the auth token; uses it as a filter on every search query (same hook shape as `acting_role`).
- **Data isolation is mandatory**: SpacelySprockets must not see CogswellCogs incidents or docs, and vice versa.

Fallback if multi-tenant data-isolation cannot be made bulletproof: deploy a separate Azure environment per client. Higher cost, stronger isolation. Decision deferred until isolation design is validated.

#### Open questions

**Resolved during the 2026-04-29 SME working sessions:**

- ~~Incident list scope (live/active)~~ — open incidents include both Response (live) and Transition to Recovery (post-Loss Stop). Closed incidents are reviewable but not editable. Jurisdictional filter beyond tenant scope is still open (see below).
- ~~Icon-to-state mapping~~ — refined to encode life-risk severity: green = `conforming`, yellow ! = `deviating_safe` (deviates from KB but does NOT put human life at risk), red X = `deviating_unsafe` (deviates AND puts human life at risk). Original "no plan documented" red-X concept superseded by the Refine Condition affordance.
- ~~Validate IAP semantics~~ — iterative refresh via the floating bottom-right "Re-Validate IAP" button. The Scene Summary and Scene Conditions and Actions panels are *living entities* that update with each press and (eventually) with streaming chatter and direct Fire Officer feedback.
- ~~Form ↔ incident lifecycle~~ — partially resolved. Per-phase form lifecycles confirmed (Response forms lock at Loss Stop; Transition forms editable during Transition; Recovery reports generated only after Transition closes). Per-form matrix forthcoming from SME.
- ~~Speech SDK source~~ — `Lawndemon/cognitive-services-speech-sdk` is Dave's intentional personal fork, not the upstream Microsoft samples.
- ~~Validate IAP contract sub-decisions (A-E)~~ — all five locked; see `docs/prototype_plan.md` Decisions section for the full TypeScript contract.
- ~~"No plan documented" handling~~ — replaced by the Refine Condition affordance. Per the SME, the KB always has *something* applicable; refinement narrows fit when imperfect. No fourth state on the icon.
- ~~Citations in Analyze popup~~ — role-conditional. Hidden in Fire Officer kiosk (simplicity-under-chaos); rendered for support roles using the existing chat citation pattern (especially valuable for legislative-adjacent roles).
- ~~Forms scope per role~~ — each role has their own form tab strip. Fire Officer gets ICS 201 + 2 placeholders; each support role gets 3 role-specific placeholders. Forms returned as structured JSON, not markdown.

**Still open:**

1. **Jurisdictional filter on the incident list** — within a tenant, do IMT roles see every incident across all jurisdictions, or are incidents scoped further (region, agency, dispatch zone)? The multi-tenant goal handles client-level isolation; this is the within-tenant question.
2. **Transition to Recovery → Recovery transition trigger** — manual button by an admin? Automatic when checklists complete? SME to weigh in once Recovery scope is closer to being addressed.
3. **Per-form matrix from SME** — full list of ~12 forms, each with: which roles see, which roles edit, which lifecycle phase the form is active in, lock-on-Loss-Stop vs editable-through-Transition. SME preparing.
4. **Per-role Transition to Recovery content** — what each role's "what to do next" checklist looks like, generated from which knowledgebase content. SME preparing.
5. **Loss Stop button placement on the kiosk** — visible alongside Re-Validate IAP from the moment Start Incident is pressed, or surfaces only at some later point? UX detail.
6. **Sample radio transcripts** — SME providing in the next few days; basis for shaping the de-noising preprocessor.
7. **SME role-to-document spreadsheet** — unblocks Session 1 of the role-based retrieval plan and the data-tier expansion of `roles-manifest.json`.

#### Implications for existing plans

- `docs/role_based_retrieval_plan.md` — `allowed_roles` field expands to include tier, tenant, and industry-vertical tagging. Session 1 waits on the SME's role-to-document spreadsheet. The retrieval mode (tagged-and-merged) is now confirmed.
- `docs/persona_prompts_plan.md` — personas need a parallel mode for validation/summarization (Validate IAP), not just chat Q&A. Same role identity, different output shape.
- `app/frontend/src/pages/chat/Chat.tsx` — stops being the default landing for IMT/admin roles; the active-incidents dashboard is the new landing. Chat remains an interaction mode within an incident's context.
- `data/roles-manifest.json` — schema expansion needed (tier, tenant, vertical) once SME spreadsheet arrives.

---

### Event-level workflow and audit log (the big one)

> **Read in conjunction with "Incident-centric architecture (refined 2026-04-29)" above.** The chat-as-default-landing assumption in this section is superseded for IMT/admin roles by the active-incidents dashboard. The event/incident model itself, the immutability principles, the participants/changelog semantics, and the close-event flow all still apply.

The defining feature of the emergency-response variant — takes the template's per-user chat history and layers on concurrent-use + auditability + end-of-event report generation.

**Foundational principles (non-negotiable):**

- **Chat messages are append-only forever.** No edit, no delete, no admin override. Corrections happen by typing a new message; originals stay. Transcript is the legal record.
- **Event metadata IS editable** (description, location, scenario, enrichment) with an append-only change log. UI must distinguish "event details" (mutable) from "event log" (immutable transcript) so users never confuse them.
- **Generated reports are derived artifacts**, not source of truth. Reports must include or link to raw transcript so any summary claim can be traced to message + timestamp.
- **No event deletion.** Spurious/false-alarm events get closed with a corrective changelog note, not purged.
- **Two-axis model (refined 2026-04-21 after SME consult):**
  - **Account type** (how you sign in): `fire-officer`, `incident_management_team`, `site_administrator`, `generic_user`. Determines the login flow and which acting-role choices the user is offered.
  - **Acting role** (the persona that drives RAG retrieval/tone and audit logging): one of 10 values — `fire-officer`, `incident-commander`, `safety-officer`, `liaison-officer`, `information-officer`, `section-chief-operations`, `section-chief-planning`, `section-chief-logistics`, `section-chief-finance`, `site-administrator`.
- **Account-to-role flow:**
  - `fireofficer@...` → acting role is Fire Officer, no picker, straight to chat.
  - `incident_management_team@...` → shows an ICS sub-picker with the 8 ICS roles (Incident Commander, Safety Officer, Liaison Officer, Information Officer, the 4 Section Chiefs); picked role becomes acting role for the session.
  - `site_administrator@...` → skips all pickers, goes to admin landing (stub initially; full aggregate/closure/report tooling comes later).
  - `generic_user@...` → demo/fallback. Initial picker offers three options: Fire Officer, Incident Management Team, Site Administrator. Selecting one routes to that account type's flow. Lets one credential exercise all three flows for client demos.
- **Detection of account type for MVP:** parse the UPN prefix (`fireofficer@` → Fire Officer type, etc.). Lab-specific hack; real deployments would look this up from an Entra group membership or a Cosmos user record. Tracked as future work under Task #9 follow-on.
- **Existing single-role test accounts remain in Entra** for advanced-client demo scenarios where a client genuinely wants per-role Entra accounts (direct account-to-acting-role mapping with no picker). Not used by the default two-account-type flow but kept for flexibility.
- **Admin powers** (cross-event aggregate, event closure, report generation, taxonomy management) are granted by having acting role `site-administrator`. A fire officer who is also a shift supervisor signs in to a different account (or in demo, picks Site Administrator from the generic flow) when they need admin powers. Accepted trade-off for lab MVP; revisit if users genuinely wear both hats in one session.

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

- **Fire Officer account** → no picker; acting role set to Fire Officer; proceed to chat.
- **IMT account** → ICS role sub-picker (8 options); selection becomes acting role; proceed to chat.
- **Site Administrator account** → no picker; skip chat; go to Site Administrator landing (stub today, real admin tooling later).
- **Generic account** → intermediate picker with 3 options (Fire Officer / IMT / Site Admin); selection routes to the corresponding account-type flow as if they'd logged in as that account.

Selected acting role is session-scoped (sessionStorage), logged on every event/chat action. No "always use this role" persistence in MVP — that lands when Cosmos user records are built. No mid-session role switching (matches immutability design); user signs out and back in to change.
2. Event list, three layered groups: "Your recent events" (active, user-participated, most-recent-activity first) → "Other active events" (most-recent-activity first) → "Closed events" (expandable, most-recent-close first).
3. User selects existing or creates new. Empty-state "No active events. [Create new event]" CTA.

**Event creation form:** Required = scenario + short description. Everything else addable post-creation. 3am-creation must be < 15 seconds.

**Role resolution chain (for multi-agency deployability):** Entra groups (if tenant configured) → in-app user record → user explicit selection. Each step is a fallback. User selection is always authoritative.

**RAG integration:** (scenario, role) tuple feeds retrieval bias and system-prompt shaping. E.g. (hazmat/chlorine, fire-officer) → operational protocols; (hazmat/chlorine, media liaison) → authorized public-comms templates. This is the real differentiator vs. generic RAG.

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

> **Read in conjunction with "Incident-centric architecture (refined 2026-04-29)" above.** The flat `allowed_roles` model described here expands into a multi-tier cascade (Client / Region / Federal / Domain) plus tenant scope and industry vertical. Tagged-and-merged retrieval is now confirmed as the retrieval mode. The plan's Session 1 currently waits on the SME's role-to-document spreadsheet.

> **Detailed implementation plan:** [docs/role_based_retrieval_plan.md](docs/role_based_retrieval_plan.md) — session-by-session sequencing, file anchors, open decisions, and test plan (added 2026-04-29).

Different functional roles should see different retrieval results — e.g. sensitive tactical playbooks for fire officers/ops but not for media liaisons. On top of role-specific partitioning, a universal "core" foundation of standards, legal/jurisdictional docs, and templates is visible to every role regardless of acting role (refined 2026-04-23 at Dave's request).

**Data model:**

Single multi-valued field on the search index: `allowed_roles: string[]`. Values are either literal ICS role IDs (`fire-officer`, `incident-commander`, `safety-officer`, etc.) OR the special sentinel `"core"` meaning "universal — every role sees this." A doc can carry multiple role tags (`["fire-officer", "section-chief-operations"]`) to show up for specific multiple roles without being universal.

**Retriever logic:**

For every query, the effective allowed-roles filter is `[userActingRole, "core"]`. Azure Search `$filter`:

```
allowed_roles/any(r: r eq 'fire-officer' or r eq 'core')
```

This is hard access control (not just biasing) — documents without a matching tag won't be retrieved, period. No wildcards, no hierarchy, just literal string match.

**Ingestion — folder convention with manifest override:**

```
data/
  core/                              # default allowed_roles = ["core"]
  fire-officer/                      # default allowed_roles = ["fire-officer"]
  incident-commander/                # default allowed_roles = ["incident-commander"]
  ...                                # one folder per role as content grows
  roles-manifest.json                # per-file overrides for multi-role / edge-case docs
```

Folder name sets the default tag. `roles-manifest.json` (filename → `{ allowed_roles: [...] }`) overrides for documents that don't fit cleanly into one folder. Prepdocs reads folder first, then applies manifest override if present.

**Concrete work:**

1. Add `allowed_roles` multi-valued string field to the search index schema (Bicep + index definition in `app/backend/prepdocs.py` or schema module).
2. Reorganize `data/` into role folders. Current corpus: 3 core (Emergency Management Framework, Alberta Emergency Plan, Emergency Management Strategy), 1 multi-role (Rules of Engagement for Firefighter Survival — primary folder `fire-officer/` with manifest granting access also to `section-chief-operations`, `safety-officer`, `incident-commander`).
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
- System prompts — Claude is more steerable but has different best practices than GPT-4.1. The role prompts we wrote (Fire Officer, ICS roles, etc.) may need tuning to get equivalent output quality.
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
