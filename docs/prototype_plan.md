# Fire Officer Prototype — Implementation Plan

**Status as of 2026-04-29:** not started. Session 0 (decisions) precedes Session 1.

Vertical-slice prototype of the Fire Officer kiosk journey, end-to-end, for SME demo. Everything else (other roles' workflows, full retrieval cascade, multi-tenant data isolation, streaming STT, the rest of the ICS form set) is deferred — stubbed minimally where the prototype needs them visible, full implementation comes after SME validates the priority feature.

This is the build-side companion to the architecture context captured in `BACKLOG.md` → "Incident-centric architecture (refined 2026-04-29 SME consultation)".

## Goal

A demo-able prototype where a Fire Officer signs in, presses **Start Incident**, a transcript fixture loads (proxy for live radio chatter until streaming STT lands), the kiosk shows a three-panel dashboard (Scene Summary, Scene Conditions with traffic-light icons, Support Conditions stub) plus an ICS 201 tab generated from the transcript, and **Loss Stop** ends and locks the incident. SME validates that:

1. The conditions extracted from a transcript look reasonable and useful.
2. The traffic-light pattern (following / deviating / no plan documented) is intuitive.
3. The Analyze pop-up content (action plan context for a condition) provides real value.
4. The form-generation idea is plausible (one form proves the pattern; the rest follow the same shape).
5. The kiosk UX feels right for the field — voice + button only, no keyboard.

## In scope

- Fire Officer kiosk page: Start Incident → in-incident view (three-panel dashboard + form tab) → Loss Stop.
- Validate IAP backend pipeline: transcript in, structured analysis out.
- A purpose-built **extraction prompt** for Validate IAP (different from the chat-mode persona prompts already in `RoleSelection/roles.ts`). Lives alongside the personas as a parallel set.
- One ICS form generated from the validated conditions (ICS 201).
- Stub of the Other-roles incident dashboard so the architecture is visible to the SME.
- Cosmos persistence for incident records.
- Sample synthetic transcripts as fixtures (until SME's real ones arrive).
- Demo polish: sample data, basic styling, error handling.

## Out of scope (deferred until after SME demo)

- Streaming STT — `Lawndemon/cognitive-services-speech-sdk` integration.
- Full retrieval cascade — Client > Region > Federal > Domain tagged-and-merged. Prototype uses the existing flat index for retrieval; tier tagging arrives in the role-based retrieval plan's Session 1+.
- Multi-tenant data isolation — single-tenant for the prototype; tenant filtering arrives later.
- The remaining ~11 ICS forms — only ICS 201 in the prototype.
- Supporting-role contributions to Support Conditions — the panel renders as a placeholder in v1.
- Transition to Recovery phase work — checklists, enrichment, role-specific views. Lifecycle hook is reserved (Loss Stop transitions phase) but Transition-phase UI is deferred.
- Recovery phase entirely.
- Persona prompt server-side resolution — `docs/persona_prompts_plan.md` is a separate effort. Validation prompts in this prototype live as backend assets directly without going through the PersonaLoader infrastructure that plan introduces.
- Role-based retrieval filtering — `docs/role_based_retrieval_plan.md` is a separate effort.

## Decisions (resolved 2026-04-29 SME consultation)

All seven decisions resolved across two SME working sessions. Recorded here as the locked specification.

### D1. Validate IAP request/response contract — **Locked**

**Request:**

```typescript
interface ValidateIAPRequest {
    incidentId: string;
    transcript: string;        // full accumulated transcript-to-date
    actingRole: ActingRole;    // "fire-officer" for the kiosk path
}
```

**Response — top-level shape:**

```typescript
type IncidentPhase = "response" | "transition_to_recovery" | "recovery";

interface ValidateIAPResponse {
    incidentId: string;
    phase: IncidentPhase;
    sceneSummary: SceneSummary;
    sceneConditionsAndActions: SceneConditionAndAction[];
    supportContributions: SupportContribution[];   // empty array in v1 prototype
    forms: FormSummary[];                          // filtered to requesting role's forms
}
```

**Scene Summary** — free text, max 3 lines, extremely concise:

```typescript
interface SceneSummary {
    text: string;
    lastUpdated: string;       // ISO timestamp
}
```

**Scene Conditions and Actions** — items in the MAD-Monitor list, each either an observed condition or a taken action; status encodes life-risk severity per refined SME semantics:

```typescript
type ConditionStatus = "conforming" | "deviating_safe" | "deviating_unsafe";
// conforming         → green check (conforms with KB guidance)
// deviating_safe     → yellow ! (deviates from KB but does NOT put human life at risk)
// deviating_unsafe   → red X (deviates from KB AND puts human life at risk)

type ItemType = "condition" | "action";
// condition: observed state (e.g., "fire on scene")
// action:    command or operation taken (e.g., "RIT team deployed")

interface ConditionCitation {
    sourceFile: string;        // e.g., "SCES-Municipal-Emergency-Plan.pdf"
    sourceTier: "client" | "region" | "federal" | "domain";
    pageOrSection: string;
    excerpt: string;
}

interface ConditionRefinement {
    timestamp: string;
    selectedStatement: string;                       // narrowing statement the user picked
    selectedBy: { role: ActingRole; userId: string };
}

interface SceneConditionAndAction {
    id: string;                                      // stable across re-validations
    type: ItemType;
    text: string;                                    // single-line description (Monitor row)
    status: ConditionStatus;
    publishedPlanContext: string | null;             // what the action plan says (Analyze popup)
    clientPlanContext: string | null;                // what the client plan says
    delta: string | null;                            // difference between client and published, if any
    citations: ConditionCitation[];                  // up to 2 max; hidden in Fire Officer kiosk; rendered for support roles
    removed: boolean;                                // Fire Officer curation state
    removedAt: string | null;                        // ISO timestamp
    removedBy: { role: ActingRole; userId: string } | null;
    refinements: ConditionRefinement[];              // history of Refine Condition selections
    firstDetectedAt: string;                         // ISO timestamp
    lastConfirmedAt: string;                         // ISO timestamp of latest extraction confirming this item
}
```

**Support Contributions** — recommendation-curated by support roles (placeholder list in v1 prototype; full implementation post-demo):

```typescript
interface SupportContribution {
    id: string;
    text: string;                                    // free-text contribution
    source: "recommended" | "custom";                // recommended-and-accepted, or custom-added
    addedBy: { role: ActingRole; userId: string };
    addedAt: string;                                 // ISO timestamp
}
```

**Forms** — discriminated union per form type. Real ICS forms get their own schema; placeholder forms share a generic shape:

```typescript
interface ICS201Content {
    formType: "ICS-201";
    incidentName: string;
    dateTimeInitiated: string;
    situationSummary: string;
    currentObjectives: string;
    currentActions: string;
    resourceSummary: string;
    preparedBy: string;
}

interface PlaceholderFormContent {
    formType: string;                                // e.g., "AIPform1", "SafetyOfficerForm1"
    title: string;
    sections: { heading: string; body: string }[];
}

type FormContent = ICS201Content | PlaceholderFormContent;

interface FormSummary {
    formId: string;                                  // stable per-incident form identifier
    title: string;
    role: ActingRole;                                // which role's tab strip this belongs to
    status: "active" | "locked";
    content: FormContent;
    lastUpdated: string;
}
```

**Audit log** — every state-changing operation is recorded; current state is derived but the event log is the source of truth:

```typescript
type AuditEventType =
    | "condition_extracted"
    | "condition_status_changed"
    | "condition_removed"
    | "condition_resurfaced"
    | "condition_refined"
    | "support_contribution_added"
    | "support_recommendation_dismissed"
    | "form_generated"
    | "form_locked"
    | "phase_transitioned";

interface AuditEvent {
    id: string;
    incidentId: string;
    type: AuditEventType;
    timestamp: string;
    actor: { role: ActingRole; userId: string } | "system";
    payload: Record<string, unknown>;                // event-specific shape
}
```

Pydantic models on the backend mirror these.

### D2. Endpoint shape — **Locked: Option A**

`POST /api/incidents/{id}/validate-iap` returning batch JSON. Clear separation from `/chat`; structured response rather than free-text streaming.

Companion endpoints in scope for the prototype:
- `POST /api/incidents` — create new incident.
- `GET /api/incidents` — list incidents (used by the post-demo IMT dashboard scaffolding).
- `GET /api/incidents/{id}` — fetch current state.
- `POST /api/incidents/{id}/loss-stop` — phase transition.
- `DELETE /api/incidents/{id}/conditions/{conditionId}` — Fire Officer curation (mark removed; sticky-with-resurfacing-on-new-evidence).
- `POST /api/incidents/{id}/conditions/{conditionId}/refine` — generate 3 narrowing statements (D7).
- `POST /api/incidents/{id}/conditions/{conditionId}/refine/apply` — apply a selected narrowing statement.

### D3. Extraction prompt location — **Locked: Option A**

`app/backend/prompts/extraction/fire_officer_validate_iap.md` — Markdown content, loaded by a dedicated extractor at request time. Parallel to the future `app/backend/prompts/personas/` directory from `docs/persona_prompts_plan.md`. The extraction prompt explicitly instructs the LLM to:

- Distinguish observed conditions from taken actions.
- Assess life-risk severity for any deviation from KB guidance.
- Honor previously-removed conditions (don't re-extract unless new transcript evidence post-removal supports them).
- Produce structured output matching the Pydantic models.

A second extraction prompt — `app/backend/prompts/extraction/refine_condition.md` — generates the 3 narrowing statements for D7.

### D4. Sample transcript fixtures — **Locked**

Three synthetic transcripts to seed development:

1. A clean "following plan" case — most items conforming (green).
2. A mixed case — some items deviating-safe (yellow).
3. A case with a life-risk deviation — at least one item deviating-unsafe (red), exercising the highest-stakes prompt-engineering scenario.

Stored in `app/backend/fixtures/transcripts/`. Composed from the SCES (SpacelySprockets) SOG documents already in `data/SpacelySprockets/` — gives the LLM plausible KB matches to reason against. Replaced/augmented with SME-provided real transcripts when those arrive.

### D5. Cosmos schema for incident records — **Locked**

Container name: `incidents`. Aligned with the BACKLOG's existing event/incident model.

Document shape (illustrative, not the final Pydantic):

```typescript
interface IncidentDocument {
    id: string;                              // partition key
    tenantId: string;                        // placeholder for multi-tenant; "default" in v1
    phase: IncidentPhase;
    createdBy: { role: ActingRole; userId: string };
    createdAt: string;
    lossStoppedAt: string | null;
    closedAt: string | null;
    transcript: TranscriptChunk[];           // append-only
    sceneSummary: SceneSummary;
    sceneConditionsAndActions: SceneConditionAndAction[];   // current state; full event log separate
    supportContributions: SupportContribution[];
    forms: FormSummary[];
    eventLog: AuditEvent[];                  // append-only; source of truth for state changes
}

interface TranscriptChunk {
    chunkId: string;
    timestamp: string;
    text: string;                            // raw text; de-noised version derived
    deNoised: string | null;
}
```

### D6. Routing — kiosk vs chat — **Locked**

In `IndexRouter.tsx`:
- `actingRole === "fire-officer"` and no incident in URL → kiosk's Start Incident screen.
- `actingRole === "fire-officer"` and active incident → in-incident kiosk dashboard.
- Any other role → existing chat as today. (Post-demo: switch to the incident-list dashboard for IMT/admin roles.)

### D7. Refine Condition affordance — **Locked**

Per-condition button beside the traffic-light icon on each Scene Conditions and Actions row. Optional, push-button only (kiosk-friendly):

1. User clicks **Refine Condition**.
2. Backend generates 3 narrowing statements from the KB (reuses the existing "suggest 3 follow-up questions" pattern in the chat backend); frontend displays them plus a "None of the above" option.
3. User selects one statement (or "None of the above").
4. Backend re-evaluates the condition against the narrowed context; status icon updates if conformance changes.
5. Refinement event recorded in the audit log per immutability principle.

The SME's view: there should never be a scenario where the KB has nothing applicable; if the initial match is imperfect, refinement narrows it. This replaces the original "no plan documented" red-X concept — the icons now strictly encode KB-conformance + life-risk severity, and the refine affordance is the user's tool for scoping when fit is imperfect.

## Files involved

### Backend

- New: `app/backend/approaches/validate_iap.py` — approach class; transcript in, structured response out. Honors removed-condition state when re-extracting (instructs LLM via prompt context block).
- New: `app/backend/approaches/refine_condition.py` — generates the 3 narrowing statements for D7 and re-evaluates a condition after a refinement is applied.
- New: `app/backend/prompts/extraction/fire_officer_validate_iap.md` (per D3) — the extraction prompt body.
- New: `app/backend/prompts/extraction/refine_condition.md` (per D3) — the narrowing-statement generation prompt.
- New / extend: `app/backend/app.py` — endpoints per D2: `/api/incidents`, `/api/incidents/{id}`, `/api/incidents/{id}/validate-iap`, `/api/incidents/{id}/loss-stop`, `/api/incidents/{id}/conditions/{conditionId}` (DELETE for removal), `/api/incidents/{id}/conditions/{conditionId}/refine` and `.../refine/apply`.
- New: Pydantic models for the request/response contract — `app/backend/models/incidents.py` (mirrors the TypeScript interfaces in D1).
- New: `app/backend/incidents/` module — Cosmos persistence for incident records (per D5). Mirrors the existing `app/backend/chat_history/cosmosdb.py` pattern. Includes the append-only `eventLog[]` write path.
- New: `app/backend/fixtures/transcripts/` — three synthetic transcripts (per D4).

### Frontend

- New: `app/frontend/src/pages/incidentKiosk/IncidentKiosk.tsx` — Fire Officer kiosk page (Start Incident screen + in-incident two-panel view + form tab strip).
- New: `app/frontend/src/pages/incidentKiosk/components/SceneItemRow.tsx` — single Scene Conditions and Actions row with traffic-light icon, item-type badge (Condition vs Action), and Refine Condition button.
- New: `app/frontend/src/pages/incidentKiosk/components/AnalyzePopup.tsx` — popup with publishedPlanContext / clientPlanContext / delta. Citations rendered for support roles only (hidden in Fire Officer kiosk per E).
- New: `app/frontend/src/pages/incidentKiosk/components/RefineConditionPopup.tsx` — popup showing 3 narrowing statements + "None of the above"; submits user selection.
- New: `app/frontend/src/pages/incidentKiosk/components/FormTab.tsx` — generic form tab; renders ICS201Content or PlaceholderFormContent based on discriminator.
- New: `app/frontend/src/pages/incidentKiosk/components/ReValidateButton.tsx` — floating bottom-right "Re-Validate IAP" button.
- New: `app/frontend/src/pages/incidentList/IncidentList.tsx` — stub for Other-roles. Lists incidents grouped by phase; click opens a read-only kiosk view.
- New: `app/frontend/src/api/incidents.ts` — API client functions for create/list/get/validateIAP/lossStop/removeCondition/refineCondition/applyRefinement.
- New: `app/frontend/src/api/incidentTypes.ts` — TypeScript interfaces from D1.
- Edit: `app/frontend/src/pages/IndexRouter.tsx` — routing logic per D6.

### Data / fixtures

- New: `app/backend/fixtures/transcripts/` — sample synthetic transcripts per D4.

## Sessions

### Session 0 — Resolve open decisions ✓ (2026-04-29)

All seven decisions resolved across two SME working sessions. See "Decisions" section above.

### Session 1 — Validate IAP contract + backend prototype ✓ (2026-04-29)

**End state achieved.** All three fixtures POST'd successfully against the deployed Container App; the LLM produced clean structured output:

- Fixture 1 (conforming): 13/13 green, zero false positives — RIT, LACES, 360 size-up, etc. all correctly flagged.
- Fixture 2 (mixed): 9 green + 1 yellow — "vehicle not chocked" surfaced as the deviating-safe item.
- Fixture 3 (life-risk): 12 green + 1 red — "ordered interior attack despite deteriorating conditions and no RIT" flagged. The LLM consolidated two related deviations into one; SME may want fine-grained vs consolidated.

**Notes for prompt-tuning later:** ICS 201 `dateTimeInitiated` got an arbitrary year (2024) because transcripts don't carry one — likely fixable with a server-injected request-time date. Some condition vs action classifications are nitpickable (e.g., "Engine 2 arrived and established RIT" labelled as condition). Both small.

**Switched from `chat.completions.parse()` to `chat.completions.create()` with `json_object` mode** during the session: OpenAI strict structured outputs rejected our schema (Pydantic discriminated union → `oneOf` + `discriminator`, and `default` keywords). Pydantic post-parsing on our side validates the output against the contract. JSON skeleton appended to the extraction prompt to give the LLM the shape.

- Implement Pydantic models in `app/backend/models/incidents.py` matching the D1 contract exactly.
- Wire the `/api/incidents/{id}/validate-iap` endpoint.
- Implement `ValidateIAPApproach` in `app/backend/approaches/validate_iap.py`. Calls the LLM with the extraction prompt and the transcript; parses the structured response. Honors removed-condition state via prompt context block.
- Author the first version of `fire_officer_validate_iap.md` extraction prompt. Production-tone, multi-line directive style. Explicitly instructs the LLM on: condition vs action classification, life-risk severity assessment, sticky-with-resurfacing semantics for previously-removed conditions.
- Seed 3 sample transcripts in `app/backend/fixtures/transcripts/` per D4.
- Manual verification: feed each fixture, eyeball the structured response.

### Session 2 — Fire Officer kiosk page (two-panel UI + form tab strip)

End state: Fire Officer signs in, lands on the kiosk's Start Incident screen; pressing Start Incident loads a fixture transcript and renders the kiosk dashboard — Scene Summary at top, Scene Conditions and Actions panel with traffic-light items, Support Contributions placeholder, ICS 201 tab at the bottom.

- New page `IncidentKiosk.tsx` with two sub-views: pre-incident (Start Incident button only) and in-incident (Scene Summary + Scene Conditions and Actions + Support Contributions + form tab strip + Re-Validate IAP button + Loss Stop button).
- Update `IndexRouter.tsx` per D6.
- Build `SceneItemRow` with traffic-light icon (green check / yellow ! / red X), Condition vs Action badge, and Refine Condition button placeholder.
- Build `AnalyzePopup` showing publishedPlanContext, clientPlanContext, delta. No citations rendered (Fire Officer kiosk).
- Build `ReValidateButton` floating bottom-right.
- Wire to the backend endpoint via `app/frontend/src/api/incidents.ts`.
- Support Contributions panel renders as "No support contributions yet" placeholder.
- Skip persistence in this session — the in-incident state is in-memory only; Loss Stop logic comes next session.

### Session 3 — Start Incident / Loss Stop persistence + curation

End state: Pressing Start Incident creates a real incident record in Cosmos. Loss Stop transitions it to `transition_to_recovery` phase and freezes the live transcript and Response-phase forms. Fire Officer can remove a Scene Conditions and Actions item; Re-Validate honors the removal sticky-with-resurfacing.

- `incidents` Cosmos container per D5. Module under `app/backend/incidents/` for CRUD plus the append-only `eventLog` write path.
- `POST /api/incidents` — create incident (returns incidentId, phase=response, audit event `phase_transitioned` to "response").
- `POST /api/incidents/{id}/loss-stop` — transitions phase, locks Response-phase forms, audit event `phase_transitioned` to "transition_to_recovery".
- `DELETE /api/incidents/{id}/conditions/{conditionId}` — Fire Officer condition removal; audit event `condition_removed`.
- Frontend wires Start Incident → create + persist, Loss Stop → loss-stop endpoint, condition row → remove action.
- Revisit kiosk state to read from the persisted incident on reload (refresh during an incident doesn't lose state).

### Session 4 — ICS 201 tab + form generation + Refine Condition

End state: ICS 201 renders as a tab beside the dashboard, populated as structured data (per D1's `ICS201Content`) from the validated conditions. Locked when Loss Stop is pressed. Refine Condition button on each scene item works end-to-end (3 narrowing statements + None option, selecting one re-evaluates the item).

- Backend generates ICS 201 content from the transcript + conditions on each Validate IAP press.
- `FormTab.tsx` renders ICS 201 using a layout that mimics the real form's named fields. Read-only after Loss Stop.
- Implement `RefineConditionPopup.tsx` and the refine endpoint pair (`/refine` + `/refine/apply`).
- Form lifecycle metadata stored in the incident record — `forms[]` array with `status: active | locked` per D1.

### Session 5 — Stub Other-roles incident dashboard

End state: When an IMT role signs in, they see a list of incidents grouped by phase (Response, Transition to Recovery). Click into one → read-only kiosk view (Scene Summary, Scene Conditions and Actions visible, Support Contributions placeholder, citations rendered in AnalyzePopup since this is a support role).

- New page `IncidentList.tsx` — query `/api/incidents`, group by phase, render entries with ID + datetime + short description.
- Read-only kiosk view reuses the `IncidentKiosk.tsx` components with an `editable={false}` prop or similar; AnalyzePopup citations conditional on actingRole.
- No "join incident" / contribute logic in the prototype — supporting-role write authority is post-demo work.

### Session 6 — Demo polish

End state: SME-ready demo. Sample data covers the three traffic-light states. Error handling is reasonable. UI is presentable.

- Verify all three traffic-light states are visible across the three fixtures (conforming green, deviating-safe yellow, deviating-unsafe red).
- Error states: backend returns 500, transcript is empty, etc. — show user-friendly messages.
- Light styling pass — kiosk should look kiosk-like (large buttons, clear typography, large traffic-light icons); the IMT dashboard should look professional.
- Smoke-test the full flow: sign in → Start Incident → Re-Validate IAP → tap an item → see Analyze popup (no citations) → tap Refine Condition on a yellow item → pick a narrowing statement → see status update → switch to ICS 201 tab → Loss Stop → see locked state. Sign in as IMT, see the incident in the list, open it read-only, tap an item → see Analyze popup with citations rendered.

## Test plan

Per session, manual verification described in the end-state for that session. Cross-cutting checks before declaring the prototype demo-ready:

- Each of the three traffic-light statuses (`conforming` / `deviating_safe` / `deviating_unsafe`) produces the right icon and Analyze content.
- Removal stickiness: removing an item, then pressing Re-Validate, does not resurface it unless new transcript content post-removal supports it. Use the SME's "fire on / fire off / fire back on" scenario as a test case.
- Refine Condition: 3 narrowing statements appear, picking one re-evaluates and may change the icon, "None of the above" is handled gracefully.
- Loss Stop locks the data — refreshing or re-opening shows the locked state, no further Re-Validate IAP affordance.
- An IMT-role sign-in lists the incident and opens it read-only; AnalyzePopup renders citations for them.
- ICS 201 content reflects the latest Re-Validate IAP press up to Loss Stop, then never changes.
- Audit log: every state-changing operation produces an `AuditEvent` entry; the event log is queryable and chronologically ordered.
- No regressions in existing chat flow for IMT/admin roles (chat is still their landing page until the post-demo work shifts them to the incident list).

## Risks and rollback

- **Risk**: LLM extraction quality is below SME's bar — particularly the life-risk severity classification, which is the highest-stakes prompt-engineering call. Mitigation: iterate on the extraction prompt in Session 1 with multiple fixtures before moving to UI work; the deviating-unsafe case is the critical test.
- **Risk**: Removal sticky-with-resurfacing logic produces unexpected results (false resurfacing or false suppression). Mitigation: the SME's "fire on / fire off / fire back on" scenario is committed as a fixture and used as a regression test.
- **Risk**: ICS 201 structured rendering may look awkward in the prototype (form layouts are finicky). Mitigation: a simpler styled-table fallback is acceptable for v1 if a faithful form layout takes too long.
- **Rollback**: every session is additive. The new kiosk routing is gated on `actingRole === "fire-officer"`; reverting that single check disables the prototype path entirely without breaking other flows. Cosmos schema is additive (new container, no migration of existing data).

## After SME demo (post-prototype work, per BACKLOG)

Depending on SME feedback:

- Streaming STT integration.
- Full retrieval cascade (Client > Region > Federal > Domain) per `docs/role_based_retrieval_plan.md`.
- Multi-tenant Entra + tenant filter on every query.
- Persona prompt server-side resolution per `docs/persona_prompts_plan.md` (the validation prompts may also move to that infrastructure).
- The remaining ~11 ICS forms.
- Supporting-role contribution to Support Conditions (chat-in-incident-context, structured contributions, audit-immutable).
- Transition to Recovery phase: per-role checklists from KB, enrichment workflows, role-specific views.
- Recovery phase: government/legal report generation, fully-locked review UI.
