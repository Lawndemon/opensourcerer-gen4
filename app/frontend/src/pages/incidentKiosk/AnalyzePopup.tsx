/**
 * AnalyzePopup — MAD framework "Analyze" tier.
 *
 * Modal popup triggered by tapping a SceneItemRow. Surfaces the published action plan
 * content, the client plan content (where applicable), and the delta between them.
 *
 * Citation visibility is role-conditional per the MAD framework (BACKLOG.md):
 *  - **Fire Officer kiosk** — citations hidden (simplicity-under-chaos directive). The
 *    fire officer doesn't need bibliographic detail mid-incident.
 *  - **Support roles** — citations rendered (legislative-adjacent roles especially benefit
 *    from being able to trace the underlying source).
 *
 * The contract gives us `publishedPlanContext`, `clientPlanContext`, and `delta` as nullable
 * strings; we hide sections that have no content rather than rendering empty headers.
 */

import {
    Badge,
    Body1,
    Button,
    Caption1,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Divider
} from "@fluentui/react-components";

import type { ConditionStatus, SceneConditionAndAction } from "../../api/incidentTypes";

import styles from "./AnalyzePopup.module.css";

interface AnalyzePopupProps {
    item: SceneConditionAndAction | null;
    showCitations: boolean;
    onClose: () => void;
}

const STATUS_LABEL: Record<ConditionStatus, string> = {
    conforming: "Conforming",
    deviating_safe: "Deviating — safe",
    deviating_unsafe: "Deviating — life risk"
};

const STATUS_COLOR: Record<ConditionStatus, "success" | "warning" | "danger"> = {
    conforming: "success",
    deviating_safe: "warning",
    deviating_unsafe: "danger"
};

const AnalyzePopup = ({ item, showCitations, onClose }: AnalyzePopupProps) => {
    const open = item !== null;

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open) onClose();
            }}
        >
            <DialogSurface className={styles.surface}>
                {item && (
                    <DialogBody>
                        <DialogTitle>
                            <div className={styles.titleRow}>
                                <Badge
                                    appearance="filled"
                                    color={STATUS_COLOR[item.status]}
                                    size="medium"
                                >
                                    {STATUS_LABEL[item.status]}
                                </Badge>
                                <Badge
                                    appearance="outline"
                                    color={item.type === "condition" ? "informative" : "brand"}
                                    size="small"
                                >
                                    {item.type === "condition" ? "Condition" : "Action"}
                                </Badge>
                            </div>
                            <div className={styles.itemText}>{item.text}</div>
                        </DialogTitle>
                        <DialogContent>
                            {item.publishedPlanContext && (
                                <section className={styles.section}>
                                    <Caption1 className={styles.sectionHeading}>
                                        Published plan
                                    </Caption1>
                                    <Body1 className={styles.sectionBody}>
                                        {item.publishedPlanContext}
                                    </Body1>
                                </section>
                            )}

                            {item.clientPlanContext && (
                                <section className={styles.section}>
                                    <Caption1 className={styles.sectionHeading}>
                                        Client plan
                                    </Caption1>
                                    <Body1 className={styles.sectionBody}>
                                        {item.clientPlanContext}
                                    </Body1>
                                </section>
                            )}

                            {item.delta && (
                                <section className={styles.section}>
                                    <Caption1 className={styles.sectionHeading}>
                                        Delta — client vs published
                                    </Caption1>
                                    <Body1 className={styles.sectionBody}>{item.delta}</Body1>
                                </section>
                            )}

                            {!item.publishedPlanContext && !item.clientPlanContext && !item.delta && (
                                <Body1 className={styles.emptyContext}>
                                    No additional plan context available for this item.
                                </Body1>
                            )}

                            {showCitations && item.citations.length > 0 && (
                                <>
                                    <Divider className={styles.divider} />
                                    <section className={styles.section}>
                                        <Caption1 className={styles.sectionHeading}>
                                            Citations
                                        </Caption1>
                                        <ul className={styles.citationList}>
                                            {item.citations.map((c, i) => (
                                                <li key={i} className={styles.citationItem}>
                                                    <span className={styles.citationTier}>
                                                        {c.sourceTier}
                                                    </span>
                                                    <span className={styles.citationFile}>
                                                        {c.sourceFile}
                                                    </span>
                                                    {c.pageOrSection && (
                                                        <span className={styles.citationLocation}>
                                                            · {c.pageOrSection}
                                                        </span>
                                                    )}
                                                    {c.excerpt && (
                                                        <Body1 className={styles.citationExcerpt}>
                                                            “{c.excerpt}”
                                                        </Body1>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                </>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="primary" onClick={onClose}>
                                Close
                            </Button>
                        </DialogActions>
                    </DialogBody>
                )}
            </DialogSurface>
        </Dialog>
    );
};

export default AnalyzePopup;
