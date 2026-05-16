/**
 * IncidentReadOnlyView — IMT / support-role view of a single incident (Session 5).
 *
 * Renders the same three-pane structure as the Fire Officer kiosk (Scene Summary →
 * Scene Conditions → Support Contributions) plus the form tab strip, but:
 *  - No Loss Stop, Re-Validate IAP, Refine, or Remove affordances.
 *  - AnalyzePopup shows citations (support roles benefit from source-tracing).
 *  - Form tabs are read-only no matter the incident phase.
 *  - A Back-to-incidents link replaces End demo.
 *
 * Supporting roles will eventually get write authority over Support Contributions
 * (post-demo work); for v1 the panel is read-only on this view too.
 */

import { useState } from "react";
import { Body1, Button, Caption1, Title3 } from "@fluentui/react-components";
import { ArrowLeft24Regular } from "@fluentui/react-icons";

import type { IncidentDocument, SceneConditionAndAction } from "../../api/incidentTypes";

import AnalyzePopup from "../incidentKiosk/AnalyzePopup";
import FormTabStrip from "../incidentKiosk/FormTabStrip";
import SceneItemRow from "../incidentKiosk/SceneItemRow";
import kioskStyles from "../incidentKiosk/IncidentKiosk.module.css";
import styles from "./IncidentReadOnlyView.module.css";

interface IncidentReadOnlyViewProps {
    incident: IncidentDocument;
    onBack: () => void;
}

function formatTimestamp(iso: string | null): string | null {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

const IncidentReadOnlyView = ({ incident, onBack }: IncidentReadOnlyViewProps) => {
    const [analyzeItem, setAnalyzeItem] = useState<SceneConditionAndAction | null>(null);
    const isLocked = incident.phase !== "response";
    const createdAt = formatTimestamp(incident.createdAt);
    const lossStoppedAt = formatTimestamp(incident.lossStoppedAt);

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

                {/* ----- Pane 3: Support Contributions ----- */}
                <section className={`${kioskStyles.pane} ${kioskStyles.supportPane}`}>
                    <div className={kioskStyles.paneHeader}>
                        <Title3>Support Contributions</Title3>
                        <Caption1 className={kioskStyles.panelSubheading}>
                            Write authority: supporting roles (curation UI lands post-demo)
                        </Caption1>
                    </div>
                    {incident.supportContributions.length === 0 ? (
                        <Body1 className={kioskStyles.empty}>No support contributions yet.</Body1>
                    ) : (
                        <ul className={kioskStyles.supportList}>
                            {incident.supportContributions.map(c => (
                                <li key={c.id} className={kioskStyles.supportItem}>
                                    <Caption1 className={kioskStyles.supportRole}>{c.addedBy.role}</Caption1>
                                    <Body1>{c.text}</Body1>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {/* ----- Form tab strip (always locked in IMT view) ----- */}
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

export default IncidentReadOnlyView;
