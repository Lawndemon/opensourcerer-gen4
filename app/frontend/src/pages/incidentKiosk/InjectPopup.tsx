/**
 * InjectPopup — "Add Inject" modal for the Fire Officer kiosk.
 *
 * Lets the operator feed a new segment of radio chatter into a running incident by selecting a
 * file (.txt / .md / .pdf / .docx). The extracted text is handed back via `onInject`, which the
 * kiosk appends to the accumulated transcript and re-validates. Works for ANY scenario — injects
 * are no longer tied to a pre-scripted phases array.
 *
 * Future (see BACKLOG.md): also offer a free-text box and a voice-input option in this popup.
 */

import { useState, type ChangeEvent } from "react";
import { Body1, Button, Caption1, Spinner, Title3 } from "@fluentui/react-components";

interface InjectPopupProps {
    open: boolean;
    onClose: () => void;
    /** Called with the extracted text of the chosen file. The kiosk appends + re-validates. */
    onInject: (text: string) => void;
}

/** Extract plain text from the chosen file. Binary formats (pdf/docx) go through the backend
 *  extractor; text formats are read client-side. Mirrors the pre-incident custom-transcript path. */
async function extractFileText(file: File): Promise<string> {
    const name = file.name.toLowerCase();
    const isBinary = name.endsWith(".pdf") || name.endsWith(".docx");
    if (isBinary) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/transcript/extract", { method: "POST", body: fd, credentials: "include" });
        if (!res.ok) {
            throw new Error(`Could not extract text from ${file.name}: ${res.status} ${await res.text()}`);
        }
        const { text } = (await res.json()) as { text: string };
        return text;
    }
    return await file.text();
}

const InjectPopup = ({ open, onClose, onInject }: InjectPopupProps) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setError(null);
        try {
            const text = await extractFileText(file);
            if (!text.trim()) {
                setError("That file appears to be empty — pick a file with radio chatter in it.");
                return;
            }
            onInject(text);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
            // Reset the input so re-selecting the same file fires onChange again.
            e.target.value = "";
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Add Inject"
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 100
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: "#1f1f1f",
                    color: "#f3f3f3",
                    padding: 24,
                    borderRadius: 10,
                    minWidth: 360,
                    maxWidth: 540,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.6)"
                }}
            >
                <Title3>Add Inject</Title3>
                <Caption1 style={{ display: "block", margin: "8px 0 16px", opacity: 0.8 }}>
                    Load the next segment of radio chatter from a file (.txt, .md, .pdf, .docx). It is appended to the
                    incident transcript and the scene is re-validated.
                </Caption1>
                <input
                    type="file"
                    accept=".txt,.md,.xml,.json,.pdf,.docx,text/plain,application/json,text/xml,application/xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleFile}
                    disabled={busy}
                />
                {busy && (
                    <div style={{ marginTop: 14 }}>
                        <Spinner size="tiny" label="Extracting…" />
                    </div>
                )}
                {error && (
                    <Body1 style={{ display: "block", marginTop: 14, color: "#fca5a5" }}>{error}</Body1>
                )}
                <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Button appearance="subtle" onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default InjectPopup;
