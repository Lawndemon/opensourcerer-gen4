/**
 * SceneItemRow — bulleted entry in the Scene Conditions pane.
 *
 * Traffic-light icon (green check / yellow ! / red X) as the bullet glyph, type badge,
 * the item's text, then a Refine button (live as of Session 4) and a Remove button.
 *
 * Tapping anywhere on the row (other than the buttons) opens the AnalyzePopup.
 * Citations are hidden in the Fire Officer kiosk per the MAD framework's
 * simplicity-under-chaos directive.
 *
 * Removed items render at 0.4 opacity with a strikethrough; they remain visible because
 * sticky-with-resurfacing semantics may revive them on a later Validate IAP pass.
 */

import { Badge, Body1, Button, Tooltip } from "@fluentui/react-components";
import { CheckmarkCircle24Filled, Delete24Regular, DismissCircle24Filled, Warning24Filled } from "@fluentui/react-icons";

import type { ConditionStatus, SceneConditionAndAction } from "../../api/incidentTypes";

import styles from "./SceneItemRow.module.css";

interface SceneItemRowProps {
    item: SceneConditionAndAction;
    onAnalyze: (item: SceneConditionAndAction) => void;
    /**
     * Refine handler. When undefined, the Refine button is disabled with a tooltip
     * explaining persistence is required (Session 3+).
     */
    onRefineClick?: (item: SceneConditionAndAction) => void;
    /**
     * Fire Officer removal handler. When undefined, the remove button is hidden —
     * used by the read-only support-role view (Session 5) and by the kiosk after Loss Stop.
     */
    onRemove?: (item: SceneConditionAndAction) => void;
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

const SceneItemRow = ({ item, onAnalyze, onRefineClick, onRemove }: SceneItemRowProps) => {
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
            {onRefineClick && (
                <Tooltip
                    content={
                        isRemoved
                            ? "Removed item — refinement disabled."
                            : "Refine — narrow this with 3 KB-generated statements."
                    }
                    relationship="label"
                >
                    <Button
                        appearance="subtle"
                        size="small"
                        disabled={isRemoved}
                        className={styles.refineButton}
                        onClick={e => {
                            e.stopPropagation();
                            onRefineClick(item);
                        }}
                    >
                        Refine
                    </Button>
                </Tooltip>
            )}
            {onRemove && !isRemoved && (
                <Tooltip content="Remove from scene" relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<Delete24Regular />}
                        className={styles.removeButton}
                        aria-label={`Remove: ${item.text}`}
                        onClick={e => {
                            e.stopPropagation();
                            onRemove(item);
                        }}
                    />
                </Tooltip>
            )}
        </div>
    );
};

export default SceneItemRow;
