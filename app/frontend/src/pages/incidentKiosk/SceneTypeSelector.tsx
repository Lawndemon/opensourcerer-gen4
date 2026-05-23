import { useEffect, useState } from "react";
import { Caption1 } from "@fluentui/react-components";
import { Checkmark24Filled } from "@fluentui/react-icons";

import type { SceneType } from "../../api/incidentTypes";
import styles from "./SceneTypeSelector.module.css";

const TYPES: SceneType[] = [1, 2, 3, 4, 5];

interface SceneTypeSelectorProps {
    /** The confirmed Type on record (null until the Fire Officer first confirms). */
    value: SceneType | null;
    /** AI-estimated Type used to pre-select before confirmation (wired in slice 3). */
    estimated?: SceneType | null;
    /** Called when the Fire Officer confirms the highlighted Type. */
    onConfirm: (sceneType: SceneType) => void;
    /** Disable interaction (e.g. the incident is locked). */
    disabled?: boolean;
    /** A confirm request is in flight. */
    pending?: boolean;
}

/**
 * ICS Scene Type triage control for the Fire Officer kiosk.
 *
 * Five circles rendered 1 -> 5 left-to-right (ICS standard ordering; NOT severity order —
 * Type 1 is most complex, Type 5 least). The Fire Officer taps a circle to (pre)select, then
 * taps the check to confirm. Confirmation is what fires downstream re-population on the
 * backend (recommendations + forms); see BACKLOG.md.
 */
const SceneTypeSelector = ({ value, estimated = null, onConfirm, disabled = false, pending = false }: SceneTypeSelectorProps) => {
    // Local highlight: confirmed value if any, else the AI estimate, else nothing.
    const [selected, setSelected] = useState<SceneType | null>(value ?? estimated ?? null);

    // Re-sync if the confirmed value or the estimate changes from outside (re-validate, etc.).
    useEffect(() => {
        setSelected(value ?? estimated ?? null);
    }, [value, estimated]);

    const isConfirmedSelection = value !== null && selected === value;
    const canConfirm = selected !== null && !isConfirmedSelection && !disabled && !pending;

    return (
        <section className={styles.selector} aria-label="ICS Scene Type">
            <div className={styles.header}>
                <Caption1 className={styles.heading}>Scene Type (ICS)</Caption1>
                <Caption1 className={styles.status}>
                    {value !== null ? "Confirmed: Type " + value : "Unconfirmed"}
                </Caption1>
            </div>
            <div className={styles.row}>
                <div className={styles.circles} role="radiogroup" aria-label="ICS Type 1 to 5">
                    {TYPES.map(t => {
                        const selectedNow = selected === t;
                        const confirmedNow = isConfirmedSelection && value === t;
                        return (
                            <button
                                key={t}
                                type="button"
                                role="radio"
                                aria-checked={selectedNow}
                                disabled={disabled}
                                className={[styles.circle, selectedNow ? styles.selected : "", confirmedNow ? styles.confirmed : ""].filter(Boolean).join(" ")}
                                onClick={() => !disabled && setSelected(t)}
                            >
                                {t}
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    className={styles.confirm}
                    aria-label="Confirm scene type"
                    title={value !== null ? "Confirm change" : "Confirm scene type"}
                    disabled={!canConfirm}
                    onClick={() => selected !== null && onConfirm(selected)}
                >
                    <Checkmark24Filled />
                </button>
            </div>
        </section>
    );
};

export default SceneTypeSelector;
