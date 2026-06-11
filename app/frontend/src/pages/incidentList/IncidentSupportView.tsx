/**
 * IncidentSupportView — IMT / support-role view of a single incident (Session 5c, was
 * IncidentReadOnlyView in Session 5).
 *
 * Renders the same three-pane structure as the Fire Officer kiosk (Scene Summary →
 * Scene Conditions → Support Contributions) plus the form tab strip, but:
 *  - No Loss Stop, Re-Validate IAP, Refine, or Remove affordances on the scene.
 *  - AnalyzePopup shows citations (support roles benefit from source-tracing).
 *  - Pane 3 is the writable RecommendationsPanel — the role's pending working set plus
 *    their already-published and recently-dismissed items, with publish (✓), dismiss
 *    (✕), Refresh, and a custom-add form.
 *  - Form tabs (5d): filtered to the current acting role's 3 forms via FormTabStrip's
 *    currentRole prop. Read-only no matter the incident phase.
 *  - Update forms / Close Incident actions (5e) in the header.
 *
 * Polling (5c): while the incident is in Response or Transition to Recovery, this view
 * polls getIncident() every 10s. The polled-in incident state feeds RecommendationsPanel's
 * staleness detection (it hashes scene-items and flips the Refresh button to yellow when
 * the scene moves on after the last refresh).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Body1, Button, Caption1, Spinner, Title3 } from "@fluentui/react-components";
import { ArrowLeft24Regular, ArrowSync24Regular, LockClosed24Regular } from "@fluentui/react-icons";

import { assignRoleAction, closeIncident, commentRoleAction, extractForms, getIncident, icDecision, removeCondition, resolveRoleAction, standDownRoleControl, takeRoleControl, transferOfCommand, validateIAP } from "../../api/incidents";
import type { IncidentDocument, SceneConditionAndAction } from "../../api/incidentTypes";
import type { ActingRole } from "../../roles";
import { getRoleDefinition } from "../../roles";
import { activeHicSupportRoles, canTakeControl } from "../../recommendationRouting";
import { useRole } from "../../roleContext";

import AnalyzePopup from "../incidentKiosk/AnalyzePopup";
import RefineConditionPopup from "../incidentKiosk/RefineConditionPopup";
import FormTabStrip from "../incidentKiosk/FormTabStrip";
import SceneItemRow from "../incidentKiosk/SceneItemRow";
import kioskStyles from "../incidentKiosk/IncidentKiosk.module.css";
import RecommendationsPanel from "./RecommendationsPanel";
import CloseoutAdmin from "./CloseoutAdmin";
import styles from "./IncidentSupportView.module.css";

interface IncidentSupportViewProps {
    incident: IncidentDocument;
    onBack: () => void;
}

const POLL_INTERVAL_MS = 10_000;
// Tighter cadence once command is transferred — the IC approval loop benefits from prompt updates.
const FAST_POLL_INTERVAL_MS = 3_000;

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
    const [refineItem, setRefineItem] = useState<SceneConditionAndAction | null>(null);
    const [formsUpdating, setFormsUpdating] = useState(false);
    const [closing, setClosing] = useState(false);
    const [confirmingClose, setConfirmingClose] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [showCloseout, setShowCloseout] = useState(false);
    // Used by RecommendationsPanel to ping us for an immediate refresh after publish/dismiss.
    const refreshTokenRef = useRef(0);
    const [refreshToken, setRefreshToken] = useState(0);
    const [newActionText, setNewActionText] = useState("");
    const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

    const isLocked = incident.phase !== "response";
    const createdAt = formatTimestamp(incident.createdAt);
    const lossStoppedAt = formatTimestamp(incident.lossStoppedAt);

    // Close Incident is available to the Incident Commander + Safety Officer + Site
    // Administrator, only from Transition to Recovery (decision 2026-05-20; IC added
    // 2026-05-21). Backend enforces this too.
    const canClose =
        (actingRole === "incident-commander" ||
            actingRole === "safety-officer" ||
            actingRole === "site-administrator") &&
        incident.phase === "transition_to_recovery";

    // Transfer of Command / IC content gate (one-way v1). Only the Incident Commander sees
    // these controls; once command is transferred the IC gates content to the Fire Officer.
    const isIncidentCommander = actingRole === "incident-commander";
    const commandTransferred = incident.commandTransferredAt != null;
    const pendingForIc = incident.supportContributions.filter(c => c.icStatus === "pending" && !c.withdrawn);
    // IC can only assign a recommendation to a role that a human has actually taken control of
    // (an active HIC support role); never to itself (SME bug batch 2026-06-10).
    const icAssignTargets = activeHicSupportRoles(incident);
    const [tocBusy, setTocBusy] = useState(false);
    const supportPollMs = commandTransferred ? FAST_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    // Closeout / final-lock workflow: IC or Site Administrator can open it anytime.
    const isEventLocked = incident.lockedAt != null;
    const canCloseOut = actingRole === "incident-commander" || actingRole === "site-administrator";
    // Per-role control state + derived application mode (SME 2026-06): Officer (no IC) /
    // Supervisor (IC, all support AI) / Incident (IC + >=1 human-controlled support role).
    const myRoleControl = actingRole ? incident.roleControls.find(rc => rc.role === actingRole) : undefined;
    const iHaveControl = myRoleControl?.controller === "human";
    const humanSupportRoles = incident.roleControls.filter(rc => rc.controller === "human" && rc.role !== "incident-commander");
    const mode = !commandTransferred ? "Officer" : humanSupportRoles.length > 0 ? "Incident" : "Supervisor";
    const modeColor = mode === "Incident" ? "#B58B00" : mode === "Supervisor" ? "#2B6CB0" : "#777";
    const canToggleRoleControl =
        !!actingRole &&
        actingRole !== "incident-commander" &&
        actingRole !== "fire-officer" &&
        actingRole !== "site-administrator" &&
        incident.lockedAt == null;
    // Pre-ToC only the FO-bypass roles (SO, OSC) may be taken over (Dave, 2026-06-11);
    // backend take_control enforces the same rule (403).
    const takeControlAvailable = !!actingRole && canTakeControl(actingRole, incident);
    const myRoleActions = actingRole ? incident.roleActions.filter(a => a.assignedTo === actingRole) : [];
    // IC can refine/remove scene conditions just like the FO does, but only while the scene is
    // open (i.e., before Loss Stop) and the incident isn't event-locked. Backend enforces both.
    const icCanEditScene = actingRole === "incident-commander" && incident.phase === "response" && incident.lockedAt == null;

    const handleRemoveCondition = useCallback(
        async (item: SceneConditionAndAction) => {
            if (!actingRole) return;
            setActionError(null);
            try {
                const updated = await removeCondition(incident.id, item.id, { actingRole, userId: "support-view" });
                setIncident(updated);
            } catch (e) {
                setActionError(e instanceof Error ? e.message : "Could not remove condition.");
            }
        },
        [actingRole, incident.id]
    );

    const handleRefinementApplied = useCallback(() => {
        setRefineItem(null);
        // Trigger a refresh — RecommendationsPanel exposes the manual refresh path we already use.
        refreshTokenRef.current += 1;
        setRefreshToken(refreshTokenRef.current);
    }, []);

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
        const handle = window.setInterval(tick, supportPollMs);
        // Fetch immediately on mount/refresh too — without this, a page load shows the
        // incident object we mounted with and won't pull fresh data (e.g. recs a support role
        // just submitted for IC approval) until the first 10s tick.
        void tick();
        return () => {
            cancelled = true;
            window.clearInterval(handle);
        };
        // Re-establish polling if the incident id changes (shouldn't normally — this
        // component is keyed by id higher up, but guard anyway).
    }, [incident.id, incident.phase, supportPollMs]);

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

    // --- Update forms (5e) -----------------------------------------------------
    // Role-driven, non-blocking regeneration of the incident's forms. The backend reads
    // the authoritative scene + transcript from the persisted incident, so we don't pass
    // them. Mirrors the kiosk's background pattern — never blocks the screen.
    const handleUpdateForms = useCallback(async () => {
        if (!actingRole || formsUpdating) return;
        setFormsUpdating(true);
        setActionError(null);
        try {
            const { forms } = await extractForms(incident.id, { actingRole });
            setIncident(prev => ({ ...prev, forms }));
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Failed to update forms");
        } finally {
            setFormsUpdating(false);
        }
    }, [actingRole, formsUpdating, incident.id]);

    // --- Close incident (5e) ---------------------------------------------------
    // Two-step confirm (no modal) — first click arms, second click commits. On success
    // route back to the list, where the now-recovery incident no longer appears.
    const handleCloseIncident = useCallback(async () => {
        if (!actingRole || closing) return;
        setClosing(true);
        setActionError(null);
        try {
            await closeIncident(incident.id, { actingRole, userId: "support-view" });
            onBack();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Failed to close incident");
            setClosing(false);
            setConfirmingClose(false);
        }
    }, [actingRole, closing, incident.id, onBack]);

    const handleTransferOfCommand = useCallback(async () => {
        if (!actingRole || tocBusy) return;
        setTocBusy(true);
        setActionError(null);
        try {
            const updated = await transferOfCommand(incident.id, { actingRole, userId: "support-view" });
            setIncident(updated);
            // SME 2026-05-27: the backend now re-classifies every existing not_gated contribution
            // (AI + HIC) into the IC pending queue as part of transition_command_to_ic, so the IC
            // sees exactly what was published pre-ToC. No client-side auto-populate needed here.
        } catch (e) {
            setActionError(e instanceof Error ? e.message : "Transfer of Command failed.");
        } finally {
            setTocBusy(false);
        }
    }, [actingRole, tocBusy, incident.id]);

    const handleTakeControl = useCallback(async () => {
        if (!actingRole) return;
        setActionError(null);
        try {
            const updated = await takeRoleControl(incident.id, actingRole, { actingRole, userId: "support-view" });
            setIncident(updated);
        } catch (e) {
            setActionError(e instanceof Error ? e.message : "Could not take control.");
        }
    }, [actingRole, incident.id]);

    const handleStandDown = useCallback(async () => {
        if (!actingRole) return;
        setActionError(null);
        try {
            const updated = await standDownRoleControl(incident.id, actingRole, { actingRole, userId: "support-view" });
            setIncident(updated);
        } catch (e) {
            setActionError(e instanceof Error ? e.message : "Could not stand down.");
        }
    }, [actingRole, incident.id]);

    const handleAddAction = useCallback(async () => {
        if (!actingRole) return;
        const text = newActionText.trim();
        if (!text) return;
        setActionError(null);
        try {
            const updated = await assignRoleAction(incident.id, {
                text,
                assignedTo: actingRole,
                source: "self_assigned",
                actingRole,
                userId: "support-view"
            });
            setIncident(updated);
            setNewActionText("");
        } catch (e) {
            setActionError(e instanceof Error ? e.message : "Could not add action.");
        }
    }, [actingRole, newActionText, incident.id]);

    const handleAddComment = useCallback(
        async (actionId: string) => {
            if (!actingRole) return;
            const text = (commentDrafts[actionId] ?? "").trim();
            if (!text) return;
            setActionError(null);
            try {
                const updated = await commentRoleAction(incident.id, actionId, { text, actingRole, userId: "support-view" });
                setIncident(updated);
                setCommentDrafts(d => ({ ...d, [actionId]: "" }));
            } catch (e) {
                setActionError(e instanceof Error ? e.message : "Could not add comment.");
            }
        },
        [actingRole, commentDrafts, incident.id]
    );

    const handleResolveAction = useCallback(
        async (actionId: string) => {
            if (!actingRole) return;
            setActionError(null);
            try {
                const updated = await resolveRoleAction(incident.id, actionId, { actingRole, userId: "support-view" });
                setIncident(updated);
            } catch (e) {
                setActionError(e instanceof Error ? e.message : "Could not resolve action.");
            }
        },
        [actingRole, incident.id]
    );

    const handleIcDecision = useCallback(
        async (contributionId: string, decision: "approved" | "rejected") => {
            if (!actingRole) return;
            setActionError(null);
            try {
                const updated = await icDecision(incident.id, contributionId, { decision, actingRole, userId: "support-view" });
                setIncident(updated);
            } catch (e) {
                setActionError(e instanceof Error ? e.message : "Could not record decision.");
            }
        },
        [actingRole, incident.id]
    );

    // IC routes a pending recommendation into a role's Role Actions (Assign to <role> or Take
    // Ownership). The rec becomes an IC-assigned Role Action and leaves the IC pending queue.
    const handleIcAssign = useCallback(
        async (contributionId: string, text: string, assignTo: string) => {
            if (!actingRole || !assignTo) return;
            setActionError(null);
            try {
                await assignRoleAction(incident.id, {
                    text,
                    assignedTo: assignTo,
                    source: "ic_assigned",
                    sourceRecommendationId: contributionId,
                    actingRole,
                    userId: "support-view"
                });
                const updated = await icDecision(incident.id, contributionId, { decision: "rejected", actingRole, userId: "support-view" });
                setIncident(updated);
            } catch (e) {
                setActionError(e instanceof Error ? e.message : "Could not assign action.");
            }
        },
        [actingRole, incident.id]
    );

    if (showCloseout && actingRole) {
        return (
            <CloseoutAdmin
                incident={incident}
                actingRole={actingRole}
                onBack={() => setShowCloseout(false)}
                onIncidentChange={setIncident}
            />
        );
    }

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
                            <span style={{ marginTop: 4, fontSize: "0.72rem", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: modeColor }}>
                                {mode} Mode
                            </span>
                            {canToggleRoleControl && (
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                                    <span style={{ fontSize: "0.78rem", fontWeight: 600, color: iHaveControl ? "#B58B00" : "#888" }}>
                                        {iHaveControl ? "You have control (HIC)" : "AI in control"}
                                    </span>
                                    {iHaveControl ? (
                                        <Button appearance="subtle" size="small" onClick={() => void handleStandDown()}>
                                            Stand Down
                                        </Button>
                                    ) : takeControlAvailable ? (
                                        <Button appearance="primary" size="small" onClick={() => void handleTakeControl()}>
                                            Take Control
                                        </Button>
                                    ) : (
                                        <span style={{ fontSize: "0.72rem", color: "#888" }}>
                                            Take Control available after Transfer of Command
                                        </span>
                                    )}
                                </div>
                            )}
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
                        <div className={styles.headerActions}>
                            <Button
                                appearance="secondary"
                                size="small"
                                icon={formsUpdating ? <Spinner size="tiny" /> : <ArrowSync24Regular />}
                                onClick={() => void handleUpdateForms()}
                                disabled={formsUpdating}
                            >
                                {formsUpdating ? "Updating…" : "Update forms"}
                            </Button>
                            {canClose &&
                                (confirmingClose ? (
                                    <>
                                        <Button
                                            appearance="primary"
                                            size="small"
                                            icon={closing ? <Spinner size="tiny" /> : <LockClosed24Regular />}
                                            onClick={() => void handleCloseIncident()}
                                            disabled={closing}
                                        >
                                            {closing ? "Closing…" : "Confirm close"}
                                        </Button>
                                        <Button
                                            appearance="subtle"
                                            size="small"
                                            onClick={() => setConfirmingClose(false)}
                                            disabled={closing}
                                        >
                                            Cancel
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        appearance="secondary"
                                        size="small"
                                        icon={<LockClosed24Regular />}
                                        onClick={() => setConfirmingClose(true)}
                                    >
                                        Close Incident
                                    </Button>
                                ))}
                            {canCloseOut && (
                                <Button
                                    appearance="secondary"
                                    size="small"
                                    icon={<LockClosed24Regular />}
                                    onClick={() => setShowCloseout(true)}
                                >
                                    {isEventLocked ? "Event Locked" : "Closeout / Lock Event"}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
                {isEventLocked && (
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
                        🔒 Event locked
                        {incident.lockedAt ? ` on ${new Date(incident.lockedAt).toLocaleString()}` : ""}
                        {incident.lockedBy ? ` by ${incident.lockedBy.role}` : ""}. No further changes can be made.
                    </div>
                )}
                {actionError && <div className={styles.actionError}>{actionError}</div>}

                {/* Support-role banner: command transferred — submissions route through the IC. */}
                {!isIncidentCommander && commandTransferred && (
                    <div
                        style={{
                            padding: "8px 12px",
                            margin: "0 0 8px",
                            borderRadius: 6,
                            background: "#FFF4E5",
                            border: "1px solid #E6C200",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            color: "#7A5B00"
                        }}
                    >
                        {actingRole === "safety-officer"
                            ? "Incident Commander has assumed command. Safety items bypass directly to the Fire Officer (flagged on their kiosk)."
                            : "Incident Commander has assumed command. Your submissions now route to the IC for approval before reaching the Fire Officer."}
                    </div>
                )}

                {/* ----- IC Command pane (Incident Commander only) ----- */}
                {isIncidentCommander && (
                    <section className={kioskStyles.pane}>
                        <div className={kioskStyles.paneHeader}>
                            <Title3>Command</Title3>
                            <Caption1 className={kioskStyles.panelSubheading}>
                                {commandTransferred
                                    ? "You hold command. Recommendations route through you before the Fire Officer sees them; Safety items bypass automatically."
                                    : "The Fire Officer currently holds command. Take command to gate content before it reaches the Fire Officer."}
                            </Caption1>
                        </div>
                        {!commandTransferred ? (
                            <Button appearance="primary" disabled={tocBusy} onClick={handleTransferOfCommand}>
                                {tocBusy ? "Transferring…" : "Transfer of Command"}
                            </Button>
                        ) : (
                            <Body1>Transfer of Command initiated.</Body1>
                        )}
                    </section>
                )}

                {/* ----- IC pending-approval queue (after Transfer of Command) ----- */}
                {isIncidentCommander && commandTransferred && (
                    <section className={kioskStyles.pane}>
                        <div className={kioskStyles.paneHeader}>
                            <Title3>Pending your approval</Title3>
                            <Caption1 className={kioskStyles.panelSubheading}>
                                Recommendations awaiting your decision before reaching the Fire Officer kiosk.
                            </Caption1>
                        </div>
                        {pendingForIc.length === 0 ? (
                            <Body1 className={kioskStyles.empty}>Nothing waiting on you.</Body1>
                        ) : (
                            <div className={kioskStyles.itemList}>
                                {pendingForIc.map(c => (
                                    <div key={c.id} className={styles.pendingRow} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                                        <Body1 style={{ flex: 1 }}>
                                            <strong>[{c.addedBy.role}]</strong> {c.text}
                                        </Body1>
                                        <Button size="small" appearance="primary" onClick={() => handleIcDecision(c.id, "approved")}>
                                            Send to FO
                                        </Button>
                                        <select
                                            value=""
                                            disabled={icAssignTargets.length === 0}
                                            onChange={e => {
                                                if (e.target.value) void handleIcAssign(c.id, c.text, e.target.value);
                                            }}
                                            style={{ fontSize: "0.8rem", padding: "2px 4px" }}
                                            aria-label="Assign to active HIC support role"
                                        >
                                            <option value="" disabled>
                                                {icAssignTargets.length === 0 ? "No active HIC roles" : "Assign to…"}
                                            </option>
                                            {icAssignTargets.map(r => (
                                                <option key={r} value={r}>
                                                    {getRoleDefinition(r as ActingRole).acronym ?? getRoleDefinition(r as ActingRole).displayName}
                                                </option>
                                            ))}
                                        </select>
                                        <Button size="small" onClick={() => void handleIcAssign(c.id, c.text, "incident-commander")}>
                                            Take Ownership
                                        </Button>
                                        <Button size="small" onClick={() => handleIcDecision(c.id, "rejected")}>
                                            Reject
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}

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
                                    onRefineClick={icCanEditScene ? setRefineItem : undefined}
                                    onRemove={icCanEditScene ? handleRemoveCondition : undefined}
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

                {/* ----- Role Actions pane (SME 2026-06): assigned + self-assigned work ----- */}
                {actingRole && (
                    <section className={kioskStyles.pane}>
                        <div className={kioskStyles.paneHeader}>
                            <Title3>Role Actions</Title3>
                            <Caption1 className={kioskStyles.panelSubheading}>
                                Work assigned to you (by the IC or self-assigned). Comment to log progress; resolve when done.
                            </Caption1>
                        </div>
                        {myRoleActions.length === 0 ? (
                            <Body1 className={kioskStyles.empty}>No actions assigned yet.</Body1>
                        ) : (
                            <div className={kioskStyles.itemList}>
                                {myRoleActions.map(a => (
                                    <div key={a.id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <Body1 style={{ flex: 1, textDecoration: a.status === "resolved" ? "line-through" : "none", opacity: a.status === "resolved" ? 0.6 : 1 }}>
                                                {a.text}
                                            </Body1>
                                            {a.source === "ic_assigned" && <Caption1 style={{ opacity: 0.7 }}>IC</Caption1>}
                                            <Caption1 style={{ fontWeight: 700, color: a.status === "resolved" ? "#2E7D32" : "#B58B00" }}>
                                                {a.status === "resolved" ? "RESOLVED" : "OPEN"}
                                            </Caption1>
                                        </div>
                                        {a.comments.length > 0 && (
                                            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                                                {a.comments.map((c, i) => (
                                                    <li key={i} style={{ fontSize: "0.82rem", opacity: 0.85 }}>{c.text}</li>
                                                ))}
                                            </ul>
                                        )}
                                        {a.status === "open" && incident.lockedAt == null && (
                                            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                                <input
                                                    value={commentDrafts[a.id] ?? ""}
                                                    onChange={e => setCommentDrafts(d => ({ ...d, [a.id]: e.target.value }))}
                                                    onKeyDown={e => { if (e.key === "Enter") void handleAddComment(a.id); }}
                                                    placeholder="Add a comment…"
                                                    style={{ flex: 1, fontSize: "0.82rem", padding: "4px 6px" }}
                                                />
                                                <Button size="small" appearance="subtle" onClick={() => void handleAddComment(a.id)}>
                                                    Comment
                                                </Button>
                                                <Button size="small" appearance="primary" onClick={() => void handleResolveAction(a.id)}>
                                                    Resolve
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        {incident.lockedAt == null && (
                            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                                <input
                                    value={newActionText}
                                    onChange={e => setNewActionText(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter") void handleAddAction(); }}
                                    placeholder="Add an action for yourself (Take Ownership)…"
                                    style={{ flex: 1, fontSize: "0.85rem", padding: "6px 8px" }}
                                />
                                <Button size="small" appearance="primary" onClick={() => void handleAddAction()} disabled={!newActionText.trim()}>
                                    + Add
                                </Button>
                            </div>
                        )}
                    </section>
                )}

                {/* ----- Form tab strip — filtered to the current role's 3 forms ----- */}
                <FormTabStrip
                    forms={incident.forms}
                    currentRole={actingRole ?? null}
                    locked={isEventLocked}
                    generating={formsUpdating}
                    editable={!isEventLocked}
                    incidentId={incident.id}
                    actingRole={actingRole ?? "incident-commander"}
                    onSaved={setIncident}
                />
            </div>

            {/* Citations rendered for support roles — they trace the published-standard source. */}
            <AnalyzePopup
                item={analyzeItem}
                showCitations
                onClose={() => setAnalyzeItem(null)}
            />
            <RefineConditionPopup
                condition={refineItem}
                incidentId={incident.id}
                actingRole={actingRole ?? "incident-commander"}
                onApplied={handleRefinementApplied}
                onClose={() => setRefineItem(null)}
            />
        </div>
    );
};

export default IncidentSupportView;
