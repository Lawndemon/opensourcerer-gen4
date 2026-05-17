/**
 * IncidentList — IMT / support-role landing page (Session 5).
 *
 * Lists incidents in the user's tenant, grouped by phase:
 *   - Response (live)         — Fire Officer is on scene, transcript building, IMT can monitor
 *   - Transition to Recovery  — Loss Stop pressed; supporting roles take over enrichment + reports
 *
 * Clicking an incident opens a read-only view of the kiosk dashboard (Scene Summary,
 * Scene Conditions, Support Contributions, ICS form tabs) — IMT roles can see what the
 * Fire Officer is doing but cannot mutate it. AnalyzePopup renders citations for support
 * roles per the MAD framework rules.
 *
 * In v1 the list is a single-page in-memory state machine — no react-router. When list
 * volume grows or we add deep-linking we'll switch to a real route.
 */

import { useEffect, useState } from "react";
import { Body1, Button, Caption1, Spinner, Subtitle1, Title2 } from "@fluentui/react-components";

import type { IncidentDocument, IncidentPhase } from "../../api/incidentTypes";
import { IncidentApiError, listIncidents } from "../../api/incidents";

import IncidentSupportView from "./IncidentSupportView";
import styles from "./IncidentList.module.css";

type ListState =
    | { kind: "loading" }
    | { kind: "loaded"; incidents: IncidentDocument[] }
    | { kind: "error"; message: string };

const PHASE_GROUPS: { phase: IncidentPhase; label: string; subtitle: string }[] = [
    {
        phase: "response",
        label: "Response (live)",
        subtitle: "Fire Officer is on scene — Scene Conditions update with each Re-Validate IAP."
    },
    {
        phase: "transition_to_recovery",
        label: "Transition to Recovery",
        subtitle: "Loss Stop pressed — supporting roles enriching reports and forms."
    }
];

function formatTimestamp(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function shortDescription(doc: IncidentDocument): string {
    const summary = doc.sceneSummary?.text?.trim();
    if (summary) {
        // Cap to ~140 chars so the card stays compact.
        return summary.length > 140 ? `${summary.slice(0, 137)}…` : summary;
    }
    return "No scene summary yet.";
}

function formatError(err: unknown): string {
    if (err instanceof IncidentApiError) {
        if (err.status === 503) {
            return "Incidents persistence is not enabled on this deployment. Ask an administrator to flip USE_CHAT_HISTORY_COSMOS and redeploy.";
        }
        return err.message;
    }
    if (err instanceof Error) return err.message;
    return "Unexpected error contacting the backend.";
}

const IncidentList = () => {
    const [state, setState] = useState<ListState>({ kind: "loading" });
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setState({ kind: "loading" });
        listIncidents()
            .then(incidents => {
                if (cancelled) return;
                setState({ kind: "loaded", incidents });
            })
            .catch(err => {
                if (cancelled) return;
                setState({ kind: "error", message: formatError(err) });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Detail view — render the support-role view for the selected incident.
    if (selectedId && state.kind === "loaded") {
        const incident = state.incidents.find(i => i.id === selectedId);
        if (incident) {
            return <IncidentSupportView incident={incident} onBack={() => setSelectedId(null)} />;
        }
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Title2 className={styles.title}>Incidents</Title2>
                <Subtitle1 className={styles.subtitle}>
                    Active and recently-transitioned incidents in your tenant. Click one to open
                    a read-only view of the Fire Officer's dashboard.
                </Subtitle1>
            </header>

            {state.kind === "loading" && (
                <div className={styles.center}>
                    <Spinner size="medium" />
                    <Body1 className={styles.muted}>Loading incidents…</Body1>
                </div>
            )}

            {state.kind === "error" && (
                <div className={styles.errorPanel}>
                    Failed to load incidents: {state.message}
                </div>
            )}

            {state.kind === "loaded" && state.incidents.length === 0 && (
                <div className={styles.emptyAll}>
                    <Body1>No incidents in your tenant yet.</Body1>
                    <Caption1 className={styles.muted}>
                        Incidents appear here when a Fire Officer presses Start Incident.
                    </Caption1>
                </div>
            )}

            {state.kind === "loaded" && state.incidents.length > 0 && (
                <div className={styles.groups}>
                    {PHASE_GROUPS.map(group => {
                        const groupIncidents = state.incidents.filter(i => i.phase === group.phase);
                        return (
                            <section key={group.phase} className={styles.group}>
                                <div className={styles.groupHeader}>
                                    <h3 className={styles.groupLabel}>
                                        {group.label}
                                        <span className={styles.groupCount}>{groupIncidents.length}</span>
                                    </h3>
                                    <Caption1 className={styles.muted}>{group.subtitle}</Caption1>
                                </div>
                                {groupIncidents.length === 0 ? (
                                    <Body1 className={styles.empty}>
                                        No incidents in this phase.
                                    </Body1>
                                ) : (
                                    <ul className={styles.cardList}>
                                        {groupIncidents.map(incident => (
                                            <li key={incident.id}>
                                                <button
                                                    type="button"
                                                    className={styles.card}
                                                    onClick={() => setSelectedId(incident.id)}
                                                >
                                                    <div className={styles.cardHeader}>
                                                        <span className={styles.cardId}>{incident.id}</span>
                                                        <span className={styles.cardTime}>
                                                            {formatTimestamp(incident.createdAt)}
                                                        </span>
                                                    </div>
                                                    <Body1 className={styles.cardDesc}>
                                                        {shortDescription(incident)}
                                                    </Body1>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}

            {state.kind === "loaded" && (
                <div className={styles.footer}>
                    <Button
                        appearance="subtle"
                        onClick={() => {
                            setState({ kind: "loading" });
                            listIncidents()
                                .then(incidents => setState({ kind: "loaded", incidents }))
                                .catch(err => setState({ kind: "error", message: formatError(err) }));
                        }}
                    >
                        Refresh
                    </Button>
                </div>
            )}
        </div>
    );
};

export default IncidentList;
