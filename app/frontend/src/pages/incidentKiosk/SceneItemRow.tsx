/**
 * SceneItemRow — a single row in the Scene Conditions and Actions panel.
 *
 * One per `SceneConditionAndAction`. Layout from left to right:
 *  - Traffic-light icon (green check / yellow ! / red X) encoding life-risk severity per
 *    BACKLOG.md → MAD framework.
 *  - "Condition" or "Action" badge.
 *  - The item's `text`.
 *  - Refine Condition placeholder button (full popup + endpoints land in Session 4).
 *
 * Tapping anywhere on the row (other than the Refine button) opens the AnalyzePopup,
 * which shows the published plan context, client plan context, and delta. Citations are
 * hidden in the Fire Officer kiosk per the SME's simplicity-under-chaos directive.
 *
 * Visual rules:
 *  - Items with `removed=true` render at 0.4 opacity with a strikethrough; per the SME's
 *    sticky-with-resurfacing semantics, they can come back if new transcript evidence
 *    supports them, so they remain visible (not deleted).
 *  - Refine Condition button is disabled (placeholder) — the layout slot is real so the
 *    grid doesn't shift when Session 4 wires it up.
 */

import { Badge, Body1, Button, Tooltip } from "@fluentui/react-components";
import { CheckmarkCircle24Filled, DismissCircle24Filled, Warning24Filled } from "@fluentui/react-icons";

import type { ConditionStatus, SceneConditionAndAction } from "../../api/incidentTypes";

import styles from "./SceneItemRow.module.css";

interface SceneItemRowProps {
    item: SceneConditionAndAction;
    onAnalyze: (item: SceneConditionAndAction) => void;
    onRefineClick?: (item: SceneConditionAndAction) => void;
}

const STATUS_LABELS: Record<ConditionStatus, string> = {
    conforming: "Conforming with the published plan",
    deviating_safe: "Deviates from the plan — no life risk",
    deviating_unsafe: "Deviates from the plan — life risk"
};

const StatusIcon = ({ status }: { status: ConditionStatus }) => {
    const label = STATUS_LABELS[status];
    if (status === "conforming") {
        return (
            <Tooltip content={label} relationship="label">
                <CheckmarkCircle24Filled className={`${styles.icon} ${styles.iconGreen}`} />
            </Tooltip>
        );
    }
    if (status === "deviating_safe") {
        return (
            <Tooltip content={label} relationship="label">
                <Warning24Filled className={`${styles.icon} ${styles.iconYellow}`} />
            </Tooltip>
        );
    }
    return (
        <Tooltip content={label} relationship="label">
            <DismissCircle24Filled className={`${styles.icon} ${styles.iconRed}`} />
        </Tooltip>
    );
};

const SceneItemRow = ({ item, onAnalyze, onRefineClick }: SceneItemRowProps) => {
    const isRemoved = item.removed;
    const handleRowActivate = () => {
        if (isRemoved) return;
        onAnalyze(item);
    };
    const handleKeyActivate = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRowActivate();
        }
    };

    return (
        <div
            className={`${styles.row} ${isRemoved ? styles.rowRemoved : ""}`}
            role="button"
            tabIndex={isRemoved ? -1 : 0}
            aria-disabled={isRemoved}
            aria-label={`${item.type === "condition" ? "Condition" : "Action"}: ${item.text}. ${STATUS_LABELS[item.status]}. Tap for analysis.`}
            onClick={handleRowActivate}
            onKeyDown={handleKeyActivate}
        >
            <StatusIcon status={item.status} />
            <Badge
                size="small"
                appearance="outline"
                color={item.type === "condition" ? "informative" : "brand"}
                className={styles.typeBadge}
            >
                {item.type === "condition" ? "Condition" : "Action"}
            </Badge>
            <Body1 className={styles.text}>{item.text}</Body1>
            <Tooltip
                content={
                    isRemoved
                        ? "Removed item — refinement disabled."
                        : "Refine Condition — coming in the next iteration."
                }
                relationship="label"
            >
                <Button
                    appearance="subtle"
                    size="small"
                    disabled
                    className={styles.refineButton}
                    onClick={e => {
                        e.stopPropagation();
                        onRefineClick?.(item);
                    }}
                >
                    Refine
                </Button>
            </Tooltip>
        </div>
    );
};

export default SceneItemRow;
