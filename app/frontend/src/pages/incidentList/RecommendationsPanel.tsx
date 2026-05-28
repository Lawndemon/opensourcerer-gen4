/**
 * RecommendationsPanel — owns the unified recommendations list for a support role.
 *
 * Renders pending / published / dismissed items as a single list with status badges
 * (per 2026-05-16 spec). Owns:
 *  - Server's pending working set (refresh / publish / dismiss endpoints)
 *  - CustomAddForm wiring
 *  - Refresh button with frontend-computed staleness state
 *  - Auto-refresh on mount if the role has never refreshed before
 *
 * The published/dismissed projections are derived from props (incident.supportContributions
 * and incident.eventLog). When the user publishes or dismisses, this component calls
 * onIncidentRefresh so the parent re-fetches the full incident document — the polling
 * loop on the parent will pick up the change on the next tick regardless.
 *
 * Staleness logic: we hash the scene-items signature (sorted `id:status:removed` tuples)
 * and persist the hash-at-last-refresh in sessionStorage keyed by `${incidentId}:${role}`.
 * If the current hash differs, the Refresh button goes yellow. This honors the "only if
 * scene items changed" semantics chosen on 2026-05-16 without churning the backend's
 * `scene_last_updated` (which currently bumps on every Validate IAP press).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Body1, Button, Caption1, Spinner, Title3, Tooltip } from "@fluentui/react-components";
import { ArrowSync24Regular, Warning24Filled } from "@fluentui/react-icons";

import {
    addCustomRecommendation,
    attestContribution,
    withdrawSupportContribution,
    dismissRecommendation,
    getSupportRecommendations,
    publishRecommendation,
    refreshSupportRecommendations
} from "../../api/incidents";
import type { GetRecommendationsResponse, IncidentDocument, PendingRecommendation, RecommendationCategory } from "../../api/incidentTypes";

import CustomAddForm from "./CustomAddForm";
import RecommendationRow, { RecommendationRowData } from "./RecommendationRow";
import { RECOMMENDATION_CATEGORY_LABEL, RECOMMENDATION_CATEGORY_ORDER } from "../../recommendationCategories";
import styles from "./RecommendationsPanel.module.css";

interface RecommendationsPanelProps {
    incident: IncidentDocument;
    actingRole: string;
    userId: string;
    /** Tell the parent to re-fetch the incident (after publish/dismiss). */
    onIncidentRefresh: () => void;
    /** When true, the panel is read-only: no refresh, no publish/dismiss, no custom add. */
    locked?: boolean;
}

// ---------------------------------------------------------------------------
// Scene-items signature for staleness detection
// ---------------------------------------------------------------------------

function sceneItemsSignature(incident: IncidentDocument): string {
    // Stable: id + status + removed. Sorted by id so order doesn't affect the hash.
    return incident.sceneConditionsAndActions
        .map(item => `${item.id}:${item.status}:${item.removed ? "1" : "0"}`)
        .sort()
        .join("|");
}

function staleHashKey(incidentId: string, role: string): string {
    return `opensourcerer.recHash.${incidentId}.${role}`;
}

function readStoredHash(incidentId: string, role: string): string | null {
    if (typeof window === "undefined") return null;
    try {
        return window.sessionStorage.getItem(staleHashKey(incidentId, role));
    } catch {
        return null;
    }
}

