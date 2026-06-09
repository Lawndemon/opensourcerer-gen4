/**
 * IncidentKiosk — the Fire Officer's primary device experience.
 *
 * Pre-incident: single big Start Incident button. In-incident: three vertical panes
 * (Scene Summary → Scene Conditions bullets → Support Contributions) plus Excel-style
 * form tabs at the bottom and a floating Re-Validate IAP button. The user never types —
 * every affordance is a single tap.
 *
 * Persistence (Session 3): Start Incident calls POST /api/incidents. On 503 (Cosmos
 * disabled) the kiosk gracefully falls back to the Session-1 ephemeral flow. Loss Stop
 * and condition removal call the server when persisted; optimistic UI with rollback.
 *
 * Refine Condition (Session 4): tapping the Refine button on a scene item opens a popup
 * that fetches 3 LLM-generated narrowing statements; selecting one re-evaluates the
 * condition server-side and updates the row in place.
 *
 * Live support contributions (Session 5b): during Response (persisted, not locked), the
 * kiosk polls getIncident() every 10s and merges newly-published Support Contributions
 * into state. The Fire Officer doesn't need to press anything to see them.
 */

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Body1, Button, Caption1, Spinner, Subtitle1, Title1, Title3 } from "@fluentui/react-components";
import { ArrowClockwise24Regular, Checkmark24Regular, Stop24Filled } from "@fluentui/react-icons";

import type { IncidentDocument, SceneConditionAndAction, ValidateIAPResponse } from "../../api/incidentTypes";
import {
    createIncident,
    extractForms,
    generatePrototypeIncidentId,
    getIncident,
    IncidentApiError,
    lossStop as lossStopRequest,
    autoPopulateRecommendations,
    removeCondition,
    validateIAP
} from "../../api/incidents";
import { useRole } from "../../roleContext";

import AnalyzePopup from "./AnalyzePopup";
import FormTabStrip from "./FormTabStrip";
import RefineConditionPopup from "./RefineConditionPopup";
import SceneItemRow from "./SceneItemRow";
import RoleBubble from "../../components/RoleBubble";
import { RECOMMENDATION_CATEGORY_LABEL, RECOMMENDATION_CATEGORY_ORDER } from "../../recommendationCategories";
import { CUSTOM_SCENARIO_ID, DEFAULT_SCENARIO_ID, KIOSK_SCENARIOS, accumulatedTranscript, getScenarioById } from "./fixtures";
import styles from "./IncidentKiosk.module.css";

type KioskState =
    | { phase: "pre_incident"; scenarioId: string; customTranscript?: string }
    | { phase: "starting"; scenarioId: string; incidentId: string }
    | {
          phase: "in_incident";
          incidentId: string;
          scenarioId: string;
          // Accumulated transcript: union of scene segments phases[0..currentPhaseIndex].
          transcript: string;
          // Multi-phase (scene segments): the loaded scenario's per-segment chatter and the
          // index of the last segment that has been run. currentPhaseIndex 0 = phase 1 (the
          // segment fed on Start). The "Add Inject" demo button advances this and vanishes
          // once currentPhaseIndex === phases.length - 1.
          phases: string[];
          currentPhaseIndex: number;
          iap: ValidateIAPResponse;
          // True once the FO has pressed "Confirm Scene Conditions" (the trigger that fires
          // forms + AI support recommendations). Flips the floating button to "Re-Validate IAP".
          // An Add Inject also sets this, since injecting implies we're past the initial confirm.
          hasConfirmed: boolean;
          revalidating: boolean;
          locked: boolean;
          persisted: boolean;
          // Transfer of Command (IC content gate): true once an IC has taken command.
          commandTransferred?: boolean;
          // Terminal seal — set when the IC/Admin locks the event from the CloseoutAdmin page.
          eventLocked?: boolean;
          // 5d.1: true while the decoupled extract-forms call is in flight. Never blocks
          // the screen — drives a subtle "Generating forms…" hint on the form tab strip.
          formsGenerating: boolean;
      }
    | { phase: "error"; scenarioId: string; message: string };

