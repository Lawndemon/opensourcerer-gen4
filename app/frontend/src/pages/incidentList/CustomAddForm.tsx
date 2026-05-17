/**
 * CustomAddForm — text input + Add button for role-typed custom recommendations.
 *
 * Custom items land in the role's pending working set (source="custom") and still
 * require an explicit publish step before reaching the Fire Officer's kiosk — every
 * Fire-Officer-visible item is a deliberate decision (2026-05-13 spec).
 */

import { useState } from "react";
import { Button, Input, Spinner } from "@fluentui/react-components";
import { Add24Regular } from "@fluentui/react-icons";

import styles from "./CustomAddForm.module.css";

interface CustomAddFormProps {
    /** Add handler. Receives trimmed text. Should reject empty / pure-whitespace input. */
    onAdd: (text: string) => Promise<void>;
    /** Disabled state from the parent (e.g., incident not persisted, phase closed). */
    disabled?: boolean;
}

const CustomAddForm = ({ onAdd, disabled }: CustomAddFormProps) => {
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const trimmed = text.trim();
    const canSubmit = !disabled && !busy && trimmed.length > 0;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        try {
            await onAdd(trimmed);
            setText("");
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to add recommendation";
            setError(message);
        } finally {
            setBusy(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void handleSubmit();
        }
    };

    return (
        <div className={styles.form}>
            <div className={styles.inputRow}>
                <Input
                    className={styles.input}
                    placeholder="Add a custom support recommendation…"
                    value={text}
                    disabled={disabled || busy}
                    onChange={(_e, data) => setText(data.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Custom support recommendation text"
                />
                <Button
                    appearance="primary"
                    icon={busy ? <Spinner size="tiny" /> : <Add24Regular />}
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit}
                >
                    Add
                </Button>
            </div>
            {error && <div className={styles.error}>{error}</div>}
        </div>
    );
};

export default CustomAddForm;
