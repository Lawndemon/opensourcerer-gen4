/**
 * RefineConditionPopup — MAD framework "narrowing" step (Session 4).
 *
 * Fire Officer taps a Refine button on a SceneItemRow. The popup fetches 3 narrowing
 * statements from the backend and renders them as four big tap targets:
 *   - Statement 1
 *   - Statement 2
 *   - Statement 3
 *   - "None of the above"  (sends selectedStatement=null)
 *
 * Single tap on a statement triggers the apply call, after which the parent receives
 * the updated SceneConditionAndAction and merges it into the kiosk state.
 *
 * Kiosk principles:
 *  - The user never types. Every choice is a single button.
 *  - Tap-outside or tap the small Close affordance to abandon without choosing.
 *  - Loading + error states each get their own clearly-rendered view; no spinners
 *    competing with content inside the popup.
 */

import { useEffect, useState } from "react";
import {
    Body1,
    Button,
    Caption1,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Spinner
} from "@fluentui/react-components";

import type { SceneConditionAndAction } from "../../api/incidentTypes";
import { applyRefinement, getRefinementOptions, IncidentApiError } from "../../api/incidents";

import styles from "./RefineConditionPopup.module.css";

interface RefineConditionPopupProps {
    /** The condition to refine. When null, the popup is closed. */
    condition: SceneConditionAndAction | null;
    /** The persisted incident id; required to hit the backend. */
    incidentId: string;
    /** Acting role of the user (Fire Officer for the kiosk). */
    actingRole: string;
    /** Called when the user picks something and the backend confirms. */
    onApplied: (updated: SceneConditionAndAction) => void;
    /** Close the popup without applying. */
    onClose: () => void;
}

type LoadState =
    | { kind: "idle" }
    | { kind: "loading_options" }
    | { kind: "options_loaded"; statements: string[] }
    | { kind: "applying"; selection: string | null }
    | { kind: "error"; message: string };

function formatError(err: unknown): string {
    if (err instanceof IncidentApiError) {
        return `${err.message}`;
    }
    if (err instanceof Error) {
        return err.message;
    }
    return "Unexpected error contacting the backend.";
}

const RefineConditionPopup = ({
    condition,
    incidentId,
    actingRole,
    onApplied,
    onClose
}: RefineConditionPopupProps) => {
    const [state, setState] = useState<LoadState>({ kind: "idle" });
    const open = condition !== null;

    // Fetch narrowing options when the popup opens. Reset state on close.
    useEffect(() => {
        if (!condition) {
            setState({ kind: "idle" });
            return;
        }
        let cancelled = false;
        setState({ kind: "loading_options" });
        getRefinementOptions(incidentId, condition.id)
            .then(response => {
                if (cancelled) return;
                setState({ kind: "options_loaded", statements: response.narrowingStatements });
            })
            .catch(err => {
                if (cancelled) return;
                setState({ kind: "error", message: formatError(err) });
            });
        return () => {
            cancelled = true;
        };
    }, [condition, incidentId]);

    const handleSelect = async (statement: string | null) => {
        if (!condition) return;
        setState({ kind: "applying", selection: statement });
        try {
            const updated = await applyRefinement(incidentId, condition.id, {
                selectedStatement: statement,
                actingRole,
                userId: "kiosk"
            });
            onApplied(updated);
            onClose();
        } catch (err) {
            setState({ kind: "error", message: formatError(err) });
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open) onClose();
            }}
        >
            <DialogSurface className={styles.surface}>
                {condition && (
                    <DialogBody>
                        <DialogTitle>
                            <Caption1 className={styles.titleLabel}>Refine Condition</Caption1>
                            <div className={styles.conditionText}>{condition.text}</div>
                        </DialogTitle>
                        <DialogContent>
                            {state.kind === "loading_options" && (
                                <div className={styles.center}>
                                    <Spinner size="medium" />
                                    <Body1 className={styles.muted}>
                                        Asking the knowledgebase for narrowing options…
                                    </Body1>
                                </div>
                            )}
                            {state.kind === "options_loaded" && (
                                <>
                                    <Caption1 className={styles.subheading}>
                                        Which best describes the situation?
                                    </Caption1>
                                    <div className={styles.choiceList}>
                                        {state.statements.map((s, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                className={styles.choiceButton}
                                                onClick={() => handleSelect(s)}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            className={`${styles.choiceButton} ${styles.choiceNone}`}
                                            onClick={() => handleSelect(null)}
                                        >
                                            None of the above
                                        </button>
                                    </div>
                                </>
                            )}
                            {state.kind === "applying" && (
                                <div className={styles.center}>
                                    <Spinner size="medium" />
                                    <Body1 className={styles.muted}>
                                        {state.selection === null
                                            ? "Recording your selection…"
                                            : "Re-evaluating against the narrowed scenario…"}
                                    </Body1>
                                </div>
                            )}
                            {state.kind === "error" && (
                                <div className={styles.errorPanel}>
                                    Refine failed: {state.message}
                                </div>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="subtle" onClick={onClose}>
                                Cancel
                            </Button>
                        </DialogActions>
                    </DialogBody>
                )}
            </DialogSurface>
        </Dialog>
    );
};

export default RefineConditionPopup;
