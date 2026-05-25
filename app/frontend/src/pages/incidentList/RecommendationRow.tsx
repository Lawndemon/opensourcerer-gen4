/**
 * RecommendationRow — single line in the unified support-role recommendations list.
 *
 * Per the 2026-05-16 spec ("single list with status badges"), one row component
 * renders every state — pending / published / dismissed — distinguished by badges
 * rather than separate sub-sections. Action buttons (publish ✓ / dismiss ✕) only
 * appear when the row is pending.
 *
 * Source badge (KB / Custom) is preserved across states so the support role can
 * tell at a glance whether they typed an item themselves or accepted an LLM
 * suggestion.
 */

import { Badge, Body1, Button, Caption1, Spinner, Tooltip } from "@fluentui/react-components";
import { Checkmark24Regular, Dismiss24Regular } from "@fluentui/react-icons";

import type { RecommendationCategory } from "../../api/incidentTypes";
import RoleBubble from "../../components/RoleBubble";
import styles from "./RecommendationRow.module.css";

export type RowStatus = "pending" | "published" | "dismissed";
export type RowSource = "kb" | "custom" | "unknown";

export interface RecommendationRowData {
    /** Stable id — recommendation id for pending/published, audit event id for dismissed. */
    id: string;
    text: string;
    status: RowStatus;
    source: RowSource;
    /** ISO timestamp for sorting (createdAt, addedAt, or audit event timestamp). */
    timestamp: string;
    /** ICS urgency category; null = uncategorized. Drives section grouping. */
    category: RecommendationCategory | null;
    /** Owning role id — renders the vest-colour bubble. */
    role: string;
}

interface RecommendationRowProps {
    row: RecommendationRowData;
    /**
     * Publish handler. Invoked only for pending rows. When omitted (e.g., the
     * list is read-only for this role), the button is hidden.
     */
    onPublish?: (id: string) => Promise<void> | void;
    /**
     * Dismiss handler. Invoked only for pending rows. When omitted, the button is hidden.
     */
    onDismiss?: (id: string) => Promise<void> | void;
    /** When true, render a spinner instead of the action buttons (in-flight). */
    busy?: boolean;
}

const STATUS_BADGE: Record<RowStatus, { label: string; color: "warning" | "success" | "subtle" }> = {
    pending: { label: "Pending", color: "warning" },
    published: { label: "Published", color: "success" },
    dismissed: { label: "Dismissed", color: "subtle" }
};

const SOURCE_BADGE: Record<RowSource, { label: string; color: "informative" | "brand" | "subtle" }> = {
    kb: { label: "KB", color: "informative" },
    custom: { label: "Custom", color: "brand" },
    unknown: { label: "—", color: "subtle" }
};

const RecommendationRow = ({ row, onPublish, onDismiss, busy }: RecommendationRowProps) => {
    const statusBadge = STATUS_BADGE[row.status];
    const sourceBadge = SOURCE_BADGE[row.source];
    const isPending = row.status === "pending";
    const isDismissed = row.status === "dismissed";

    return (
        <div className={`${styles.row} ${isDismissed ? styles.rowDismissed : ""}`}>
            <div className={styles.badges}>
                <RoleBubble role={row.role} />
                <Badge size="small" appearance="filled" color={statusBadge.color}>
                    {statusBadge.label}
                </Badge>
                <Badge size="small" appearance="outline" color={sourceBadge.color}>
                    {sourceBadge.label}
                </Badge>
            </div>
            <Body1 className={styles.text}>{row.text}</Body1>
            <div className={styles.actions}>
                {busy && isPending ? (
                    <Spinner size="tiny" />
                ) : isPending && (onPublish || onDismiss) ? (
                    <>
                        {onPublish && (
                            <Tooltip content="Publish — visible to the Fire Officer" relationship="label">
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<Checkmark24Regular />}
                                    className={styles.publishButton}
                                    aria-label={`Publish: ${row.text}`}
                                    onClick={() => void onPublish(row.id)}
                                />
                            </Tooltip>
                        )}
                        {onDismiss && (
                            <Tooltip content="Dismiss — record decline; next refresh won't repeat" relationship="label">
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<Dismiss24Regular />}
                                    className={styles.dismissButton}
                                    aria-label={`Dismiss: ${row.text}`}
                                    onClick={() => void onDismiss(row.id)}
                                />
                            </Tooltip>
                        )}
                    </>
                ) : (
                    <Caption1 className={styles.timestamp}>
                        {(() => {
                            try {
                                return new Date(row.timestamp).toLocaleString();
                            } catch {
                                return row.timestamp;
                            }
                        })()}
                    </Caption1>
                )}
            </div>
        </div>
    );
};

export default RecommendationRow;
