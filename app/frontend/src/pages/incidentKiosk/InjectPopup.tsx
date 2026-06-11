/**
 * InjectPopup — "Add Inject" modal for the Fire Officer kiosk.
 *
 * Lets the operator feed a new segment of radio chatter into a running incident by typing /
 * pasting it, or narrating it with the mic (browser STT via DictationButton). The text is
 * handed back via `onInject`; the kiosk appends it to the accumulated transcript and
 * re-validates. Works for ANY scenario — injects are not tied to a pre-scripted phases array.
 *
 * File selection was deliberately removed (Dave, 2026-06-11): injects are text/voice only,
 * matching the production trajectory where all scene input arrives as speech-to-text.
 */

import { useState } from "react";
import { Body1, Button, Caption1, Title3 } from "@fluentui/react-components";

import DictationButton, { isDictationSupported } from "../../components/DictationButton";

interface InjectPopupProps {
    open: boolean;
    onClose: () => void;
    /** Called with the inject text. The kiosk appends + re-validates. */
    onInject: (text: string) => void;
}

const InjectPopup = ({ open, onClose, onInject }: InjectPopupProps) => {
    const [text, setText] = useState("");
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    const handleInject = () => {
        if (!text.trim()) {
            setError("Type, paste, or narrate the next segment of radio chatter first.");
            return;
        }
        onInject(text);
        setText("");
        setError(null);
        onClose();
    };

    const handleCancel = () => {
        setError(null);
        onClose();
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Add Inject"
            onClick={handleCancel}
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
                    minWidth: 420,
                    maxWidth: 560,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.6)"
                }}
            >
                <Title3>Add Inject</Title3>
                <Caption1 style={{ display: "block", margin: "8px 0 12px", opacity: 0.8 }}>
                    Type or paste the next segment of radio chatter — or narrate it with the mic. It is appended to
                    the incident transcript and the scene is re-validated.
                </Caption1>
                <textarea
                    autoFocus
                    value={text}
                    onChange={e => {
                        setText(e.target.value);
                        if (error) setError(null);
                    }}
                    placeholder="Injection narrative…"
                    style={{
                        width: "100%",
                        minHeight: 140,
                        fontFamily: "monospace",
                        fontSize: "0.85rem",
                        padding: 8,
                        boxSizing: "border-box",
                        background: "#161616",
                        color: "#f3f3f3",
                        border: "1px solid #444",
                        borderRadius: 6
                    }}
                />
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                    <DictationButton
                        getBaseText={() => text}
                        onTextChange={t => {
                            setText(t);
                            if (error) setError(null);
                        }}
                        onError={setError}
                    />
                    {!isDictationSupported() && (
                        <span style={{ fontSize: "0.78rem", opacity: 0.7 }}>
                            Voice input needs Chrome or Edge — typing/pasting works everywhere.
                        </span>
                    )}
                </div>
                {error && <Body1 style={{ display: "block", marginTop: 12, color: "#fca5a5" }}>{error}</Body1>}
                <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Button appearance="subtle" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button appearance="primary" onClick={handleInject} disabled={!text.trim()}>
                        Inject
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default InjectPopup;