function projectDocument(doc: IncidentDocument): ValidateIAPResponse {
    return {
        incidentId: doc.id,
        phase: doc.phase,
        sceneSummary: doc.sceneSummary,
        sceneConditionsAndActions: doc.sceneConditionsAndActions,
        supportContributions: doc.supportContributions,
        forms: doc.forms
    };
}

const IncidentKiosk = () => {
    const { actingRole } = useRole();
    const [state, setState] = useState<KioskState>({ phase: "pre_incident", scenarioId: DEFAULT_SCENARIO_ID });
    const [analyzeItem, setAnalyzeItem] = useState<SceneConditionAndAction | null>(null);
    const [refineItem, setRefineItem] = useState<SceneConditionAndAction | null>(null);

    const showCitations = actingRole !== "fire-officer";

    // --- Live support-contribution poll (Session 5b) ---------------------------
    // While the Fire Officer is in-incident, persisted, and not locked, poll
    // getIncident() every 10s and merge new Support Contributions into state.
    const pollIncidentId = state.phase === "in_incident" ? state.incidentId : null;
    const pollPersisted = state.phase === "in_incident" ? state.persisted : false;
    const pollLocked = state.phase === "in_incident" ? state.locked : true;
    // Adaptive cadence: poll faster once command is transferred (the IC approval loop benefits
    // from prompt kiosk updates); back off to the slower rate otherwise to limit load.
    const pollCommandTransferred = state.phase === "in_incident" ? (state.commandTransferred ?? false) : false;
    const kioskPollMs = pollCommandTransferred ? 3_000 : 10_000;
    useEffect(() => {
        if (!pollIncidentId || !pollPersisted || pollLocked) return;
        const incidentId = pollIncidentId;
        let cancelled = false;
        const tick = async () => {
            try {
                const fresh = await getIncident(incidentId);
                if (cancelled) return;
                setState(prev => {
                    if (prev.phase !== "in_incident") return prev;
                    if (prev.incidentId !== incidentId) return prev;
                    const b = fresh.supportContributions;
                    const freshCommand = fresh.commandTransferredAt != null;
                    // Sync scene fields too (not just contributions): an auto Re-Validate must
                    // surface on the FO kiosk. Signature guard avoids needless re-renders when
                    // nothing the kiosk shows has moved.
                    const prevSig = JSON.stringify([
                        prev.commandTransferred ?? false,
                        prev.eventLocked ?? false,
                        prev.iap.sceneSummary.lastUpdated,
                        prev.iap.sceneConditionsAndActions.map(c => [c.id, c.status, c.removed]),
                        prev.iap.supportContributions.map(c => [c.id, c.icStatus])
                    ]);
                    const freshSig = JSON.stringify([
                        freshCommand,
                        fresh.lockedAt != null,
                        fresh.sceneSummary.lastUpdated,
                        fresh.sceneConditionsAndActions.map(c => [c.id, c.status, c.removed]),
                        fresh.supportContributions.map(c => [c.id, c.icStatus])
                    ]);
                    if (prevSig === freshSig) {
                        return prev;
                    }
                    return {
                        ...prev,
                        commandTransferred: freshCommand,
                        eventLocked: fresh.lockedAt != null,
                        locked: prev.locked || fresh.lockedAt != null,
                        iap: {
                            ...prev.iap,
                            sceneSummary: fresh.sceneSummary,
                            sceneConditionsAndActions: fresh.sceneConditionsAndActions,
                            supportContributions: b
                        }
                    };
                });
            } catch {
                // Silently ignore poll errors — next tick will retry.
            }
        };
        const handle = window.setInterval(tick, kioskPollMs);
        void tick();
        return () => {
            cancelled = true;
            window.clearInterval(handle);
        };
    }, [pollIncidentId, pollPersisted, pollLocked, kioskPollMs]);

    // --- Background forms extraction (5d.1) ------------------------------------
    // Fired AFTER the scene dashboard has rendered. Generates the role-tagged forms off
    // the critical path and merges them in when ready. Failures are non-fatal — the scene
    // dashboard stays fully usable regardless. Functional setState guards against racing
    // with phase changes (Loss Stop, End demo) or a newer incident.
    const triggerFormsExtraction = useCallback(
        async (incidentId: string, transcript: string, iap: ValidateIAPResponse) => {
            setState(prev =>
                prev.phase === "in_incident" && prev.incidentId === incidentId
                    ? { ...prev, formsGenerating: true }
                    : prev
            );
            try {
                const { forms } = await extractForms(incidentId, {
                    actingRole: actingRole ?? "fire-officer",
                    transcript,
                    sceneSummary: iap.sceneSummary,
                    sceneConditionsAndActions: iap.sceneConditionsAndActions
                });
                setState(prev =>
                    prev.phase === "in_incident" && prev.incidentId === incidentId
                        ? { ...prev, iap: { ...prev.iap, forms }, formsGenerating: false }
                        : prev
                );
            } catch {
                // Forms are non-critical. Keep whatever forms are already shown and clear
                // the flag; the next Re-Validate (or a manual retry later) can try again.
                setState(prev =>
                    prev.phase === "in_incident" && prev.incidentId === incidentId
                        ? { ...prev, formsGenerating: false }
                        : prev
                );
            }
        },
        [actingRole]
    );

    const handleStartIncident = useCallback(async () => {
        const currentScenarioId = state.phase === "pre_incident" ? state.scenarioId : DEFAULT_SCENARIO_ID;
        const currentCustom = state.phase === "pre_incident" ? state.customTranscript : undefined;
        // Resolve the scene segments: custom text if the user chose "bring your own" (single
        // segment); otherwise the fixture's phases array.
        let phases: string[];
        if (currentScenarioId === CUSTOM_SCENARIO_ID) {
            if (!currentCustom || currentCustom.trim().length === 0) {
                setState({ phase: "error", scenarioId: currentScenarioId, message: "Custom transcript is empty — paste text or upload a file before starting." });
                return;
            }
            phases = [currentCustom];
        } else {
            const scenario = getScenarioById(currentScenarioId);
            if (!scenario) {
                setState({ phase: "error", scenarioId: currentScenarioId, message: `Unknown scenario: ${currentScenarioId}` });
                return;
            }
            phases = scenario.phases;
        }
        // Start runs scene segment 1 only; later segments accumulate via Run Phase.
        const transcript = accumulatedTranscript(phases, 0);
        const provisionalIncidentId = generatePrototypeIncidentId();
        setState({ phase: "starting", scenarioId: currentScenarioId, incidentId: provisionalIncidentId });
        try {
            try {
                const doc = await createIncident({
                    actingRole: actingRole ?? "fire-officer",
                    transcript
                });
                const docIap = projectDocument(doc);
                setState({
                    phase: "in_incident",
                    incidentId: doc.id,
                    scenarioId: currentScenarioId,
                    transcript,
                    phases,
                    currentPhaseIndex: 0,
                    iap: docIap,
                    hasConfirmed: false,
                    revalidating: false,
                    locked: doc.phase !== "response" || doc.lockedAt != null,
                    persisted: true,
                    commandTransferred: doc.commandTransferredAt != null,
                    eventLocked: doc.lockedAt != null,
                    formsGenerating: false
                });
                // Forms + AI recommendations are NOT generated on Start anymore — they fire when
                // the FO presses "Confirm Scene Conditions" (see handleConfirmSceneConditions).
                return;
            } catch (createErr) {
                if (createErr instanceof IncidentApiError && createErr.status === 503) {
                    // eslint-disable-next-line no-console
                    console.info("Incidents Cosmos disabled (503); using ephemeral kiosk flow.");
                } else {
                    throw createErr;
                }
            }
            const iap = await validateIAP({
                incidentId: provisionalIncidentId,
                transcript,
                actingRole: actingRole ?? "fire-officer"
            });
            setState({
                phase: "in_incident",
                incidentId: provisionalIncidentId,
                scenarioId: currentScenarioId,
                transcript,
                phases,
                currentPhaseIndex: 0,
                iap,
                hasConfirmed: false,
                revalidating: false,
                locked: false,
                persisted: false,
                formsGenerating: false
            });
        } catch (err) {
            setState({ phase: "error", scenarioId: currentScenarioId, message: formatError(err) });
        }
    }, [state, actingRole, triggerFormsExtraction]);

    const handleRevalidate = useCallback(async () => {
        if (state.phase !== "in_incident" || state.locked || state.revalidating) return;
        const previous = state;
        setState({ ...previous, revalidating: true });
        try {
            const iap = await validateIAP({
                incidentId: previous.incidentId,
                transcript: previous.transcript,
                actingRole: actingRole ?? "fire-officer"
            });
            // Keep the previously-generated forms visible during the gap — the background
            // extract-forms call below replaces them when the fresh set is ready, so the
            // tab strip never flickers empty on a Re-Validate.
            // Preserve supportContributions across re-validate. The backend ValidateIAPResponse
            // intentionally returns an empty placeholder list; without this preservation,
            // manual entries and AI items would visually disappear until the next poll tick.
            const merged = {
                ...iap,
                forms: previous.iap.forms,
                supportContributions: previous.iap.supportContributions
            };
            setState({ ...previous, iap: merged, revalidating: false, formsGenerating: true });
            void triggerFormsExtraction(previous.incidentId, previous.transcript, merged);
        } catch (err) {
            setState({
                phase: "error",
                scenarioId: previous.scenarioId,
                message: `Re-Validate failed: ${formatError(err)}`
            });
        }
    }, [state, actingRole, triggerFormsExtraction]);

    // Run Phase N (multi-phase scene segments — demo only). Advances to the next scene
    // segment: appends that segment's new chatter to the accumulated transcript and re-runs
    // Validate against the union. Like Re-Validate, it never blocks the kiosk — the scene
    // renders immediately and forms regenerate in the background. The button graduates and
    // disappears once the final segment has run (see the demo cluster in render). The
    // cross-phase merge — scene items updating in place by stable id rather than duplicating —
    // is the backend's job, via the append-not-replace Validate reconciliation.
    const handleRunPhase = useCallback(async () => {
        if (state.phase !== "in_incident" || state.locked || state.revalidating) return;
        const previous = state;
        if (previous.currentPhaseIndex >= previous.phases.length - 1) return; // already on the last segment
        const nextIndex = previous.currentPhaseIndex + 1;
        const nextTranscript = accumulatedTranscript(previous.phases, nextIndex);
        // Optimistic: advance the segment + accumulated transcript immediately. hasConfirmed
        // flips true here too, so injecting moves the floating button to "Re-Validate IAP".
        setState({ ...previous, transcript: nextTranscript, currentPhaseIndex: nextIndex, hasConfirmed: true, revalidating: true });
        try {
            const iap = await validateIAP({
                incidentId: previous.incidentId,
                transcript: nextTranscript,
                actingRole: actingRole ?? "fire-officer"
            });
            // Preserve forms + support contributions across the pass, exactly like Re-Validate.
            const merged = {
                ...iap,
                forms: previous.iap.forms,
                supportContributions: previous.iap.supportContributions
            };
            setState({
                ...previous,
                transcript: nextTranscript,
                currentPhaseIndex: nextIndex,
                hasConfirmed: true,
                iap: merged,
                revalidating: false,
                formsGenerating: true
            });
            void triggerFormsExtraction(previous.incidentId, nextTranscript, merged);
        } catch (err) {
            setState({
                phase: "error",
                scenarioId: previous.scenarioId,
                message: `Add Inject failed: ${formatError(err)}`
            });
        }
    }, [state, actingRole, triggerFormsExtraction]);

    const handleLossStop = useCallback(async () => {
        if (state.phase !== "in_incident" || state.locked) return;
        const previous = state;
        setState({ ...previous, locked: true });
        if (!previous.persisted) return;
        try {
            await lossStopRequest(previous.incidentId, {
                actingRole: actingRole ?? "fire-officer",
                userId: "kiosk"
            });
        } catch (err) {
            setState({
                phase: "error",
                scenarioId: previous.scenarioId,
                message: `Loss Stop failed: ${formatError(err)}`
            });
        }
    }, [state, actingRole]);

    // Confirm Scene Conditions — the FO's explicit trigger (replaces the removed scene-type
    // confirm). First press fires the downstream AI jobs off the critical path: role-tagged
    // forms + AI support-role recommendations. Flips the floating button to "Re-Validate IAP".
    const handleConfirmSceneConditions = useCallback(async () => {
        if (state.phase !== "in_incident" || state.locked || state.hasConfirmed) return;
        const previous = state;
        // Mark confirmed immediately (kiosk never blocks).
        setState({ ...previous, hasConfirmed: true });
        // Forms generate in the background (off the critical path).
        void triggerFormsExtraction(previous.incidentId, previous.transcript, previous.iap);
        // AI support recommendations only exist for persisted incidents.
        if (!previous.persisted) return;
        void autoPopulateRecommendations(previous.incidentId, {
            actingRole: actingRole ?? "fire-officer",
            userId: "kiosk"
        })
            .then(doc =>
                setState(prev =>
                    prev.phase === "in_incident" && prev.incidentId === doc.id
                        ? { ...prev, iap: { ...prev.iap, supportContributions: doc.supportContributions } }
                        : prev
                )
            )
            .catch(() => {
                /* non-fatal: the 10s incident poll backstops the update */
            });
    }, [state, actingRole, triggerFormsExtraction]);

    const handleRemoveCondition = useCallback(
        async (item: SceneConditionAndAction) => {
            if (state.phase !== "in_incident" || state.locked) return;
            const previous = state;
            const optimisticItems = previous.iap.sceneConditionsAndActions.map(c =>
                c.id === item.id ? { ...c, removed: true } : c
            );
            setState({
                ...previous,
                iap: { ...previous.iap, sceneConditionsAndActions: optimisticItems }
            });
            if (!previous.persisted) return;
            try {
                const doc = await removeCondition(previous.incidentId, item.id, {
                    actingRole: actingRole ?? "fire-officer",
                    userId: "kiosk"
                });
                setState({ ...previous, iap: projectDocument(doc) });
            } catch (err) {
                setState({
                    ...previous,
                    iap: { ...previous.iap, sceneConditionsAndActions: previous.iap.sceneConditionsAndActions }
                });
                // eslint-disable-next-line no-console
                console.error("Remove condition failed:", formatError(err));
            }
        },
        [state, actingRole]
    );

    const handleRefinementApplied = useCallback(
        (updated: SceneConditionAndAction) => {
            if (state.phase !== "in_incident") return;
            const previous = state;
            const mergedItems = previous.iap.sceneConditionsAndActions.map(c =>
                c.id === updated.id ? updated : c
            );
            setState({
                ...previous,
                iap: { ...previous.iap, sceneConditionsAndActions: mergedItems }
            });
        },
        [state]
    );

    const handleReset = useCallback(() => {
        const currentScenarioId = "scenarioId" in state ? state.scenarioId : DEFAULT_SCENARIO_ID;
        setState({ phase: "pre_incident", scenarioId: currentScenarioId });
        setAnalyzeItem(null);
        setRefineItem(null);
    }, [state]);

    const handleScenarioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (state.phase !== "pre_incident") return;
        setState(prev => {
            if (prev.phase !== "pre_incident" && prev.phase !== "error") {
                return { phase: "pre_incident", scenarioId: e.target.value };
            }
            // Preserve customTranscript when toggling between custom and a fixture, so the user
            // doesn't lose pasted text by accidentally clicking another option.
            return { phase: "pre_incident", scenarioId: e.target.value, customTranscript: prev.phase === "pre_incident" ? prev.customTranscript : undefined };
        });
    };

    const handleCustomTranscriptFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const name = file.name.toLowerCase();
        const isBinary = name.endsWith(".pdf") || name.endsWith(".docx");
        const setText = (text: string) =>
            setState(prev => (prev.phase === "pre_incident" ? { ...prev, customTranscript: text } : prev));
        if (isBinary) {
            // Server-side extraction via /api/transcript/extract — pypdf for PDFs, python-docx for .docx.
            try {
                const fd = new FormData();
                fd.append("file", file);
                const res = await fetch("/api/transcript/extract", { method: "POST", body: fd, credentials: "include" });
                if (!res.ok) {
                    const body = await res.text();
                    // eslint-disable-next-line no-alert
                    alert(`Could not extract text from ${file.name}: ${res.status} ${body}`);
                    return;
                }
                const { text } = (await res.json()) as { text: string };
                setText(text);
            } catch (err) {
                // eslint-disable-next-line no-alert
                alert(`Could not extract text from ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
        // Text-based formats (txt, md, xml, json) — read client-side; no backend round-trip.
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === "string" ? reader.result : "";
            setText(text);
        };
        reader.readAsText(file);
    };

    if (state.phase === "starting") {
        return (
            <div className={styles.container}>
                <div className={styles.loadingPanel}>
                    <Spinner size="large" />
                    <Body1>Validating IAP — extracting Scene Conditions and Actions from the transcript…</Body1>
                    <span className={styles.incidentId}>{state.incidentId}</span>
                </div>
            </div>
        );
    }

    if (state.phase === "in_incident") {
        const { iap, incidentId, locked, revalidating, formsGenerating, hasConfirmed, commandTransferred, eventLocked, phases, currentPhaseIndex } = state;
        const hasMorePhases = currentPhaseIndex < phases.length - 1;
        const items = iap.sceneConditionsAndActions;

        return (
            <div className={styles.container}>
                <div className={styles.inIncident}>
                    <div className={styles.incidentHeaderRow}>
                        <div className={styles.incidentMetadata}>
                            <Caption1 className={styles.headerLabel}>Incident</Caption1>
                            <span className={styles.incidentId}>
                                {incidentId} · phase: {locked ? "transition_to_recovery" : iap.phase}
                            </span>
                        </div>
                        <div className={styles.headerActions}>
                            {!locked && (
                                <Button
                                    appearance="primary"
                                    icon={<Stop24Filled />}
                                    onClick={handleLossStop}
                                    className={styles.lossStopButton}
                                >
                                    Loss Stop
                                </Button>
                            )}
                            {locked && (
                                <span className={styles.lockedBadge}>{eventLocked ? "EVENT LOCKED" : "LOCKED — Transition to Recovery"}</span>
                            )}
                        </div>
                    </div>

                    <div
                        style={{
                            padding: "4px 2px 8px",
                            fontWeight: 600,
                            fontSize: "0.85rem",
                            color: commandTransferred ? "#B58B00" : "#555"
                        }}
                    >
                        {commandTransferred ? "Transfer of Command Initiated" : "Fire Officer in Charge"}
                    </div>
                    {eventLocked && (
                        <div
                            style={{
                                padding: "8px 12px",
                                margin: "0 0 8px",
                                borderRadius: 6,
                                background: "#FDECEA",
                                border: "1px solid #C62828",
                                color: "#7A1F1A",
                                fontWeight: 600
                            }}
                        >
                            🔒 Event Locked — this incident has been sealed for the official record. No further changes.
                        </div>
                    )}

                    <section className={`${styles.pane} ${styles.summaryPane}`}>
                        <div className={styles.paneHeader}>
                            <Caption1 className={styles.panelHeading}>Scene Summary</Caption1>
                        </div>
                        <Body1 className={styles.summaryText}>{iap.sceneSummary.text}</Body1>
                    </section>

                    <section className={`${styles.pane} ${styles.supportPane}`}>
                        <div className={styles.paneHeader}>
                            <Title3>Support Contributions</Title3>
                            <Caption1 className={styles.panelSubheading}>
                                Added by support roles from their pages
                            </Caption1>
                        </div>
                        {iap.supportContributions.filter(c => !c.withdrawn && (c.icStatus === "not_gated" || c.icStatus === "approved" || c.icStatus === "safety_bypass")).length === 0 ? (
                            <Body1 className={styles.empty}>
                                {commandTransferred ? "No IC-approved contributions yet." : "No support contributions yet."}
                            </Body1>
                        ) : (
                            <div className={styles.supportGroups}>
                                {[...RECOMMENDATION_CATEGORY_ORDER, null].map(cat => {
                                    const group = iap.supportContributions.filter(c => !c.withdrawn && (c.icStatus === "not_gated" || c.icStatus === "approved" || c.icStatus === "safety_bypass") && (c.category ?? null) === cat);
                                    if (group.length === 0) return null;
                                    const heading = cat ? RECOMMENDATION_CATEGORY_LABEL[cat] : "Other";
                                    return (
                                        <div key={heading} className={styles.supportGroup}>
                                            <Caption1 className={styles.supportGroupHeading}>{heading}</Caption1>
                                            <ul className={styles.supportList}>
                                                {group.map(c => (
                                                    <li key={c.id} className={styles.supportItem}>
                                                        <RoleBubble role={c.addedBy.role} suffix={c.provenance === "ai" ? "AI" : "HIC"} />
                                                        <Body1 className={styles.supportText}>{c.text}</Body1>
                                                        {c.icStatus === "safety_bypass" && (
                                                            <span style={{ marginLeft: 6, fontSize: "0.7rem", fontWeight: 700, color: "#C62828" }}>⚑ SAFETY</span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className={`${styles.pane} ${styles.scenePane}`}>
                        <div className={styles.paneHeader}>
                            <Title3>Scene Conditions</Title3>
                            <Caption1 className={styles.panelSubheading}>
                                From transcript · compared to published IAP
                            </Caption1>
                        </div>
                        {items.length === 0 ? (
                            <Body1 className={styles.empty}>
                                No conditions extracted yet. Press Re-Validate IAP after more transcript arrives.
                            </Body1>
                        ) : (
                            <div className={styles.itemList}>
                                {items.map(item => (
                                    <SceneItemRow
                                        key={item.id}
                                        item={item}
                                        onAnalyze={setAnalyzeItem}
                                        onRemove={locked ? undefined : handleRemoveCondition}
                                        onRefineClick={
                                            locked || !state.persisted ? undefined : setRefineItem
                                        }
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    <FormTabStrip
                        forms={iap.forms}
                        currentRole="fire-officer"
                        locked={locked}
                        generating={formsGenerating}
                    />
                </div>

                {!locked && !hasConfirmed && (
                    <Button
                        appearance="primary"
                        size="large"
                        icon={<Checkmark24Regular />}
                        onClick={handleConfirmSceneConditions}
                        className={styles.revalidateButton}
                    >
                        Confirm Scene Conditions
                    </Button>
                )}
                {!locked && hasConfirmed && (
                    <Button
                        appearance="primary"
                        size="large"
                        icon={revalidating ? <Spinner size="tiny" /> : <ArrowClockwise24Regular />}
                        onClick={handleRevalidate}
                        disabled={revalidating}
                        className={styles.revalidateButton}
                    >
                        {revalidating ? "Re-Validating…" : "Re-Validate IAP"}
                    </Button>
                )}

                {/* Demo-only controls — deliberately a DISTINCT floating cluster, kept apart from
                    the real app controls (Loss Stop in the header, Re-Validate bottom-right) so the
                    production UI isn't polluted with demo affordances and they can be removed as a
                    unit once streaming STT lands. The "Add Inject" scene-segment button lives here. */}
                <div className={styles.demoControls}>
                    <Caption1 className={styles.demoLabel}>DEMO</Caption1>
                    {!locked && hasMorePhases && (
                        <Button
                            appearance="primary"
                            size="small"
                            icon={revalidating ? <Spinner size="tiny" /> : undefined}
                            onClick={handleRunPhase}
                            disabled={revalidating}
                        >
                            {revalidating ? "Running…" : "Add Inject"}
                        </Button>
                    )}
                    <Button appearance="subtle" size="small" onClick={handleReset}>
                        End demo
                    </Button>
                </div>

                <AnalyzePopup
                    item={analyzeItem}
                    showCitations={showCitations}
                    onClose={() => setAnalyzeItem(null)}
                />

                <RefineConditionPopup
                    condition={refineItem}
                    incidentId={incidentId}
                    actingRole={actingRole ?? "fire-officer"}
                    onApplied={handleRefinementApplied}
                    onClose={() => setRefineItem(null)}
                />
            </div>
        );
    }

    if (state.phase === "error") {
        return (
            <div className={styles.container}>
                <div className={styles.preIncident}>
                    <Title1>Something went wrong</Title1>
                    <div className={styles.errorPanel}>{state.message}</div>
                    <Button appearance="primary" onClick={handleReset}>
                        Back to Start Incident
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.preIncident}>
                <Title1 className={styles.preIncidentTitle}>Fire Officer</Title1>
                <Subtitle1 className={styles.preIncidentSubtitle}>
                    Press the button below when you arrive on scene to begin capturing the radio transcript and validating
                    actions against the published Incident Action Plan.
                </Subtitle1>

                <div className={styles.scenarioPicker}>
                    <span className={styles.scenarioPickerLabel}>Demo scenario (prototype only)</span>
                    <select value={state.scenarioId} onChange={handleScenarioChange}>
                        {KIOSK_SCENARIOS.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.label}
                            </option>
                        ))}
                        <option value={CUSTOM_SCENARIO_ID}>Bring your own transcript…</option>
                    </select>
                    {state.scenarioId === CUSTOM_SCENARIO_ID ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                            <input type="file" accept=".txt,.md,.xml,.json,.pdf,.docx,text/plain,application/json,text/xml,application/xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleCustomTranscriptFile} />
                            <textarea
                                style={{ width: "100%", minHeight: 160, fontFamily: "monospace", fontSize: "0.85rem", padding: 8, boxSizing: "border-box" }}
                                value={state.phase === "pre_incident" ? (state.customTranscript ?? "") : ""}
                                onChange={e => setState(prev => prev.phase === "pre_incident" ? { ...prev, customTranscript: e.target.value } : prev)}
                                placeholder="Paste your transcript here (or upload a .txt file above)"
                            />
                        </div>
                    ) : (
                        <span className={styles.scenarioBlurb}>{getScenarioById(state.scenarioId)?.blurb}</span>
                    )}
                </div>

                <Button
                    appearance="primary"
                    size="large"
                    className={styles.startButton}
                    onClick={handleStartIncident}
                >
                    Start Incident
                </Button>
            </div>
        </div>
    );
};

function formatError(err: unknown): string {
    if (err instanceof IncidentApiError) {
        const bodyExtract =
            err.body == null
                ? ""
                : ` — ${typeof err.body === "string" ? err.body : JSON.stringify(err.body).slice(0, 300)}`;
        return `${err.message}${bodyExtract}`;
    }
    if (err instanceof Error) {
        return err.message;
    }
    return "Unexpected error contacting the backend.";
}

export default IncidentKiosk;
// (multi-phase scene segments wired 2026-06-04)
