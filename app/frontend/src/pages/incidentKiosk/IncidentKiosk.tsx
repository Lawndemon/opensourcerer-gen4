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

import { useCallback, useEffect, useState } from "react";
import { Body1, Button, Caption1, Spinner, Subtitle1, Title1, Title3 } from "@fluentui/react-components";
import { ArrowClockwise24Regular, Stop24Filled } from "@fluentui/react-icons";

import type { IncidentDocument, SceneConditionAndAction, ValidateIAPResponse } from "../../api/incidentTypes";
import {
    createIncident,
    extractForms,
    generatePrototypeIncidentId,
    getIncident,
    IncidentApiError,
    lossStop as lossStopRequest,
    removeCondition,
    validateIAP
} from "../../api/incidents";
import { useRole } from "../../roleContext";

import AnalyzePopup from "./AnalyzePopup";
import FormTabStrip from "./FormTabStrip";
import RefineConditionPopup from "./RefineConditionPopup";
import SceneItemRow from "./SceneItemRow";
import { DEFAULT_SCENARIO_ID, KIOSK_SCENARIOS, getScenarioById } from "./fixtures";
import styles from "./IncidentKiosk.module.css";

type KioskState =
    | { phase: "pre_incident"; scenarioId: string }
    | { phase: "starting"; scenarioId: string; incidentId: string }
    | {
          phase: "in_incident";
          incidentId: string;
          scenarioId: string;
          iap: ValidateIAPResponse;
          revalidating: boolean;
          locked: boolean;
          persisted: boolean;
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
                    const a = prev.iap.supportContributions;
                    const b = fresh.supportContributions;
                    if (a.length === b.length && a.every((x, i) => x.id === b[i].id)) {
                        return prev;
                    }
                    return {
                        ...prev,
                        iap: { ...prev.iap, supportContributions: b }
                    };
                });
            } catch {
                // Silently ignore poll errors — next tick will retry.
            }
        };
        const handle = window.setInterval(tick, 10_000);
        void tick();
        return () => {
            cancelled = true;
            window.clearInterval(handle);
        };
    }, [pollIncidentId, pollPersisted, pollLocked]);

    // --- Background forms extraction (5d.1) ------------------------------------
    // Fired AFTER the scene dashboard has rendered. Generates the role-tagged forms off
    // the critical path and merges them in when ready. Failures are non-fatal — the scene
    // dashboard stays fully usable regardless. Functional setState guards against racing
    // with phase changes (Loss Stop, End demo) or a newer incident.
    const triggerFormsExtraction = useCallback(
        async (incidentId: string, scenarioId: string, iap: ValidateIAPResponse) => {
            const scenario = getScenarioById(scenarioId);
            if (!scenario) return;
            setState(prev =>
                prev.phase === "in_incident" && prev.incidentId === incidentId
                    ? { ...prev, formsGenerating: true }
                    : prev
            );
            try {
                const { forms } = await extractForms(incidentId, {
                    actingRole: actingRole ?? "fire-officer",
                    transcript: scenario.transcript,
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
        const scenario = getScenarioById(currentScenarioId);
        if (!scenario) {
            setState({ phase: "error", scenarioId: currentScenarioId, message: `Unknown scenario: ${currentScenarioId}` });
            return;
        }
        const provisionalIncidentId = generatePrototypeIncidentId();
        setState({ phase: "starting", scenarioId: currentScenarioId, incidentId: provisionalIncidentId });
        try {
            try {
                const doc = await createIncident({
                    actingRole: actingRole ?? "fire-officer",
                    transcript: scenario.transcript
                });
                const docIap = projectDocument(doc);
                setState({
                    phase: "in_incident",
                    incidentId: doc.id,
                    scenarioId: currentScenarioId,
                    iap: docIap,
                    revalidating: false,
                    locked: doc.phase !== "response",
                    persisted: true,
                    formsGenerating: true
                });
                // Forms populate in the background; the dashboard is already interactive.
                void triggerFormsExtraction(doc.id, currentScenarioId, docIap);
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
                transcript: scenario.transcript,
                actingRole: actingRole ?? "fire-officer"
            });
            setState({
                phase: "in_incident",
                incidentId: provisionalIncidentId,
                scenarioId: currentScenarioId,
                iap,
                revalidating: false,
                locked: false,
                persisted: false,
                formsGenerating: true
            });
            void triggerFormsExtraction(provisionalIncidentId, currentScenarioId, iap);
        } catch (err) {
            setState({ phase: "error", scenarioId: currentScenarioId, message: formatError(err) });
        }
    }, [state, actingRole, triggerFormsExtraction]);

    const handleRevalidate = useCallback(async () => {
        if (state.phase !== "in_incident" || state.locked || state.revalidating) return;
        const scenario = getScenarioById(state.scenarioId);
        if (!scenario) return;
        const previous = state;
        setState({ ...previous, revalidating: true });
        try {
            const iap = await validateIAP({
                incidentId: previous.incidentId,
                transcript: scenario.transcript,
                actingRole: actingRole ?? "fire-officer"
            });
            // Keep the previously-generated forms visible during the gap — the background
            // extract-forms call below replaces them when the fresh set is ready, so the
            // tab strip never flickers empty on a Re-Validate.
            const merged = { ...iap, forms: previous.iap.forms };
            setState({ ...previous, iap: merged, revalidating: false, formsGenerating: true });
            void triggerFormsExtraction(previous.incidentId, previous.scenarioId, merged);
        } catch (err) {
            setState({
                phase: "error",
                scenarioId: previous.scenarioId,
                message: `Re-Validate failed: ${formatError(err)}`
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
        setState({ phase: "pre_incident", scenarioId: e.target.value });
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
        const { iap, incidentId, locked, revalidating, formsGenerating } = state;
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
                                <span className={styles.lockedBadge}>LOCKED — Transition to Recovery</span>
                            )}
                            <Button appearance="subtle" onClick={handleReset}>
                                End demo
                            </Button>
                        </div>
                    </div>

                    <section className={`${styles.pane} ${styles.summaryPane}`}>
                        <div className={styles.paneHeader}>
                            <Caption1 className={styles.panelHeading}>Scene Summary</Caption1>
                        </div>
                        <Body1 className={styles.summaryText}>{iap.sceneSummary.text}</Body1>
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

                    <section className={`${styles.pane} ${styles.supportPane}`}>
                        <div className={styles.paneHeader}>
                            <Title3>Support Contributions</Title3>
                            <Caption1 className={styles.panelSubheading}>
                                Added by support roles from their pages
                            </Caption1>
                        </div>
                        {iap.supportContributions.length === 0 ? (
                            <Body1 className={styles.empty}>No support contributions yet.</Body1>
                        ) : (
                            <ul className={styles.supportList}>
                                {iap.supportContributions.map(c => (
                                    <li key={c.id} className={styles.supportItem}>
                                        <Body1>
                                            <span className={styles.supportRole}>{c.addedBy.role}</span>
                                            <span className={styles.supportSeparator}> — </span>
                                            {c.text}
                                        </Body1>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <FormTabStrip
                        forms={iap.forms}
                        currentRole="fire-officer"
                        locked={locked}
                        generating={formsGenerating}
                    />
                </div>

                {!locked && (
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
                    </select>
                    <span className={styles.scenarioBlurb}>{getScenarioById(state.scenarioId)?.blurb}</span>
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