function writeStoredHash(incidentId: string, role: string, hash: string): void {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(staleHashKey(incidentId, role), hash);
    } catch {
        /* sessionStorage may be unavailable; staleness will reset on render. */
    }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RecommendationsPanel = ({ incident, actingRole, userId, onIncidentRefresh, locked }: RecommendationsPanelProps) => {
    const [data, setData] = useState<GetRecommendationsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    // Track hash at the time of the role's last refresh; drives the yellow/green pill.
    const currentSignature = useMemo(() => sceneItemsSignature(incident), [incident]);
    const [storedHash, setStoredHash] = useState<string | null>(() => readStoredHash(incident.id, actingRole));
    // Avoid the auto-refresh-on-empty firing twice across StrictMode double-mount.
    const autoRefreshFiredRef = useRef(false);

    // --- Load initial pending list -----------------------------------------
    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        getSupportRecommendations(incident.id, actingRole, controller.signal)
            .then(response => {
                if (cancelled) return;
                setData(response);
                // First-touch initialization: if no hash yet, seed with the current scene
                // so the user sees "fresh" until something actually changes.
                if (!readStoredHash(incident.id, actingRole)) {
                    writeStoredHash(incident.id, actingRole, currentSignature);
                    setStoredHash(currentSignature);
                }
            })
            .catch(err => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "Failed to load recommendations");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
            controller.abort();
        };
        // We deliberately depend only on incident.id + actingRole; reacting to
        // currentSignature would re-fetch on every scene change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [incident.id, actingRole]);

    // --- Auto-refresh on first load if the role has never refreshed --------
    useEffect(() => {
        if (locked) return;
        if (loading || !data) return;
        if (data.lastGeneratedAt) return;
        if (autoRefreshFiredRef.current) return;
        if (busyIds.size > 0 || refreshing) return;
        autoRefreshFiredRef.current = true;
        void handleRefresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, data, locked]);

    // --- Actions -----------------------------------------------------------

    const handleRefresh = useCallback(async () => {
        if (locked) return;
        setRefreshing(true);
        setError(null);
        try {
            const response = await refreshSupportRecommendations(incident.id, { actingRole, userId });
            setData(response);
            const sig = sceneItemsSignature(incident);
            writeStoredHash(incident.id, actingRole, sig);
            setStoredHash(sig);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Refresh failed");
        } finally {
            setRefreshing(false);
        }
    }, [actingRole, incident, locked, userId]);

    const markBusy = (id: string, busy: boolean) =>
        setBusyIds(prev => {
            const next = new Set(prev);
            if (busy) next.add(id);
            else next.delete(id);
            return next;
        });

    const handlePublish = useCallback(
        async (recId: string) => {
            if (locked) return;
            markBusy(recId, true);
            setError(null);
            try {
                const response = await publishRecommendation(incident.id, recId, { actingRole, userId });
                setData(response);
                onIncidentRefresh();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Publish failed");
            } finally {
                markBusy(recId, false);
            }
        },
        [actingRole, incident.id, locked, onIncidentRefresh, userId]
    );

    const handleDismiss = useCallback(
        async (recId: string) => {
            if (locked) return;
            markBusy(recId, true);
            setError(null);
            try {
                const response = await dismissRecommendation(incident.id, recId, { actingRole, userId });
                setData(response);
                onIncidentRefresh();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Dismiss failed");
            } finally {
                markBusy(recId, false);
            }
        },
        [actingRole, incident.id, locked, onIncidentRefresh, userId]
    );

    const handleWithdraw = useCallback(
        async (contributionId: string) => {
            try {
                await withdrawSupportContribution(incident.id, contributionId, { actingRole, userId });
                onIncidentRefresh();
            } catch (e) {
                // Surface via parent error path is overkill; log for now.
                // eslint-disable-next-line no-console
                console.warn("Withdraw failed:", e);
            }
        },
        [actingRole, incident.id, onIncidentRefresh, userId]
    );

    const handleConfirm = useCallback(
        async (contributionId: string) => {
            if (locked) return;
            markBusy(contributionId, true);
            setError(null);
            try {
                await attestContribution(incident.id, contributionId, { actingRole, userId });
                onIncidentRefresh();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Confirm failed");
            } finally {
                markBusy(contributionId, false);
            }
        },
        [actingRole, incident.id, locked, onIncidentRefresh, userId]
    );

    const handleAddCustom = useCallback(
        async (text: string) => {
            const response = await addCustomRecommendation(incident.id, { text, actingRole, userId });
            setData(response);
            onIncidentRefresh();
        },
        [actingRole, incident.id, onIncidentRefresh, userId]
    );

    // --- Unified list construction -----------------------------------------

    const rows = useMemo<RecommendationRowData[]>(() => {
        const pending: RecommendationRowData[] = (data?.items ?? []).map((it: PendingRecommendation) => ({
            id: it.id,
            text: it.text,
            status: "pending",
            source: it.source === "kb" ? "kb" : "custom",
            timestamp: it.createdAt,
            category: it.category ?? null,
            role: actingRole
        }));
        const published: RecommendationRowData[] = incident.supportContributions
            .filter(c => c.addedBy.role === actingRole && !c.withdrawn)
            .map(c => ({
                id: c.id,
                text: c.text,
                status: "published",
                source: c.source === "custom" ? "custom" : "kb",
                timestamp: c.addedAt,
                category: c.category ?? null,
                role: c.addedBy.role,
                provenance: c.provenance
            }));
        const dismissed: RecommendationRowData[] = incident.eventLog
            .filter(e => {
                if (e.type !== "support_recommendation_dismissed") return false;
                if (e.actor === "system" || typeof e.actor === "string") return false;
                return e.actor.role === actingRole;
            })
            .map(e => {
                const payload = e.payload as { text?: string; source?: string; category?: RecommendationCategory };
                const sourceVal = payload.source === "kb" || payload.source === "custom" ? payload.source : "unknown";
                return {
                    id: e.id,
                    text: payload.text ?? "(dismissed item)",
                    status: "dismissed" as const,
                    source: sourceVal,
                    timestamp: e.timestamp,
                    category: payload.category ?? null,
                    role: actingRole
                };
            });
        // Within each status group, newest first. Then concatenate in priority order:
        // pending (most actionable) → published → dismissed.
        const byTimeDesc = (a: RecommendationRowData, b: RecommendationRowData) =>
            b.timestamp.localeCompare(a.timestamp);
        pending.sort(byTimeDesc);
        published.sort(byTimeDesc);
        dismissed.sort(byTimeDesc);
        return [...pending, ...published, ...dismissed];
    }, [data, incident.supportContributions, incident.eventLog, actingRole]);

    // --- Staleness state ---------------------------------------------------

    const isStale = storedHash !== null && storedHash !== currentSignature && !!data?.lastGeneratedAt;

    const refreshLabel = locked
        ? "Refresh disabled — incident is no longer in Response phase"
        : refreshing
          ? "Refreshing…"
          : isStale
            ? "Scene has changed since the last refresh — recommendations may be stale"
            : data?.lastGeneratedAt
              ? "Recommendations are current"
              : "No recommendations yet — press to generate";

    // --- Render ------------------------------------------------------------

    return (
        <div className={styles.panel}>
            <div className={styles.headerRow}>
                <div className={styles.headerText}>
                    <Title3>Recommendations</Title3>
                    <Caption1 className={styles.subtitle}>
                        Your working set as <strong>{actingRole}</strong> — publish (✓) sends to the Fire Officer; dismiss (✕) records a decline.
                    </Caption1>
                </div>
                <Tooltip content={refreshLabel} relationship="label">
                    <Button
                        appearance={isStale ? "primary" : "secondary"}
                        icon={refreshing ? <Spinner size="tiny" /> : isStale ? <Warning24Filled /> : <ArrowSync24Regular />}
                        onClick={() => void handleRefresh()}
                        disabled={locked || refreshing}
                        className={`${styles.refreshButton} ${isStale ? styles.refreshStale : styles.refreshFresh}`}
                    >
                        {isStale ? "Refresh (stale)" : "Refresh"}
                    </Button>
                </Tooltip>
            </div>

            {!locked && (
                <div className={styles.addRow}>
                    <CustomAddForm onAdd={handleAddCustom} disabled={locked} />
                </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            {loading ? (
                <div className={styles.loading}>
                    <Spinner size="tiny" /> Loading recommendations…
                </div>
            ) : rows.length === 0 ? (
                <Body1 className={styles.empty}>
                    {locked
                        ? "No recommendations were recorded for this role."
                        : "No recommendations yet. Press Refresh to generate, or add a custom item above."}
                </Body1>
            ) : (
                <div className={styles.list}>
                    {[...RECOMMENDATION_CATEGORY_ORDER, null].map(cat => {
                        const group = rows.filter(r => (r.category ?? null) === cat);
                        if (group.length === 0) return null;
                        const heading = cat ? RECOMMENDATION_CATEGORY_LABEL[cat] : "Other";
                        return (
                            <div key={heading} className={styles.categoryGroup}>
                                <Caption1 className={styles.categoryHeading}>{heading}</Caption1>
                                {group.map(row => (
                                    <RecommendationRow
                                        key={`${row.status}-${row.id}`}
                                        row={row}
                                        onPublish={!locked && row.status === "pending" ? handlePublish : undefined}
                                        onDismiss={!locked && row.status === "pending" ? handleDismiss : undefined}
                                        onConfirm={!locked && row.status === "published" && row.provenance === "ai" ? handleConfirm : undefined}
                                        onWithdraw={!locked && row.status === "published" && row.provenance === "ai" ? handleWithdraw : undefined}
                                        busy={busyIds.has(row.id)}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default RecommendationsPanel;
