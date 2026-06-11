/**
 * CustomAddForm — text input + category selector + Add button for role-typed custom
 * recommendations.
 *
 * Custom items land in the role's pending working set (source="custom") and still
 * require an explicit publish step before reaching the Fire Officer's kiosk — every
 * Fire-Officer-visible item is a deliberate decision (2026-05-13 spec).
 *
 * Category selector (Dave QoL 2026-05-27): the human can tag the item's ICS urgency
 * (Life Safety / Incident Stabilization / Property Conservation) at add time so the kiosk
 * groups it under the right header. Left "Uncategorized" it falls into "Other", as before.
 */

import { useState } from "react";
import { Button, Input, Spinner } from "@fluentui/react-components";
import { Add24Regular } from "@fluentui/react-icons";

import type { RecommendationCategory } from "../../api/incidentTypes";
import styles from "./CustomAddForm.module.css";

interface CustomAddFormProps {
    /** Add handler. Receives trimmed text + chosen category (null = uncategorized). */
    onAdd: (text: string, category: RecommendationCategory | null) => Promise<void>;
    /** Disabled state from the parent (e.g., incident not persisted, phase closed). */
    disabled?: boolean;
}

const CATEGORY_OPTIONS: { value: RecommendationCategory; label: string }[] = [
    { value: "life_safety", label: "Life Safety" },
    { value: "incident_stabilization", label: "Incident Stabilization" },
    { value: "property_conservation", label: "Property Conservation" }
];

const CustomAddForm = ({ onAdd, disabled }: CustomAddFormProps) => {
    const [text, setText] = useState("");
    const [category, setCategory] = useState<RecommendationCategory | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const trimmed = text.trim();
    const canSubmit = !disabled && !busy && trimmed.length > 0;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        try {
            await onAdd(trimmed, category);
            setText("");
            setCategory(null);
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
                <select
                    value={category ?? ""}
                    disabled={disabled || busy}
                    onChange={e => setCategory(e.target.value === "" ? null : (e.target.value as RecommendationCategory))}
                    style={{ fontSize: "0.85rem", padding: "4px 6px" }}
                    aria-label="Recommendation urgency category"
                >
                    <option value="">Uncategorized</option>
                    {CATEGORY_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
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
