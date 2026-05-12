/**
 * IncidentKiosk — the Fire Officer's primary device experience.
 *
 * Two sub-views:
 *  - Pre-incident: a single big "Start Incident" button. The Fire Officer steps off the truck
 *    and the kiosk shows nothing else. (Plus a small dev-only scenario picker for the demo —
 *    will go away once streaming STT lands and the transcript is built from live radio chatter.)
 *  - In-incident: three-panel dashboard per BACKLOG.md → Validate IAP output structure:
 *      1. Scene Summary at top (transcript-derived, max ~3 lines).
 *      2. Scene Conditions and Actions panel (MAD-Monitor traffic-light list).
 *      3. Support Contributions panel (placeholder — supporting roles can't write in this
 *         iteration; full curation workflow comes later).
 *    Plus an ICS form tab strip at the bottom, a floating Re-Validate IAP button bottom-right,
 *    and a Loss Stop button in the header.
 *
 * Session 2 iteration 2 scope (this commit):
 *  - All UI elements are real (traffic-light rows, AnalyzePopup, form tabs, Re-Validate, Loss Stop).
 *  - Re-Validate IAP re-calls the backend with the same fixture transcript end-to-end. Output is
 *    identical until streaming STT lands and the transcript can grow.
 *  - Loss Stop transitions the kiosk to a local "locked" view (read-only, no Re-Validate, forms
 *    show locked badge). Real persistence + audit log are Session 3.
 *  - Refine Condition button is a placeholder (disabled with tooltip). Wired up in Session 4.
 *
 * See:
 *  - docs/prototype_plan.md → Sessions
 *  - BACKLOG.md → Incident-centric architecture
 */

import { useCallback, useState } from "react";
import { Body1, Button, Caption1, Spinner, Subtitle1, Title1, Title3 } from "@fluentui/react-components";
import { ArrowClockwise24Regular, Stop24Filled } from "@fluentui/react-icons";

import type { SceneConditionAndAction, ValidateIAPResponse } from "../../api/incidentTypes";
import { generatePrototypeIncidentId, IncidentApiError, validateIAP } from "../../api/incidents";
import { useRole } from "../../roleContext";

import AnalyzePopup from "./AnalyzePopup";
import FormTabStrip from "./FormTabStrip";
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
          /** Local-only flag — Loss Stop has been pressed. Session 3 will persist this server-side. */
          locked: boolean;
      }
    | { phase: "error"; scenarioId: string; message: string };

const IncidentKiosk = () => {
    const { actingRole } = useRole();
    const [state, setState] = useState<KioskState>({ phase: "pre_incident", scenarioId: DEFAULT_SCENARIO_ID });
    const [analyzeItem, setAnalyzeItem] = useState<SceneConditionAndAction | null>(null);

    // Citations are hidden in the Fire Officer kiosk per the MAD framework's
    // simplicity-under-chaos directive. Support roles see them when they open the
    // same dashboard read-only (Session 5).
    const showCitations = actingRole !== "fire-officer";

    const handleStartIncident = useCallback(async () => {
        const currentScenarioId = state.phase === "pre_incident" ? state.scenarioId : DEFAULT_SCENARIO_ID;
        const scenario = getScenarioById(currentScenarioId);
        if (!scenario) {
            setState({ phase: "error", scenarioId: currentScenarioId, message: `Unknown scenario: ${currentScenarioId}` });
            return;
        }
        const incidentId = generatePrototypeIncidentId();
        setState({ phase: "starting", scenarioId: currentScenarioId, incidentId });

        try {
            const iap = await validateIAP({
                incidentId,
                transcript: scenario.transcript,
                actingRole: actingRole ?? "fire-officer"
            });
            setState({
                phase: "in_incident",
                incidentId,
                scenarioId: currentScenarioId,
                iap,
                revalidating: false,
                locked: false
            });
        } catch (err) {
            setState({
                phase: "error",
                scenarioId: currentScenarioId,
                message: formatError(err)
            });
        }
    }, [state, actingRole]);

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
            setState({ ...previous, iap, revalidating: false });
        } catch (err) {
            // Stay on the dashboard; surface the error inline so the operator can see what
            // happened without losing the current Validate IAP output.
            setState({
                phase: "error",
                scenarioId: previous.scenarioId,
                message: `Re-Validate failed: ${formatError(err)}`
            });
        }
    }, [state, actingRole]);

    const handleLossStop = useCallback(() => {
        if (state.phase !== "in_incident" || state.locked) return;
        // Session 3 will hit POST /api/incidents/{id}/loss-stop and persist the phase
        // transition. For the prototype we lock the local state so the UI demonstrates the
        // intended behavior end-to-end.
        setState({ ...state, locked: true });
    }, [state]);

    const handleReset = useCallback(() => {
        const currentScenarioId = "scenarioId" in state ? state.scenarioId : DEFAULT_SCENARIO_ID;
        setState({ phase: "pre_incident", scenarioId: currentScenarioId });
        setAnalyzeItem(null);
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
        const { iap, incidentId, locked, revalidating } = state;
        const items = iap.sceneConditionsAndActions;

        return (
            <div className={styles.container}>
                <div className={styles.inIncident}>
                    {/* ----- Header: incident metadata + Loss Stop ----- */}
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

                    {/* ----- Scene Summary panel ----- */}
                    <section className={styles.summaryPanel}>
                        <Caption1 className={styles.panelHeading}>Scene Summary</Caption1>
                        <Body1 className={styles.summaryText}>{iap.sceneSummary.text}</Body1>
                    </section>

                    {/* ----- Scene Conditions and Actions + Support Contributions ----- */}
                    <div className={styles.twoColumn}>
                        <section className={styles.scenePanel}>
                            <div className={styles.panelHeader}>
                                <Title3>Scene Conditions and Actions</Title3>
                                <Caption1 className={styles.panelSubheading}>
                                    Write authority: scene transcript only
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
                                        />
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className={styles.supportPanel}>
                            <div className={styles.panelHeader}>
                                <Title3>Support Contributions</Title3>
                                <Caption1 className={styles.panelSubheading}>
                                    Write authority: supporting roles only
                                </Caption1>
                            </div>
                            {iap.supportContributions.length === 0 ? (
                                <Body1 className={styles.empty}>No support contributions yet.</Body1>
                            ) : (
                                <ul className={styles.supportList}>
                                    {iap.supportContributions.map(c => (
                                        <li key={c.id} className={styles.supportItem}>
                                            <Caption1 className={styles.supportRole}>{c.addedBy.role}</Caption1>
                                            <Body1>{c.text}</Body1>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </div>

                    {/* ----- ICS form tab strip at the bottom ----- */}
                    <FormTabStrip forms={iap.forms} locked={locked} />
                </div>

                {/* ----- Floating Re-Validate IAP button (bottom-right) ----- */}
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

    // Pre-incident view (default)
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
