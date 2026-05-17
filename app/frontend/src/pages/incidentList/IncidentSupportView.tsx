/**
 * IncidentSupportView — IMT / support-role view of a single incident (Session 5c, was
 * IncidentReadOnlyView in Session 5).
 *
 * Renders the same three-pane structure as the Fire Officer kiosk (Scene Summary →
 * Scene Conditions → Support Contributions) plus the form tab strip, but:
 *  - No Loss Stop, Re-Validate IAP, Refine, or Remove affordances on the scene.
 *  - AnalyzePopup shows citations (support roles benefit from source-tracing).
 *  - Pane 3 is now the writable RecommendationsPanel — the role's pending working set
 *    plus their already-published and recently-dismissed items, with publish (✓),
 *    dismiss (✕), Refresh, and a custom-add form.
 *  - Form tabs are read-only no matter the incident phase. Per-role tab filtering
 *    lands in 5d.
 *
 * Polling (new in 5c): while the incident is in Response or Transition to Recovery,
 * this view polls getIncident() every 10s. The polled-in incident state feeds the
 * RecommendationsPanel's staleness detection (it hashes scene-items and flips the
 * Refresh button to yellow when the scene moves on after the last refresh).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Body1, Button, Caption1, Title3 } from "@fluentui/react-components";
import { ArrowLeft24Regular } from "@fluentui/react-icons";

import { getIncident } from "../../api/incidents";
import type { IncidentDocument, SceneConditionAndAction } from "../../api/incidentTypes";
import { useRole } from "../../roleContext";

import AnalyzePopup from "../incidentKiosk/AnalyzePopup";
import FormTabStrip from "../incidentKiosk/FormTabStrip";
import SceneItemRow from "../incidentKiosk/SceneItemRow";
import kioskStyles from "../incidentKiosk/IncidentKiosk.module.css";
import RecommendationsPanel from "./RecommendationsPanel";
import styles from "./IncidentSupportView.module.css";

interface IncidentSupportViewProps {
    incident: IncidentDocument;
    onBack: () => void;
}

const POLL_INTERVAL_MS = 10_000;

function formatTimestamp(iso: string | null): string | null {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

const IncidentSupportView = ({ incident: initialIncident, onBack }: IncidentSupportViewProps) => {
    const { actingRole } = useRole();
    const [incident, setIncident] = useState<IncidentDocument>(initialIncident);
    const [analyzeItem, setAnalyzeItem] = useState<SceneConditionAndAction | null>(null);
    // Used by RecommendationsPanel to ping us for an immediate refresh after publish/dismiss.
    const refreshTokenRef = useRef(0);
    const [refreshToken, setRefreshToken] = useState(0);

    const isLocked = incident.phase !== "response";
    const createdAt = formatTimestamp(incident.createdAt);
    const lossStoppedAt = formatTimestamp(incident.lossStoppedAt);

    // --- Polling --------------------------------------------------------------
    // While the incident is in Response or Transition to Recovery, refresh the
    // local incident state every 10s. Recovery is locked so no need to poll.
    useEffect(() => {
        if (incident.phase === "recovery") return;
        const incidentId = incident.id;
        let cancelled = false;
        const tick = async () => {
            try {
                const fresh = await getIncident(incidentId);
                if (cancelled) return;
                setIncident(prev => {
                    if (prev.id !== fresh.id) return prev;
                    return fresh;
                });
            } catch {
                /* Swallow polling errors; next tick retries. The user-visible error
                   surface is the RecommendationsPanel for its own ops. */
            }
        };
        const handle = window.setInterval(tick, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(handle);
        };
        // Re-establish polling if the incident id changes (shouldn't normally — this
        // component is keyed by id higher up, but guard anyway).
    }, [incident.id, incident.phase]);

    // --- Manual refresh trigger ------------------------------------------------
    // RecommendationsPanel calls this after a publish/dismiss so we don't have to
    // wait for the next 10s poll tick to see fresh supportContributions / eventLog.
    const handleIncidentRefresh = useCallback(() => {
        refreshTokenRef.current += 1;
        setRefreshToken(refreshTokenRef.current);
    }, []);

    useEffect(() => {
        if (refreshToken === 0) return;
        let cancelled = false;
        getIncident(incident.id)
            .then(fresh => {
                if (cancelled) return;
                setIncident(fresh);
            })
            .catch(() => {
                /* Silent — next poll tick will retry. */
            });
        return () => {
            cancelled = true;
        };
        // Intentional: we want this to fire only when refreshToken changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshToken]);

    return (
        <div className={kioskStyles.container}>
            <div className={kioskStyles.inIncident}>
                {/* ----- Header: back nav + incident metadata ----- */}
                <div className={kioskStyles.incidentHeaderRow}>
                    <div className={styles.headerLeft}>
                        <Button
                            appearance="subtle"
                            icon={<ArrowLeft24Regular />}
                            onClick={onBack}
                            className={styles.backButton}
                        >
                            Incidents
                        </Button>
                        <div className={kioskStyles.incidentMetadata}>
                            <Caption1 className={kioskStyles.headerLabel}>Incident</Caption1>
                            <span className={kioskStyles.incidentId}>
                                {incident.id} · phase: {incident.phase}
                            </span>
                        </div>
                    </div>
                    <div className={styles.headerMeta}>
                        {createdAt && (
                            <div className={styles.metaItem}>
                                <Caption1 className={kioskStyles.headerLabel}>Created</Caption1>
                                <span>{createdAt}</span>
                            </div>
                        )}
                        {lossStoppedAt && (
                            <div className={styles.metaItem}>
                                <Caption1 className={kioskStyles.headerLabel}>Loss Stop</Caption1>
                                <span>{lossStoppedAt}</span>
                            </div>
                        )}
                        {isLocked && (
                            <span className={kioskStyles.lockedBadge}>
                                LOCKED — {incident.phase === "transition_to_recovery" ? "Transition" : "Closed"}
                            </span>
                        )}
                    </div>
                </div>

                {/* ----- Pane 1: Scene Summary ----- */}
                <section className={`${kioskStyles.pane} ${kioskStyles.summaryPane}`}>
                    <div className={kioskStyles.paneHeader}>
                        <Caption1 className={kioskStyles.panelHeading}>Scene Summary</Caption1>
                    </div>
                    <Body1 className={kioskStyles.summaryText}>{incident.sceneSummary.text}</Body1>
                </section>

                {/* ----- Pane 2: Scene Conditions (read-only) ----- */}
                <section className={`${kioskStyles.pane} ${kioskStyles.scenePane}`}>
                    <div className={kioskStyles.paneHeader}>
                        <Title3>Scene Conditions</Title3>
                        <Caption1 className={kioskStyles.panelSubheading}>
                            Read-only · Fire Officer dashboard mirror
                        </Caption1>
                    </div>
                    {incident.sceneConditionsAndActions.length === 0 ? (
                        <Body1 className={kioskStyles.empty}>No conditions extracted yet.</Body1>
                    ) : (
                        <div className={kioskStyles.itemList}>
                            {incident.sceneConditionsAndActions.map(item => (
                                <SceneItemRow
                                    key={item.id}
                                    item={item}
                                    onAnalyze={setAnalyzeItem}
                                    /* onRemove / onRefineClick intentionally omitted — read-only. */
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* ----- Pane 3: Recommendations + Published + Dismissed ----- */}
                <section className={`${kioskStyles.pane} ${kioskStyles.supportPane}`}>
                    {actingRole ? (
                        <RecommendationsPanel
                            incident={incident}
                            actingRole={actingRole}
                            userId="support-view"
                            onIncidentRefresh={handleIncidentRefresh}
                            locked={isLocked}
                        />
                    ) : (
                        <Body1 className={kioskStyles.empty}>Resolving role…</Body1>
                    )}
                </section>

                {/* ----- Form tab strip (always locked in this view; per-role filter lands in 5d) ----- */}
                <FormTabStrip forms={incident.forms} locked />
            </div>

            {/* Citations rendered for support roles — they trace the published-standard source. */}
            <AnalyzePopup
                item={analyzeItem}
                showCitations
                onClose={() => setAnalyzeItem(null)}
            />
        </div>
    );
};

export default IncidentSupportView;
