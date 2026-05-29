# Backlog

Durable task list for opensourcerer-gen4, an emergency-response RAG built on the `azure-search-openai-demo` template. This file is the source of truth between sessions; session-scoped task lists inside the IDE are transient and should be reconciled against this document.

**Last updated:** 2026-05-25 (Microsoft-template decoupling plan documented; not running GitHub CI per Dave)

---

## In flight

_Nothing in flight — pick up from "Next up"._

---

## Next up

### Multi-phase (N-phase) incident testing — graduating scene-segment control (SME-requested 2026-05-21)

Let a single incident be driven through multiple waves of incoming chatter, so we can test how the scene evolves as new information arrives (and how recommendations track from "going well" to, per the SME, "a complete clusterfuck"). The SME is providing multiple scripts, each split into phases (3 to start, but treat the count as variable).

**UX:** a **Run Phase 2 → Run Phase 3 → …** control advances through the loaded script's phases and then **disappears once the last phase has run**. Make this **data-driven on the number of phases in the fixture (N phases, not hardcoded to 3)** — the label and the disappear-after-last behavior derive from the fixture length. (Dave's call; agreed 2026-05-21.)

**Placement — distinct floating DEMO cluster, NOT bundled with real controls (Dave, 2026-05-21).** The phase-progression button lives in the dedicated floating demo cluster (`.demoControls`, fixed bottom-left, dashed border + "DEMO" label) alongside **End demo** — deliberately separate from the real production controls (**Loss Stop** pinned top-right in the sticky header; **Re-Validate** floating bottom-right). Rationale: demo-only affordances must not pollute the production UI and must be removable as a unit when streaming STT replaces scripted phases. (`End demo` was moved out of the header into this cluster on 2026-05-21; the Run Phase button joins it.) See [[Segregate demo-only controls from production UI]].

**Design decisions agreed 2026-05-21:**

- **Phases are cumulative, not replacements.** Each phase's fixture holds *only the new chatter*; the kiosk concatenates phase[0..n] and the Validate pass runs against the union. This is what lets a Phase-1 green condition deteriorate to red by Phase 3, and it exercises the "fire on / fire off / fire back on" sticky-with-resurfacing semantics.
- **Re-Validate IAP and Loss Stop both remain available throughout.** Only the phase-advance button graduates and vanishes. Run Phase (feed *new* transcript) and Re-Validate (re-analyze *current* transcript) are distinct jobs; Loss Stop must be reachable at any point (the officer can end the active response mid-phase).
- **Non-blocking, like Re-Validate.** Each phase advance renders the scene immediately and fires forms/recommendations generation in the background — the kiosk-never-blocks rule still holds (see [[Fire Officer kiosk responsiveness]]).
- **Terminology:** these are *scene segments / updates within the Response phase*, NOT lifecycle phases (Response → Transition to Recovery → Recovery, where Loss Stop is the trigger). Keep the demo button labels as "Run Phase N" but name the code/data-model construct something like "scene segments" so the two meanings don't tangle.

**Main engineering risk to verify (not the button wiring):** cross-phase **item reconciliation by stable id**. As the transcript grows and we re-extract, scene items must *update in place* rather than duplicate (Phase 3 should not show three copies of "fire showing" — one item should change status). The "clusterfuck" scripts will stress this hardest; treat the stable-id merge holding across an accumulating transcript as the thing to confirm.

