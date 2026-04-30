/**
 * IncidentKiosk — the Fire Officer's primary device experience.
 *
 * Two sub-views:
 *  - Pre-incident: a single big "Start Incident" button. The Fire Officer steps off the truck
 *    and the kiosk shows nothing else. (Plus a small dev-only scenario picker for the demo —
 *    will go away once streaming STT lands and the transcript is built from live radio chatter.)
 *  - In-incident: Scene Summary at the top, Scene Conditions and Actions panel, Support
 *    Contributions placeholder, ICS form tab strip at the bottom, Re-Validate IAP button
 *    floating bottom-right, Loss Stop button somewhere prominent.
 *
 * In iteration 1 of Session 2 the in-incident view is a skeleton — it confirms the API call,
 * shows the Scene Summary, and prints item counts, but the full traffic-light dashboard +
 * AnalyzePopup + form tabs land in iteration 2.
 *
 * See:
 *  - docs/prototype_plan.md → Sessions
 *  - BACKLOG.md → Incident-centric architecture
 */

import { useCallback, useState } from "react";
import { Body1, Button, Spinner, Subtitle1, Title1, Title3 } from "@fluentui/react-components";

import type { ValidateIAPResponse } from "../../api/incidentTypes";
import { generatePrototypeIncidentId, IncidentApiError, validateIAP } from "../../api/incidents";
import { useRole } from "../../roleContext";

import { DEFAULT_SCENARIO_ID, KIOSK_SCENARIOS, getScenarioById } from "./fixtures";
import styles from "./IncidentKiosk.module.css";

type KioskState =
    | { phase: "pre_incident"; scenarioId: string }
    | { phase: "starting"; scenarioId: string; incidentId: string }
    | { phase: "in_incident"; incidentId: string; scenarioId: string; iap: ValidateIAPResponse }
    | { phase: "error"; scenarioId: string; message: string };

const IncidentKiosk = () => {
    const { actingRole } = useRole();
    const [state, setState] = useState<KioskState>({ phase: "pre_incident", scenarioId: DEFAULT_SCENARIO_ID });

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
            setState({ phase: "in_incident", incidentId, scenarioId: currentScenarioId, iap });
        } catch (err) {
            const message =
                err instanceof IncidentApiError
                    ? `${err.message}${err.body ? ` — ${typeof err.body === "string" ? err.body : JSON.stringify(err.body).slice(0, 300)}` : ""}`
                    : err instanceof Error
                      ? err.message
                      : "Unexpected error contacting the backend.";
            setState({ phase: "error", scenarioId: currentScenarioId, message });
        }
    }, [state, actingRole]);

    const handleReset = useCallback(() => {
        const currentScenarioId =
            "scenarioId" in state ? state.scenarioId : DEFAULT_SCENARIO_ID;
        setState({ phase: "pre_incident", scenarioId: currentScenarioId });
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
        const { iap, incidentId } = state;
        const counts = iap.sceneConditionsAndActions.reduce(
            (acc, item) => {
                acc[item.status] = (acc[item.status] ?? 0) + 1;
                return acc;
            },
            { conforming: 0, deviating_safe: 0, deviating_unsafe: 0 } as Record<string, number>
        );

        return (
            <div className={styles.container}>
                <div className={styles.inIncident}>
                    <div className={styles.incidentHeaderRow}>
                        <div className={styles.incidentMetadata}>
                            <Title3>Scene Summary</Title3>
                            <span className={styles.incidentId}>{incidentId} · phase: {iap.phase}</span>
                        </div>
                        <Button onClick={handleReset}>End demo</Button>
                    </div>
                    <Body1>{iap.sceneSummary.text}</Body1>

                    <div className={styles.placeholderPanel}>
                        <div>
                            <Title3>Scene Conditions and Actions ({iap.sceneConditionsAndActions.length} items)</Title3>
                            <Body1>
                                Green: {counts.conforming} &middot; Yellow: {counts.deviating_safe} &middot; Red: {counts.deviating_unsafe}
                            </Body1>
                            <Body1 style={{ marginTop: 16, opacity: 0.6 }}>
                                Iteration 1 skeleton. Full traffic-light list, Analyze popup, Refine Condition button,
                                Support Contributions panel, ICS form tabs, and Re-Validate IAP button arrive in iteration 2.
                            </Body1>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (state.phase === "error") {
        return (
            <div className={styles.container}>
                <div className={styles.preIncident}>
                    <Title1>Something went wrong</Title1>
                    <div className={styles.errorPanel}>{state.message}</div>
                    <Button appearance="primary" onClick={handleReset}>Back to Start Incident</Button>
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
                            <option key={s.id} value={s.id}>{s.label}</option>
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

export default IncidentKiosk;