**Data model:** `KioskScenario.transcript: string` → a phases array (e.g., `phases: string[]`, each entry = that phase's new chatter); existing single-phase fixtures become length-1. Mirror in the backend JSON fixtures and `scripts/test_validate_iap.py` so the harness can run phase-by-phase. Per [[Don't over-engineer for the SME's short summary transcripts]], don't build per-phase answer keys — the SME's scripts are the test input, and real input will be streaming STT anyway.

### Scene-condition prioritization — order by importance within severity bands (SME-requested 2026-05-21)

The SME asked whether AI can order scene conditions by "importance" — not merely "reds on top," but inferring which conditions are most urgent or most likely to escalate into serious issues. Agreed approach (Dave + assistant, 2026-05-21): a two-tier sort.

**Tier 1 — severity band (deterministic, ship-able alone).** Primary sort by traffic-light status: `deviating_unsafe` (red) → `deviating_safe` (yellow) → `conforming` (green). Removed items stay at the bottom. Zero AI-inference risk — worth shipping on its own as Phase 1.

**Tier 2 — within-band priority (LLM-inferred).** Within each band, order by **escalation potential / trajectory** first, with the fire-service hierarchy **life safety → incident stabilization → property conservation** as the tiebreaker. The key insight: the highest-value signal isn't ranking the reds, it's floating the **yellow that is trending toward red** to the top of the yellows (the early warning) — which directly answers the SME's "potential to lead to serious issues."

- **Mechanism:** the extraction LLM emits a per-item **priority score + one-line rationale** (e.g., "escalation: smoke signature suggests imminent flashover"). Add a priority field + rationale to `SceneConditionAndAction` (contract change), update the extraction prompt, sort in backend/frontend.
- **Explainability / audit:** the rationale renders in the Analyze popup so ordering is human-checkable and auditable — this stays decision *support*, not an opaque oracle making life-safety calls.
- **Hard rule:** within-band only — priority NEVER lifts an item across a band (a green never outranks a red).
- **List stability:** on the fixed kiosk screen mid-incident, items must not thrash on every Re-Validate — use a stable tiebreaker (e.g., id / recency) so positions stay predictable.
- **Ties to multi-phase:** once a scene accumulates across phases ([[Multi-phase (N-phase) incident testing]]), "this condition worsened phase-over-phase" becomes computable trajectory, not just single-snapshot inference — rising-risk items bubble up.
- **Post-migration:** Tier 2 leans on exactly the reasoning Claude is stronger at; expect it to sharpen after [[Planned engine migration: OpenAI → Anthropic]].

**Phasing:** Phase 1 = deterministic band sort (low-risk, self-contained). Phase 2 = LLM escalation-priority + rationale within band.

### ICS Scene Type triage detection + Fire Officer confirmation control (SME-requested 2026-05-22)

Add ICS Canada incident **Type** (5 → 1) detection to the initial triage. The initial scene extraction estimates the applicable Type from the chatter; the Fire Officer confirms it (or overrides) on the kiosk. **Confirming the Type is a downstream trigger** — it fires support-recommendation auto-population (see [[Auto-populate support recommendations on scene-type confirm]]).

**Source (federal-tier, ICS Canada — consistent with the doc cascade):** Type 5 (lowest; 1–2 single resources, ≤6 personnel, Command/General Staff not activated) → Type 4 (some staff if needed; contained within hours) → Type 3 (capabilities exceed initial response; most staff activated; Type 3 IMTs) → Type 2 (beyond local jurisdiction; regional/provincial; most/all staff filled; multi-operational-period) → Type 1 (most complex; national/international resources; Unified Command; extensive logistics/planning).

**UX (Dave, 2026-05-22):**

- Five circles, rendered **left-to-right as 1 → 5 to conform to the ICS standard ordering** (NOT re-sorted by severity). Trained personnel read the tiering natively; **no `HIGH ◄──► LOW` gradient label for now** — parked as an optional future affordance for less-trained users.
- Positioned above or below the Scene Summary pane.
- A **check/confirm circle** sits to the right. Initial triage pre-selects the AI-estimated Type; the Fire Officer either taps the check to confirm the estimate, or taps a different number and then confirms.
- **Mind the inversion:** Type 5 = mildest, Type 1 = most severe — the *opposite* direction from the traffic-light severity bands (red/yellow/green). This is deliberate ICS convention; keep the Type control isolated from the severity colour channel so the two don't read as one scale.

**Trigger semantics:** treat "Type confirmed" as a first-class incident state change and audit event (`scene_type_confirmed` — who/when, AI-estimate → confirmed value). Confirming the Type kicks off **two** downstream jobs (both off the critical path per [[Fire Officer kiosk responsiveness]]): (1) support-recommendation auto-population (below), and (2) **populating all downstream forms** (Dave, 2026-05-22). **IAP validation is NOT triggered by Type-confirm** — it still runs only when the Fire Officer presses **Re-Validate IAP** (deliberate: validation stays an explicit, on-demand action).

**Scene type is mutable — the Fire Officer can change it on escalation (Dave, 2026-05-22).** The Type is not locked after the first confirm; the Fire Officer can raise (or lower) it as the scene evolves — e.g. a Type 4 that becomes a Type 2. **Changing the Type re-triggers the same downstream jobs as the initial confirm** — recommendation auto-population *and* forms population, both still off the critical path. (Confirmed by Dave 2026-05-22: a change re-fires BOTH forms and recommendations, exactly mirroring the initial confirm.)

**Logging is append-only (Dave, 2026-05-22; see [[Chat & transcript immutability principle]]).** Each Type change appends a **new** `scene_type_confirmed` audit event (from → to, who, when) — it never edits or overwrites the prior one. The incident's *current* Type is derived from the latest event; the full progression (Type 4 → Type 2 → …) stays visible in the immutable history. Same append-only discipline as the rest of the event log.

**Open questions:**

- Could the AI *also* proactively re-estimate the Type as the scene accumulates across phases ([[Multi-phase (N-phase) incident testing]]) and prompt the Fire Officer to re-confirm? (Manual FO change is the decided baseline; AI-suggested re-typing would be a future layer on top.)
- Per [[Don't over-engineer for the SME's short summary transcripts]], the AI Type estimate must work off streaming STT chatter, not the SME's tidy summary paragraphs — don't tune it to the placeholder shape.

### Auto-populate support recommendations on scene-type confirm — ICS-urgency ordering, role bubbles, AI/HIC provenance (SME-requested 2026-05-22)

When the Fire Officer confirms the scene Type (see [[ICS Scene Type triage detection]]), **all support roles automatically generate recommendations** into the Fire Officer's Scene Support pane — no per-role manual fetch.

**Grouping — three ICS urgency headers (Dave, 2026-05-22).** The Support pane groups recommendations under three section headers, in standard ICS priority order: **Life Safety (most urgent) → Incident Stabilization (mid) → Property Conservation (least)**. This is *text-header grouping*, NOT a severity-coloured sort — see the colour decision below. The same hierarchy is used as the within-band tiebreaker in [[Scene-condition prioritization]] — keep the two consistent (one shared enum/constant, not two parallel definitions).

**Category filter.** Only recommendations that map to one of those three categories auto-surface to the pane. The recommendation LLM tags its own output with the category; anything it cannot categorize into Life Safety / Incident Stabilization / Property Conservation is **filtered out of auto-surfacing** (not shown automatically).

**Role bubbles — acronym + vest colour.** Each recommendation carries a coloured bubble showing the role's official ICS **acronym**, the bubble **colour matching that role's official Canadian ICS vest colour**. E.g. an `SO` recommendation renders as an `SO` bubble in Safety-Officer red.

Authoritative mapping (SME-provided 2026-05-22; B.C. gov acronyms + Government of Canada vest colours):

| Role | Acronym | Vest colour |
|---|---|---|
| Incident Commander | IC | Green |
| Safety Officer | SO | Red (Command Staff) |
| Public Information Officer | PIO | Red (Command Staff) |
| Liaison Officer | LNO | Red (Command Staff) |
| Operations Section Chief | OSC | Orange |
| Planning Section Chief | PSC | Blue |
| Logistics Section Chief | LSC | Yellow |
| Finance/Administration Section Chief | FSC | Grey |
| Intelligence/Investigations Section Chief | I/I SC | Brown |

These are **net-new fields on the role model** — neither acronym nor vest colour exists in `roles.ts` today. Add `acronym` and `vestColor` to `RoleDefinition`.

**Colour decision (Dave, 2026-05-22) — severity colour stays out of the Support pane.** Traffic-light severity colouring (`deviating_unsafe` / `deviating_safe` / `conforming`) is confined to the **Scene Conditions** pane only. The **Support pane** uses the three plain-text urgency headers above (Life Safety / Incident Stabilization / Property Conservation) for grouping — no severity colour channel at all. This **dissolves the vest-vs-severity collision by design**: with no red/yellow/green severity present in the Support pane, a red SO bubble can't be misread as a "critical" severity flag. Vest colour is therefore free to live on the role bubble.

**One caution still stands — Command Staff share red.** SO, PIO, and LNO all wear the same red vest, so colour *cannot* disambiguate them — the **acronym text must always render**; never rely on colour alone to identify the role.

**AI / HIC provenance (SME-requested 2026-05-22).** Every recommendation bubble carries a provenance suffix: `{ACRONYM} - AI` when machine-generated, flipping to `{ACRONYM} - HIC` (Human In Charge) once the actual human in that role logs in and confirms it. Human-typed recommendations are born `HIC`. The acronym is constant; only the suffix flips.

- This is a **human-attestation layer**: the tool proposes (AI), a named human accepts accountability (HIC) — reinforces "decision *support*, not an oracle."
- New field on the recommendation (`provenance: "ai" | "hic"`) plus confirming-user + confirmed-at.
- **Confirm is per-recommendation (Dave, 2026-05-22).** The human ticks each item they agree with, and only those flip to HIC — faithful to "this named human agreed with *this specific* recommendation." Each flip is its own `support_recommendation_attested` audit event (below).

**Audit (log screen-facing deltas, not AI thought process — Dave, 2026-05-22; see [[Chat and transcript immutability is non-negotiable in opensourcerer-gen4]]).** *Add* and *remove* are already logged (`support_contribution_added`, `support_recommendation_dismissed`). The two "change" deltas need new event types:

- `support_recommendation_edited` — captures old → new text (also covers the refine-with-edit feature in [[Support-role UI refinements]]).
- `support_recommendation_attested` — the AI → HIC flip (which recommendation, which human, when).

Mechanically trivial: extend the `AuditEventType` literal + `event_log.append(make_audit_event(...))` at each handler; Cosmos is schemaless, so no migration. **The logging is the easy last mile; the *features* it rides on (inline edit UI, attestation state) are the real work.** Per Dave: do **not** log AI generation/regeneration churn — that's thought process, not a screen-facing delta.

**Dependencies / sequencing:**

- **Triggered by** [[ICS Scene Type triage detection]] (Type-confirm fires this auto-population; a later Fire-Officer Type *change* re-fires it).
- Shares the Life Safety → Stabilization → Property hierarchy with [[Scene-condition prioritization]] — one shared constant.
- Builds on the existing recommendation pipeline (`RecommendActionsApproach`, `RoleRecommendations` / `SupportContribution`, `RecommendationsPanel`). Category tag + provenance are new fields on those models.
- Honors [[Fire Officer kiosk responsiveness]]: auto-population on Type-confirm runs **off the critical path** (background, like Re-Validate) — never blocks the on-scene screen.

**I/I SC scope — reserved for later, NOT in scope now (SME + Dave, 2026-05-22).** The SME does not want the Intelligence/Investigations role included for now. Keep its acronym (`I/I SC`) and vest colour (Brown) reserved in the mapping so the data is ready, but **do not** add it as a ninth `ActingRole` / `IMT_ROLE_CHOICES` entry yet — the eight existing roles are the in-scope set. (Dave is personally interested in building richer support for this role down the line; parked as a future enhancement, not current scope.)

### Support-role UI refinements — remove dead "Refine" + add refine-with-edit to recommendations (SME-requested 2026-05-21)

Two SME-requested support-role changes. Item 1 is a trivial standalone quick-win; item 2 is a multi-file feature.

**1. Remove "Refine" from the support-role Scene Conditions list (quick win).** In the support views (`IncidentReadOnlyView` / `IncidentSupportView`), the shared `SceneItemRow` still renders the **Refine** button — disabled, with the tooltip "Refine requires a persisted incident." The SME wants the word gone entirely: refining a scene condition is a Fire-Officer-only action and will never be feasible for support roles. Fix: gate the Refine button block in `SceneItemRow.tsx` on `onRefineClick` being provided (mirror the existing `onRemove` hide-when-undefined pattern), so it renders only on the kiosk and disappears from support views. ~2-line change, no backend.

**2. Add a refine action to support-role Recommendations.** Each pending `RecommendationRow` currently has publish (✓) and dismiss (✕). Add a third action — **refine**, rendered as an ellipsis (… / `MoreHorizontal` icon) — between them. Clicking it opens a popup that (a) offers a few KB-grounded alternative phrasings of that recommendation (same visual pattern as the Fire Officer's `RefineConditionPopup`), and (b) provides an **editable text field** so the role can hand-tweak the wording before publishing.

Design notes / distinction to respect:

- **This is NOT the Fire Officer's refine.** The kiosk's Refine Condition re-evaluates a *scene condition's status* against narrowed KB context (`refine_condition` approach; `getRefinementOptions` / `applyRefinement`; mutates a `SceneConditionAndAction`). A recommendation refine instead produces alternative *phrasings of a support recommendation* and edits the text that will be published — a different backend call and a different apply path. Fork the popup's visuals; do not reuse the scene-condition endpoints.
- **The AI proposals are the core of refine, not optional** (Dave, 2026-05-21). The KB-grounded suggestion list is the primary value of the feature; the editable text field is layered on top for small human wording adjustments. Both ship together — do not reduce this to an edit-only field. Dave expects the suggestions to get materially better after the planned engine migration (see [[Planned engine migration: OpenAI → Anthropic]]).
- **Edit-text fits the support role:** they use a keyboard (the no-typing rule is kiosk-only), so free editing is consistent with their interaction model. It is the middle ground between accept-as-is (✓) and write-from-scratch (the existing `CustomAddForm`).
- **Publish-with-edited-text:** `publishRecommendation` currently publishes by id as-is. Extend it (or add a path) to accept an optional overridden text. Per the immutability/audit principle, the audit event should capture BOTH the original KB suggestion and the edited text so provenance is traceable; consider tagging source as `kb-edited` vs `kb` / `custom`. The edit emits the new `support_recommendation_edited` audit event (old → new text) defined in [[Auto-populate support recommendations on scene-type confirm]].
- **Backend:** a "refine recommendation" suggestions endpoint — a small new approach, or a mode on `RecommendActionsApproach` — returning 2-3 KB-grounded rephrasings for a single recommendation.
- **Frontend:** new `…` action in `RecommendationRow` + a `RefineRecommendationPopup` (forked from `RefineConditionPopup`) with a suggestions list plus an editable field; wire publish-with-text through `RecommendationsPanel`.

### Gate support-role recommendations on scene being parsed (refinement, requested 2026-05-20)

Support roles' recommendations currently auto-populate on `IncidentSupportView` mount even before the scene has been parsed. `RecommendationsPanel` auto-fires a refresh when `lastGeneratedAt === null`, and `RecommendActionsApproach` generates from scene state + already-published + recently-dismissed — so when the scene is empty/sparse (brand-new incident, or the support role opened it before the kiosk's scene extraction landed), the LLM produces premature, low-quality recommendations grounded in nothing.

**Fix:** recommendations are downstream of scene conditions and must not generate until the scene is loaded. Gate both the auto-refresh and (probably) the manual Refresh on the incident actually having scene content — e.g. `incident.sceneConditionsAndActions.length > 0` (or a non-empty `sceneSummary.text`). Until then, show a "Waiting for scene conditions…" placeholder instead of firing the recommendation call. Once scene conditions arrive (via the support view's 10s poll), allow the auto-refresh to proceed.

This is the same dependency shape as forms (recommendations and forms are both *downstream* of the primary scene extraction); keep them consistent. Small frontend change in `RecommendationsPanel` (the gate) plus the placeholder copy. No backend change needed.

### Faithful form/report templates — editable support-role forms + "Save as PDF" (SME-requested 2026-05-21) — BLOCKED on reference forms; do not start until they arrive

Replace the generic sections-in-a-popup form view with rendering that **matches each report's actual source-template layout**, make **support-role forms editable**, and let any report be **saved as a PDF that matches the source template's layout**. **Dave is providing all the real reports/forms as reference** — that is the unblocker; without the actual templates we cannot build faithful layouts, real field schemas, or matching PDFs.

Three parts:

1. **Faithful per-template rendering.** Each `formType` renders in a layout mirroring its official template (field arrangement, sections, labels) so emergency personnel recognize it — not the current generic sections view. Likely a per-`formType` rendering component (or a template-driven renderer) keyed off the structured content. ICS 201 is already fully structured; the placeholder forms (`PlaceholderFormContent`, generic sections) need their **real per-form field schemas** defined from the SME templates — a data-model expansion of the form-content discriminated union in `models/incidents.py`.

2. **Editable support-role forms.** Support roles can edit form fields directly (today forms are LLM-generated and read-only; the only support action is "Update forms" = regenerate). Adds: per-field edit UI, edit persistence, and phase-gating (Response forms lock at Loss Stop; Transition-to-Recovery forms editable during Transition). Fire Officer forms stay read-only on the kiosk (voice-only; locked at Loss Stop) unless the SME says otherwise.
   - **Key design tension — edit vs. regenerate.** A later "Update forms" regeneration would clobber manual edits. Need a rule before building: e.g., once a form is human-edited it locks from auto-regeneration (or regeneration only fills untouched fields, or requires explicit confirm). Decide so edits are never silently lost.
   - **Audit / provenance.** A form is a *derived artifact* (not the immutable record), so editing is permitted — but per the immutability principle each edit must be audit-logged (who / when / which field), and the LLM-generated draft should remain traceable. Edited forms still stamp incident id + generated/edited-at. See [[Chat and transcript immutability is non-negotiable in opensourcerer-gen4]].

3. **"Save as PDF" matching the source template.** Each form/report exports to a PDF whose layout matches the official template. Because matching layout is a hard requirement, favor **server-side PDF generation from the template** (the `pdf` skill / a template engine) over browser `window.print()` — browser print won't reproduce the official form faithfully. Keep the "Save as PDF" action on the form overlay (`stopPropagation` so it doesn't trigger the kiosk's tap-to-close). The PDF is a derived artifact: stamp incident id + timestamp + who generated it.

**Dependencies / blockers:**

- **Blocked on the SME/Dave-provided reference forms** (incoming) — required for faithful layouts, real field schemas, and matching PDFs.
- The **per-form matrix** (open question #3): which roles edit which forms, and each form's active lifecycle phase.

**Sequencing once references arrive:** start with ICS 201 (already fully structured) as the first faithful layout + PDF; expand `PlaceholderFormContent` into real per-form schemas as each template lands; layer editing onto the support-role forms; wire server-side PDF last.

(Supersedes the earlier "Print/PDF-ready report rendering" note.)

**Future enhancement (Dave, 2026-05-22) — per-form "Final Validation" before approval.** Each form gets a **Final Validation** button that runs one last scan of the incident log / event history before the human is allowed to **approve** the form. This is the human-approval gate on a derived artifact: the AI does a final consistency pass against the immutable record, then a named human approves — a HIC-style attestation (cf. the AI → HIC provenance in [[Auto-populate support recommendations on scene-type confirm]]). Likely reuses the existing validation machinery (cf. the `validate_iap` approach) pointed at a form + the event log. The approval itself is an append-only audit event. Not scheduled — captured here so it isn't lost.

### Make fresh-deploy work with auth on by default

Currently, a clean deployment on a new machine would deploy Bicep with `useAuthentication=true` but `auth_init` would skip (because it reads `AZURE_USE_AUTHENTICATION` directly from azd env, not parameters.json) — landing in a broken state with auth enabled but no app registrations. Fix by inverting the gate logic in `scripts/auth_init.ps1` and `scripts/auth_init.sh`: "skip only if explicitly `false`" instead of "run only if explicitly `true`". Trade-off: small divergence from upstream `azure-search-openai-demo` that may cause merge conflicts on those two files during future rebases.

Not on the critical path — can wait until current deploy is stable. Touching scripts, not infra; no redeploy needed after the edit.

### Enable persistent chat history via Cosmos DB

Blocked on auth being live (because chat history partitions by Entra user ID). Stock template capability, gated by `USE_CHAT_HISTORY_COSMOS=true`. One `azd env set` plus `azd up`. Provisions a Cosmos DB serverless account (~5-10 min added to deploy, single-digit dollars/month at lab usage). Backend code in `app/backend/chat_history/cosmosdb.py` handles the rest.

**Status update (2026-05-12):** the Cosmos account and database get provisioned together with the **incidents container** added in Session 3 (see Done below). The same `USE_CHAT_HISTORY_COSMOS=true` flag enables both. So enabling chat history is now a no-op infra-wise — flip the env and chat history starts using the existing Cosmos account. Backend wiring for chat history was always there; the only remaining work is verifying the chat-history sidebar surfaces in the chat UI when the flag is on.

---

### Custom support contribution — add category selector (Dave QoL, 2026-05-27)

When a support user adds a custom recommendation, the resulting `SupportContribution.category` is currently `None` (set explicitly in `add_custom_recommendation`'s ToC-bypass path; not threaded from the UI in either path). The kiosk groups support contributions by category (Life Safety / Incident Stabilization / Property Conservation / Other), so custom items fall into "Other" with no way for the human to set urgency intent. Add a 3-option selector (life_safety / incident_stabilization / property_conservation) to the custom-add UI in `RecommendationsPanel`, thread it through `AddCustomRecommendationRequest` + `add_custom_recommendation` cosmos fn (ToC-bypass path uses it directly when minting the SupportContribution), and persist it on `PendingRecommendation` so the pre-ToC publish path also carries it through.

### Reopen a locked incident — IC / Site-Admin only (Dave, 2026-05-27)

Lock is one-way in v1. Add a controlled unlock the IC or Site-Administrator can trigger from `CloseoutAdmin` once an incident is locked. Backend: `reopen_incident` cosmos fn that clears `locked_at` + `locked_by` and appends an `incident_reopened` audit event (with payload including who-locked-when and who-reopened-when, so the full lock/unlock history is reconstructible); endpoint `POST /api/incidents/{id}/reopen` with the same IC/Admin authorization as `/lock`. Frontend: a "Reopen incident" button shown alongside the locked banner in `CloseoutAdmin`, behind a confirmation prompt (reopen punches a hole in the official-record story, so make the action deliberate). Lock guard in `replace_incident` continues to allow the `lock → unlock → mutation` flow because, by the time the next mutation runs, the persisted doc is unlocked again.

### Full incident review / summary page — IC / Site-Admin (Dave, 2026-05-27) — bundle with [[Faithful form/report templates]]

A new IC / Site-Administrator page per incident that aggregates the entire record into a single review/summary view. The artifact for **corporate / municipal / federal post-incident reporting** — distinct from the active scene view and from CloseoutAdmin's workflow.

Contents:

- **AI-generated narrative summary** of the incident (events, scope, outcomes) — a new LLM approach that takes scene_summary, scene_conditions_and_actions, transcript, and the lifecycle events from event_log, and emits a structured prose summary. Doubles as the post-incident report cover narrative.
- **Key actions & decisions timeline** — filtered, audit-trail view of the high-signal events from event_log: scene-type confirms, refinements, ToC, support contributions accepted/withdrawn, Loss Stop, Close Incident, Lock. Each entry stamped with actor + timestamp.
- **Links to every form/report** — per-role forms with their "Save as PDF" exports (depends on faithful form layouts + server-side PDF generation, hence the bundling).
- **Link to the full transcript** — read-only view of the persisted transcript chunks.
- **Link to the raw event log** — full append-only audit view (every event with timestamp + actor), for compliance/inspection.

Implementation notes:

- Sits as a sibling/tab to `CloseoutAdmin` (or its own route — TBD; both are IC/Admin-accessible per-incident pages).
- The narrative-summary LLM call is non-trivial — a new approach module + prompt, similar in shape to `validate_iap` and `recommend_actions`. Output is structured (sections), not free-form, so the page can render consistently.
- Read-only by design — no mutations on this page. Source of truth stays the persisted doc.
- Tied to [[Faithful form/report templates]]: the PDF links depend on real per-form templates and matching PDF rendering being done. Don't start this page until the faithful-forms work has its first templates landing.


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
2. ~~**Transition to Recovery → Recovery transition trigger**~~ — RESOLVED 2026-05-20: a manual **Close Incident** action performed by the **Safety Officer** (see "Session 5e" in Next up). Closing removes the incident from the support-role selectable list (record persists, auditable). Full Recovery-phase tooling (reports) remains future scope; 5e implements only the close action + list exclusion.
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

### Codebase cleanup — dead-code purge + de-clutter inherited template (LOW PRIORITY, bottom of list — Dave, 2026-05-22)

opensourcerer-gen4 began as a fork of `azure-search-openai-demo`. The project has since pivoted hard toward the incident-centric Fire Officer / IMT direction, so much of the original AI-Search/RAG scaffolding is now clutter. Two cleanup passes, both explicitly **bottom-of-the-list — do not let this displace feature work**:

1. **Purge dead code.** Remove code that does nothing: unused functions, components, endpoints, imports, fixtures, config flags, and assets with no live references. Likely hunting grounds: leftover upstream chat/ask UI, unused approaches, the upstream `tests/` covering template features we no longer ship, dead config. Use a reference checker before deleting (grep for usages; `ts-prune`/`tsc` for the frontend, `vulture`/`pyflakes` for the backend) — confirm zero references, don't delete on a hunch.

2. **Refactor / optimize the inherited template code.** Tidy and streamline the `azure-search-openai-demo`-inherited code that remains relevant but carries template baggage from the original architecture. Goal: shrink surface area and make what's left coherent with the incident-centric design.

**Hard caveat — preserve the RAG retrieval the incident pipeline will need.** The KB retrieval machinery (search, embeddings, the planned Client > Region > Federal > Domain cascade) is *still load-bearing* for the incident pipeline even though it is currently unbuilt across that pipeline (see [[SME reference-document list]]). Cleanup must NOT rip out retrieval wholesale — distinguish "overtaken template UI/glue" (safe to cut) from "RAG retrieval we'll wire into incidents later" (keep). When in doubt, keep and flag rather than delete.

**Sequencing.** Strictly after the in-flight incident features stabilize (cleanup is lower-risk once the feature surface has settled). Note the engine migration ([[Planned engine migration: OpenAI → Anthropic]]) will itself touch/replace some of this code — decide whether to fold parts of the cleanup into that migration rather than doing the work twice.

### Decouple from the `azure-search-openai-demo` template — go-to-market as a non-profit (strategic; mapped 2026-05-25)

Strip the upstream template's *identity and cruft* so opensourcerer-gen4 can ship as an independent non-profit product. This is distinct from the [[#Codebase cleanup — dead-code purge + de-clutter inherited template]] entry above: that one is about dead/overtaken *code*; this one is about template *branding, docs, machinery, and licensing*. **Azure-the-platform stays** — we deploy to Azure Container Apps, so the `infra/`/bicep is how the thing runs, not noise to remove.

Six workstreams, mapped from a full recon of the actual footprint:

**1. License & attribution — the one legal must-do (do this first).**
`LICENSE` is MIT, "Copyright (c) 2023 Azure Samples." MIT lets us commercialize, run as a non-profit, rebrand, and rewrite freely — we owe Microsoft nothing and need no permission. The *single* obligation: retain the original copyright + license text somewhere as long as substantial portions of the original code remain. So **do not delete the attribution** — relocate it into a `THIRD-PARTY-NOTICES` file, and put the non-profit's own `LICENSE` (our copyright) at the repo root. Deleting the attribution outright is the one step with actual compliance weight. (Not legal advice — if the non-profit gets any legal review, worth a 5-minute confirm.)

**2. Inherited documentation — safe to remove (~25 of 31).**
`docs/` is mostly upstream Azure RAG guides (`customization.md`, `data_ingestion.md`, `deploy_*.md`, `azure_container_apps.md`, etc.). **Keep ours:** `persona_prompts_plan`, `persona_prompts_sme_review`, `prototype_plan`, `role_based_retrieval_plan`. Keep `login_and_acl` and `monitoring` as reference until rewritten (they still describe live behavior). Remove the rest.

**3. `.github/` template machinery — mostly remove.**
Upstream issue-triage bots (`agents/fixer`, `agents/triager`), `stale-bot.yml`, `nightly-jobs.yaml`, `lint-markdown.yml`/`validate-markdown.yml`, `evaluate.yaml`, `azure-dev*.y*ml`, `ISSUE_TEMPLATE.md`, `PULL_REQUEST_TEMPLATE.md`, `CODE_OF_CONDUCT.md`, `dependabot.yaml`, `instructions/`, `prompts/`, `skills/` all point at `Azure-Samples/azure-search-openai-demo`. **CI decision (Dave, 2026-05-25): not running any GitHub workflows today.** `python-test.yaml` and `frontend.yaml` look useful but are tuned to the *upstream* suite — `python-test` enforces `--cov-fail-under=90` and runs the upstream pytest + Playwright E2E that the cleanup pass is set to purge, so it would fail immediately on the pivoted codebase; `frontend.yaml` is a trivial prettier check. Recommendation: **remove the lot now**, and if CI is wanted later, add a small purpose-built workflow (ruff/black + `tsc`/prettier + our own tests) rather than resurrecting upstream's.

**4. Naming / branding — replace.**
`azure.yaml` still declares `name: azure-search-openai-demo` and `template: azure-search-openai-demo@0.0.3`; that name propagates into the deployed image path. UI is already rebranded ("Emergency Response Assistant"). Rename the azd project + drop the template ref. Minor azd-redeploy implication, nothing risky.

**5. Telemetry / phone-home — remove (lower urgency than it looks).**
App Insights / OpenTelemetry wiring in `app.py` is **gated on the `APPLICATIONINSIGHTS_CONNECTION_STRING` env var** — it does nothing unless that's set, so it is not actively leaking today. Full removal = delete that block plus the ~15 `opentelemetry`/`azure-monitor` packages from requirements. Worth doing for a clean conscience; not an open tap.

**6. Inherited code vs. our code — the big one; scope separately.**
Ours: `validate_iap`, `recommend_actions`, `extract_forms`, `refine_condition`, `incidents/`, `models/incidents`, the Fire Officer/IMT frontend. Inherited: `chatreadretrieveread`, `approach.py`, `promptmanager`, the whole `prepdocslib/` RAG ingestion + retrieval stack, the Chat page. **Wrap/rename the RAG retrieval stack — do not rewrite from scratch (it's load-bearing for the incident pipeline; see the Codebase cleanup caveat and [[SME reference-document list]]).** This overlaps the Codebase cleanup entry above and is large/vague enough to plan as its own effort rather than fold into the cosmetic passes.

**Suggested sequence:** License (1) → docs (2) → `.github` (3) → naming (4) → telemetry (5), each a reviewable commit; items 1–5 are low-risk and could land in a day. Then treat the code rewrite (6) as its own planned effort. Work happens on the `decoupled` branch (four prep cuts already landed there: removed `extractCitationDetails`, deleted orphaned `i18n/index.tsx`, dropped `rollup-plugin-visualizer`, removed `CONFIG_OPENAI_TOKEN`).

**Status — WS1–5 landed on `decoupled` (2026-05-25, uncommitted; Dave to review + commit):**

- **WS1 ✓** — root `LICENSE` replaced with **Apache 2.0, "Copyright 2026 EMC1"**; new `NOTICE` (EMC1 + MIT-derivation note); Azure Samples MIT notice relocated to `THIRD-PARTY-NOTICES`.
- **WS2 ✓** — `docs/` cut from 31 files to 6 (kept: persona_prompts_plan, persona_prompts_sme_review, prototype_plan, role_based_retrieval_plan, login_and_acl, monitoring; `docs/images/` pruned to the 2 still referenced). *Loose end:* `login_and_acl.md` still has upstream project name + a dead `/README.md` link — fix on rewrite.
- **WS3 ✓** — entire `.github/` removed (bots, workflows, issue/PR templates, CoC, dependabot, instructions/prompts/skills) + root Microsoft `SECURITY.md` removed. No GitHub CI is running (Dave, 2026-05-25); add a small purpose-built workflow later if wanted.
- **WS4 ✓** — `azure.yaml` renamed `azure-search-openai-demo` → `emergency-response-assistant`; `metadata.template` ref dropped. Resource naming in this template is driven by env-name + resourceToken, so this is effectively cosmetic for the deploy.
- **WS5 ✓ (app + deps)** — App Insights/OpenTelemetry imports + the `APPLICATIONINSIGHTS_CONNECTION_STRING`-gated block removed from `app.py`; 5 telemetry deps removed from `requirements.in`; lockfile recompiled (119 → 96 packages). Residual `opentelemetry-api/sdk` are benign transitive deps of `msgraph-sdk` with no exporter. **Follow-up (not done):** the infra App Insights wiring in `infra/main.bicep` is gated behind `useApplicationInsights = false` and threads through ~10 modules — left in place to avoid destabilizing the deploy; remove carefully in a dedicated infra pass.
- **WS6 (item 6 — inherited-code rewrite)** — not started; remains its own scoped effort (wrap/rename the RAG stack, don't rewrite). The four earlier prep cuts (`extractCitationDetails`, `i18n/index.tsx`, `rollup-plugin-visualizer`, `CONFIG_OPENAI_TOKEN`) are also still uncommitted on this branch.

### Transfer of Command + IC content gate (SME-requested 2026-05-25, building 2026-05-27)

Derived from the SME's EM Assistant workflow deck (three-mode model: Officer / Supervisor / Command). This implements the **Supervisor-Mode gatekeeper** via an explicit, IC-initiated Transfer of Command rather than a full mode state machine — incremental progress that stays flexible toward the full model.

**Trigger — deliberate, not implicit.** The IC page gets a **"Transfer of Command"** button. Pressing it (NOT mere login) engages the workflow. **One-way in v1:** once command transfers to the IC it stays there until the incident closes (no relinquish — revisit later; the deck's doctrine is bidirectional). Modelled append-only like Loss Stop / scene-type: a derived `command_transferred_at` flag on `IncidentDocument` + a `command_transferred` audit event as source of truth.

**What engaging ToC does:**

1. **FO kiosk status line** — a line directly under Scene Type reads **"Fire Officer in Charge"** by default and flips to **"Transfer of Command Initiated"** once the IC takes over.
2. **Scene-type authority flips.** Before ToC the Fire Officer owns the Scene Type; after ToC **only the Incident Commander** may change it, and the **FO kiosk scene-type control locks**. Scene Type is shown on the IC page and becomes editable there only after ToC. Enforced server-side in `confirm_scene_type` (authority by `actor.role` + command status; PermissionError → 403).
3. **Content gate (Supervisor-Mode gatekeeper).** While command is with the IC, support-role and AI-simulated recommendations no longer auto-surface on the FO kiosk — they route to the IC for **approve / reject** first; only IC-approved items cross to the kiosk. **Safety bypass:** items from the Safety Officer go **direct to the FO kiosk, flagged separately** (life-safety must not wait on an approval queue — consistent with the recommendation life-safety guardrail). Implemented as a gate state on `SupportContribution` set at creation time (in `publish_recommendation` + `apply_auto_populated_ai_contributions`) based on command status + originating role; FO kiosk filters to visible (ungated / IC-approved / Safety-bypass); IC page surfaces the pending queue.

**Orthogonal axes:** "command status" (org structure: FO-in-charge → IC) is distinct from "lifecycle phase" (Response → Recovery via Loss Stop). They do not interact in v1.

**Build status (2026-05-27):** COMPLETE at code level (backend `compileall` + frontend `tsc --noEmit` clean; not yet runtime-tested on a deploy). Backend: `command_transferred_at` + `command_transferred` event, `transition_command_to_ic`, IC-only `POST /transfer-of-command`, scene-type authority enforcement, `ic_status` gate on `SupportContribution` set in both publish + auto-populate paths (Safety→`safety_bypass`, others→`pending` post-ToC), `decide_gated_contribution` + IC-only `POST .../ic-decision`. Frontend: kiosk status line under Scene Type + scene-type lock + visible-content filter (Safety flagged); IC page Transfer-of-Command button + scene-type control (post-ToC only) + pending-approval queue. REMAINING: runtime/deploy testing with a real IC login; revisit one-way → reversible command handback later. **Refinements (2026-05-27):** IC approval pane wasn't refreshing on mount (poll had no immediate tick) — fixed. Cross-session updates are poll-based (no websockets — see decision: complexity + scale-out backplane not worth it yet); adaptive polling added (kiosk + IC/support views drop to 3s while command is transferred, 10s otherwise) plus an 'IC in control' banner on support panes (Safety notes its bypass). SSE is the lighter escalation if 3s isn't enough.

### CloseoutAdmin + final Lock Event + Loss-Stop scene freeze (SME-requested 2026-05-27)

Adds the post-response cleanup & reporting surface — the **corporate / municipal / federal reporting** stage — distinct from Loss Stop (which freezes the scene) and from the existing Close Incident (lifecycle response→recovery). Accessible to the **IC** and **Site Administrator** on any incident, any phase. Triggers a terminal seal that makes the incident the immutable official record.

**Loss-Stop semantics tightened.** Loss Stop now genuinely freezes the scene **server-side**: a new `SceneFrozenError` (→ HTTP 409) is raised from `_assert_scene_open(doc)`, called inside `confirm_scene_type`, `apply_validate_iap_result`, `remove_condition`, and `apply_refinement`. Previously only the UI hid these controls post-Loss-Stop; now the backend enforces it. Forms remain editable during cleanup; the scene does not.

**Three-step workflow on the new `CloseoutAdmin` page (per-incident, IC || Site-Admin):**

1. **Update all reports** — frontend fans `extract-forms` out across every form-bearing role in `Promise.all`, then `getIncident` to refresh. (Server-side fan-out is a possible future optimization; v1 client loop is fine at current scale.)
2. **Edit reports** — per-form expandable editor with per-field text inputs (ICS 201) or per-section heading/body textareas (placeholder forms). Saves via a new `POST /api/incidents/{id}/forms/{formId}/content` endpoint (`save_form_content` cosmos fn, audit event `form_content_edited`). Faithful per-form layouts and matching PDFs land later with the SME-supplied templates.
3. **Close out & lock event** — `POST /api/incidents/{id}/lock` (IC/Site-Admin only) sets `locked_at` + `locked_by` and appends a `incident_locked` audit event. One-way in v1 — no unlock action.

**Lock guard — centralized.** Rather than touching every mutation cosmos fn, a single check inside `replace_incident` re-reads the persisted doc; if `existing.locked_at is not None` it raises `IncidentLockedError` (→ HTTP 423). The lock transition itself passes because the persisted doc is still unlocked when `lock_incident` calls through. Subsequent writes from any path are rejected.

**UI signals:**

- **IncidentSupportView**: a "Closeout / Lock Event" entry button (IC || Site-Admin), an "Event locked" banner once `lockedAt` is set, early-return into `CloseoutAdmin` when the user opens it.
- **Fire Officer kiosk**: an "Event Locked" banner under the FO-in-charge status line; the existing `locked` state extends to include `lockedAt`, so the existing checks already hide Loss Stop / Re-Validate and disable the scene-type selector once locked. The LOCKED badge label switches to "EVENT LOCKED" when sealed.

**Build status (2026-05-27):** COMPLETE at code level (backend `compileall` + frontend `tsc --noEmit` both clean; runtime-untested). Existing `Loss Stop` + `Close Incident` flows kept as-is (response→recovery lifecycle). Mutation-button granular disabling on `IncidentSupportView` not added (banner + 423 backend rejection cover it for v1).

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

### 2026-05-21 — Incident Commander authorized to close incidents

**Outcome:** Added `incident-commander` to the close-incident authorized set, so the IC can close an incident (locking collateral via the recovery transition and dropping it off the support-role list) — extending the 5e capability. Safety Officer + Site Administrator retained; Transition-to-Recovery-only restriction and two-step confirm unchanged.

**What changed:** `app/backend/app.py` — `_CLOSE_INCIDENT_ROLES = {"incident-commander", "safety-officer", "site-administrator"}`. `app/frontend/.../IncidentSupportView.tsx` — `canClose` gate now includes `incident-commander`. Comments updated in both. No change to `close_incident()` mechanics (recovery transition + form lock + list exclusion already handle "lock all collateral / remove from support list").

### 2026-05-20 — Session 5e: per-role "Update forms" + Safety Officer "Close Incident"

**Outcome:** Support roles can regenerate their forms on demand without waiting on the Fire Officer, and the Safety Officer (or Site Administrator) can close an incident so it drops off the support-role list. Both honor the never-block-the-screen rule.

**Decisions locked (2026-05-20):** close authority = **Safety Officer + Site Administrator** (not Safety-Officer-only — avoids a dead-end if no Safety Officer is signed in). Closable phase = **Transition to Recovery only** (post-Loss-Stop). Close mechanism = **transition to the `recovery` phase** (reuses the existing `list_incidents(exclude_recovery=True)` exclusion; no new flag). This resolved old open question #2.

**What changed:**

- `app/backend/models/incidents.py` — `CloseIncidentRequest`; `ExtractFormsRequest.transcript` made optional.
- `app/backend/incidents/cosmosdb.py` — `close_incident()` (transition_to_recovery → recovery, locks active forms, `phase_transitioned` audit w/ trigger=close_incident; 409 from any other phase; idempotent if already recovery).
- `app/backend/app.py` — `POST /api/incidents/{id}/close` (403 unless actingRole ∈ {safety-officer, site-administrator}; 409 on wrong phase). `create_incident` now persists the opening transcript as a `TranscriptChunk`. `extract-forms` derives the transcript from persisted chunks when the body omits it (the support-role path) — so a support role's "Update forms" regenerates from the same source the kiosk used, avoiding form degradation.
- `app/frontend/src/api/*` — `closeIncident()` client + `CloseIncidentRequest` type; `extractForms` transcript optional.
- `app/frontend/.../IncidentSupportView.tsx` — "Update forms" button (non-blocking, drives `FormTabStrip` `generating`) + "Close Incident" button (shown only when Safety-Officer/Site-Admin AND phase=transition_to_recovery; two-step inline confirm; routes back to the list on success).

**Trade-offs / notes:**

- **Transcript persistence is a prototype simplification.** Stored as a single chunk from the fixture at create time; real append-only-from-mic STT chunks (with de-noising) are future. The immutability semantics formally apply once STT lands.
- **Verification gap:** the two large backend files (`app.py` ~1640 lines, `cosmosdb.py` ~900 lines) read as stale-truncated in the Linux sandbox (the recurring Windows→Linux mount issue), so a full `python` parse couldn't run there. My additions were isolate-parsed and are valid; the Windows-side files are intact (Read-confirmed) and are what `azd deploy` reads. Recommend a `python -m py_compile` in the devcontainer before deploy as belt-and-suspenders. Frontend `tsc --noEmit` is clean (the three affected frontend files were heredoc-resynced).

### 2026-05-20 — Session 5d.1: forms decoupled from the critical path

**Outcome:** Forms generation moved OFF the Fire Officer's critical path. Validate IAP returns the scene immediately; the 27 role-tagged forms are generated by a separate, background `extract-forms` call. The kiosk renders the dashboard the moment the scene returns and is never locked by form generation. Directly answers Dave's two requirements (2026-05-20): forms populated as fully as possible after the first parse, and the Fire Officer portal usable at all times (reloads never lock the screen).

**Why the refactor:** 5d originally chained scene→forms server-side in one request (`_run_validate_iap_with_forms`), which doubled Validate IAP latency and would have made the kiosk wait on form generation. Wrong shape for an emergency field device. Reversed it the same day — agile, fail-fast.

**What changed:**

- `app/backend/models/incidents.py` — `ExtractFormsRequest` (actingRole, transcript, optional scene state for the ephemeral path) + `ExtractFormsResponse`.
- `app/backend/incidents/cosmosdb.py` — new `apply_extracted_forms()` (wholesale forms replace + `form_generated` audit event). `apply_validate_iap_result()` no longer takes/sets `new_forms` — a scene re-validation preserves the last-generated forms until the background pass replaces them.
- `app/backend/app.py` — removed `_run_validate_iap_with_forms`. `validate-iap` and the `create_incident` inline path are scene-only again. New `POST /api/incidents/{id}/extract-forms`: reads authoritative scene from Cosmos when persisted, else from request body (ephemeral); runs `ExtractFormsApproach`; persists forms + audit when persisted; returns forms.
- `app/backend/prompts/extraction/extract_forms.md` — retuned to populate every form as fully as evidence + reasonable professional inference allow; hard line against fabricating specific identifiers (unit numbers, names, frequencies, addresses). "No info" is an explicit last resort.
- `app/frontend/src/api/*` — `extractForms()` client + `ExtractFormsRequest`/`Response` types.
- `app/frontend/src/pages/incidentKiosk/IncidentKiosk.tsx` — `formsGenerating` state + `triggerFormsExtraction` callback. Start Incident and Re-Validate render the scene, then fire the forms call in the background and merge when ready. Re-Validate keeps prior forms visible during the gap (no flicker). Functional setState guards against racing with Loss Stop / End demo / a newer incident.
- `app/frontend/src/pages/incidentKiosk/FormTabStrip.tsx` — `generating` prop → "Generating forms…" empty state.

**Trade-offs accepted:**

- **Forms lag scene by the background-generation window.** A support role opening a brand-new incident within ~1–2s may briefly see scene-populated-but-forms-empty until the kiosk's background call persists and their 10s poll picks it up. Expected, not a bug.
- **Forms generation is kiosk-triggered.** Persistence is server-side (survives once the call is in flight), but the *trigger* comes from the Fire Officer's client. If the tab closed in the split second between Start Incident and the call going out, forms wouldn't generate. Fix-if-needed: trigger `extract-forms` server-side at incident creation as a background task. Not worth it for the demo.
- **Two LLM calls, still serial.** Scene then forms — the forms call depends on the scene result, so they can't parallelize as-is. Latency levers if it ever bites: (1) per-role parallel split of the forms call (cheapest), (2) decouple forms from scene by re-reading the transcript so both run in parallel (risks scene/forms drift), (3) server-side background forms job (removes forms from the perceived critical path entirely). Documented so the decision trail survives.

**Verified:** Python AST parse clean (models, cosmosdb, app); `npx tsc --noEmit` clean. Hit the recurring Windows→Linux mount staleness on several frontend files; resolved via bash heredoc per `feedback_large_file_edits` memory.

### 2026-05-19 — Session 5d: per-role ICS forms (split-prompt extraction)

**Outcome:** The backend generates 27 role-tagged ICS forms (Fire Officer 3 + 8 support roles × 3) instead of just the Fire Officer's. Each role's incident view filters to its own 3 tabs. Built on a split-prompt architecture — a primary scene extraction whose result feeds a downstream forms extraction (Dave's idea: "primary scene extraction that can trigger the downstream extractions").

**What changed:**

- `app/backend/incidents/form_templates.py` (new) — single source of truth for the role→3-forms mapping + `stable_form_id()` for deterministic ids across passes. Mapping is standard federal ICS practice (each position's canonical forms); **SME's authoritative per-form matrix still pending** (open question #3) — titles/kinds swap here when it lands.
- `app/backend/approaches/extract_forms.py` (new) — `ExtractFormsApproach`: one LLM call, takes scene state + transcript, returns `list[FormSummary]`. Reconciles LLM output against the templates and overrides identity fields server-side.
- `app/backend/prompts/extraction/extract_forms.md` (new) — the forms prompt.
- `app/frontend/.../FormTabStrip.tsx` — `currentRole` prop filters forms by role; wired from kiosk (`fire-officer`) and `IncidentSupportView` (acting role).
- `fire_officer_validate_iap.md` — trimmed; scene prompt no longer emits forms (`"forms": []`).

**Form→role mapping shipped** (swap when SME matrix arrives): Fire Officer = ICS-201/214/213; Incident Commander = 202/207/209; Safety Officer = 208/215A/214; Liaison = Agencies-Log/213/214; PIO = Media-Log/Press-Log/214; Ops = 204/215/210; Planning = 203/211/209; Logistics = 205/206/218; Finance = OF-288/226/219.

### 2026-05-19 — Session 5c: support-role recommendation curation UI

**Outcome:** Support roles get a working recommendation-curation surface. `IncidentReadOnlyView` → `IncidentSupportView`. The Support Contributions pane is now a unified list (per Dave's "single list with status badges" choice) of pending / published / dismissed items, with publish (✓) / dismiss (✕) / custom-add, and a Refresh button with green/yellow staleness state. View polls `getIncident` every 10s.

**What changed:** `RecommendationRow`, `CustomAddForm`, `RecommendationsPanel` components (new); `IncidentSupportView` (renamed, polling added); wire types + 5 API client fns for the support-recommendation endpoints; `IncidentList` import rewire. Staleness computed frontend-side: hash of scene-items signature (`id:status:removed`) persisted in sessionStorage keyed by `${incidentId}:${role}`, compared on render — honors "only flag stale when scene items actually changed" without churning the backend's `scene_last_updated`.

### 2026-05-19 — Sessions 5b deploy + admin/picker changes

**Outcome:** Shipped the Session 5b recommendation-engine backend (5 endpoints, `RecommendActionsApproach`, kiosk polling for support contributions, Fire Officer dropped from the generic picker). Then two role-picker changes:

- **Admin can pick any role:** admin UPNs no longer auto-commit to `site-administrator`; they land on the picker.
- **Universal three-option picker (2026-05-19):** because UPN-based admin detection isn't reliable for testing, *everyone* who reaches a picker now sees the same three primary options — **Fire Officer** (→ kiosk), **Incident Support** (→ ICS sub-picker → support view), **Client/Site Administrator** (→ admin landing). `fireofficer@` and legacy direct-role UPNs still bypass the picker. Replaced `GENERIC_PICKER_CHOICES` + `ADMIN_PICKER_CHOICES` with one `PRIMARY_ROLE_CHOICES`.

### 2026-05-13 — Session 5 of Fire Officer prototype: IMT incident dashboard

**Outcome:** IMT / ICS roles get a new landing page — a list of incidents in their tenant grouped by phase, with click-through to a read-only view of the Fire Officer's dashboard. Citations rendered in the Analyze popup for support roles per the MAD framework. No write affordances for IMT in v1 (Support Contribution curation lands post-demo). Chat is no longer the default landing for non-Fire-Officer / non-admin roles.

**What changed:**

- `app/backend/incidents/cosmosdb.py` — new `list_incidents(tenant_id, *, exclude_recovery=True)`. Cross-partition query within a single tenant using a partial hierarchical partition key `[tenant_id]`. Sorted by `createdAt` DESC. Recovery-phase docs excluded by default since we don't ship that lifecycle yet.
- `app/backend/app.py` — new `GET /api/incidents` endpoint. Positioned before `GET /api/incidents/<incident_id>` so Quart routes correctly. Returns full `IncidentDocument` envelopes (`{"incidents": [...]}`).
- `app/frontend/src/api/incidents.ts` + `incidentTypes.ts` — `listIncidents()` function and `IncidentListResponse` type.
- `app/frontend/src/pages/incidentList/IncidentList.tsx` + CSS (new) — IMT landing. Loading / loaded / error / empty states. Two phase groups (Response live, Transition to Recovery) with subtitle hints, responsive card grid with incident ID + datetime + short description (truncated scene summary). Refresh button.
- `app/frontend/src/pages/incidentList/IncidentReadOnlyView.tsx` + CSS (new) — read-only single-incident view. Reuses kiosk's `SceneItemRow`, `AnalyzePopup`, `FormTabStrip` components and imports the kiosk's CSS module to keep structure identical. No Loss Stop / Re-Validate / Refine / Remove buttons. `AnalyzePopup` always renders citations (support-role view). `FormTabStrip` always locked. Back-to-incidents button in the header. Shows createdAt and lossStoppedAt metadata.
- `app/frontend/src/pages/IndexRouter.tsx` — IMT / ICS roles now land on `IncidentList` instead of `Chat`. Fire Officer and Site Admin routing unchanged. Chat remains available as a feature but is no longer the default landing for IMT.

**Trade-offs accepted:**

- **Full-document list, not summaries.** `GET /api/incidents` returns the entire `IncidentDocument` for each row, including `eventLog[]`. Fine for v1 volume; once tenants accumulate hundreds of incidents per day a summaries-only projection will pay for itself. Documented in the endpoint comments as the obvious next optimization.
- **No deep-linking to incident detail.** Selection lives in `IncidentList`'s React state. Navigating away or refreshing drops you back at the list. A real react-router refactor is post-demo if SME asks for shareable URLs.
- **No "join incident" or contribute UX.** Support roles can read but can't write Support Contributions yet. The curation workflow (KB recommendations + accept/dismiss + custom add) is BACKLOG'd for post-demo.

**Deploy:** code-only (no Bicep), goes out via `azd deploy` (~10 min). No new env vars.

**Verified:** `npx tsc --noEmit` clean. Backend Python parses cleanly.

### 2026-05-12 — Session 4 of Fire Officer prototype: Refine Condition + ICS 201 verification

**Outcome:** Refine Condition button is live end-to-end. Tap → backend returns 3 LLM-generated narrowing statements → Fire Officer picks one (or "None of the above") → backend re-evaluates the condition under the narrowed scenario, persists the new status, writes a `condition_refined` audit event, and the kiosk row updates in place. ICS 201 generation verified working from existing extraction prompt; no new code needed for that piece.

**What changed:**

- `app/backend/approaches/refine_condition.py` (new) — `RefineConditionApproach` class with `generate_narrowing_statements()` (temp 0.45 for diversity across the three statements) and `apply_refinement()` (temp 0.15 for deterministic re-evaluation). Mirrors the `ValidateIAPApproach` shape: load prompt from file, OpenAI JSON-mode, parse into local Pydantic models.
- Two new prompts in `app/backend/prompts/extraction/`: `fire_officer_refine_condition.md` (narrowing-statements generator — short, distinct, scenario-specific) and `fire_officer_apply_refinement.md` (re-evaluation with explicit None-of-the-above sentinel handling).
- `app/backend/incidents/cosmosdb.py` — new `apply_refinement()` helper: updates condition fields, appends a `ConditionRefinement` entry to `refinements[]`, writes a `condition_refined` audit event. "None of the above" recorded as the sentinel string `(none_of_the_above)` so analytics can distinguish a deliberate decline from a real refinement.
- `app/backend/app.py` — two new endpoints (`POST /api/incidents/{id}/conditions/{condId}/refine`, `POST .../refine/apply`). Both gated on Cosmos persistence (503 fallback). `RefineConditionApproach` instance registered as `CONFIG_REFINE_CONDITION_APPROACH`.
- Frontend `app/frontend/src/api/incidents.ts` + `incidentTypes.ts` — `getRefinementOptions()`, `applyRefinement()`, plus the three matching wire types.
- Frontend `app/frontend/src/pages/incidentKiosk/RefineConditionPopup.tsx` (new) + CSS — Fluent Dialog with four big tap targets (3 statements + dashed "None of the above"). Distinct loading / applying / error states. Single-tap selection → backend → close.
- Frontend `SceneItemRow.tsx` — Refine button is now functional when `onRefineClick` supplied; disabled with helpful tooltip when not (e.g., ephemeral incident, locked phase).
- Frontend `IncidentKiosk.tsx` — wired refine state and `handleRefinementApplied` (merges the returned `SceneConditionAndAction` into the in-memory state).

**Trade-offs accepted:**

- **Refine requires persistence.** No useful ephemeral fallback — you need a persisted condition for the audit log to mean anything. Refine button is disabled in the Session-1 fallback path (Cosmos 503).
- **Transcript fed to the refine prompt is empty in v1.** We read `TranscriptChunk[]` from the persisted incident, but chunks aren't yet written (streaming STT is post-MVP). The LLM falls back to condition text + plan context; quality improves automatically once chunks start flowing in.
- **No KB retrieval in v1 refine.** Same call to the chat-completion LLM, no Azure Search hop. The "knowledgebase-generated" narrowing statements are LLM-generated for now; real KB grounding lands with the role-based retrieval cascade.
- **Temperature split.** Narrowing is creative (0.45) so the three options actually differ; apply is near-deterministic (0.15) so the same inputs yield the same re-evaluation. Considered making this configurable but it's not worth a knob until we see real evals.

**ICS 201 verification finding:** the existing extraction prompt already produces fully-populated ICS 201 content in all three smoke-test fixtures (incident nam
