/**
 * DictationButton — push-to-talk mic that dictates into a text field via the browser's
 * SpeechRecognition API (Chrome/Edge/Safari; webkit prefix handled).
 *
 * Derived from the upstream template's QuestionInput/SpeechInput, rebuilt for the kiosk:
 *  - APPENDS to the field's existing text instead of replacing it (narration on top of
 *    pasted/typed content).
 *  - continuous + interim results, and auto-restarts across the browser's silence
 *    timeouts so the operator can narrate with natural pauses until they tap stop.
 *  - No i18n dependency (kiosk is en-US), no alert() — errors surface via onError.
 *
 * PRODUCTION TRAJECTORY (BACKLOG → "Voice input / streaming STT"): production scene input
 * is all-voice via a streaming Azure STT pipeline (cognitive-services-speech-sdk). This
 * component is the swap point — keep the `onTextChange(composedText)` contract and replace
 * the browser engine with the streaming recognizer when that lands.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { Mic28Filled } from "@fluentui/react-icons";

interface DictationButtonProps {
    /** Receives the full composed text (base + finalized + interim speech) on every update. */
    onTextChange: (text: string) => void;
    /** Returns the field's current text when a dictation session starts — dictation appends to it. */
    getBaseText: () => string;
    disabled?: boolean;
    /** Recognition errors (mic permission, unsupported, etc.). "no-speech" is handled internally. */
    onError?: (message: string) => void;
}

/** True when the browser exposes a SpeechRecognition implementation. */
export function isDictationSupported(): boolean {
    return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export const DictationButton = ({ onTextChange, getBaseText, disabled, onError }: DictationButtonProps) => {
    const [recording, setRecording] = useState(false);
    const recognitionRef = useRef<any>(null);
    // Text composed so far: base (field content at session start, then rolled forward across
    // engine restarts) + finals (committed speech this engine run) + interim (in-flight words).
    const baseRef = useRef("");
    const finalsRef = useRef("");
    const recordingRef = useRef(false);

    const stop = useCallback(() => {
        recordingRef.current = false;
        setRecording(false);
        try {
            recognitionRef.current?.stop();
        } catch {
            /* already stopped */
        }
    }, []);

    // Stop cleanly if the component unmounts mid-dictation (e.g. popup closed).
    useEffect(() => stop, [stop]);

    const start = useCallback(() => {
        const Engine = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!Engine) {
            onError?.("Voice input is not supported in this browser — try Chrome or Edge.");
            return;
        }
        const base = getBaseText();
        // Separate a new narration from existing text with a newline (transcript-style).
        baseRef.current = base && !/\s$/.test(base) ? `${base}\n` : base;
        finalsRef.current = "";

        const recognition = new Engine();
        recognition.lang = "en-US";
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: any) => {
            let finals = "";
            let interim = "";
            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    finals += `${result[0].transcript} `;
                } else {
                    interim += result[0].transcript;
                }
            }
            finalsRef.current = finals;
            onTextChange(baseRef.current + finals + interim);
        };
        recognition.onend = () => {
            if (!recordingRef.current) return;
            // Browsers (notably Chrome) end the session after a silence timeout. Roll the
            // committed text into the base and restart so narration survives pauses.
            baseRef.current = baseRef.current + finalsRef.current;
            finalsRef.current = "";
            try {
                recognition.start();
            } catch {
                recordingRef.current = false;
                setRecording(false);
            }
        };
        recognition.onerror = (event: any) => {
            if (event.error === "no-speech" || event.error === "aborted") {
                return; // benign — the onend auto-restart (or a deliberate stop) covers these.
            }
            recordingRef.current = false;
            setRecording(false);
            onError?.(
                event.error === "not-allowed"
                    ? "Microphone access was blocked — allow mic permission and try again."
                    : `Voice input error: ${event.error}`
            );
        };

        recognitionRef.current = recognition;
        recordingRef.current = true;
        setRecording(true);
        recognition.start();
    }, [getBaseText, onTextChange, onError]);

    if (!isDictationSupported()) {
        return null;
    }
    return (
        <Tooltip content={recording ? "Stop narrating" : "Narrate with your voice"} relationship="label">
            <Button
                size="large"
                appearance={recording ? "primary" : "secondary"}
                disabled={disabled}
                icon={<Mic28Filled primaryFill={recording ? "rgba(250, 0, 0, 0.85)" : undefined} />}
                aria-label={recording ? "Stop narrating" : "Narrate with your voice"}
                onClick={recording ? stop : start}
            >
                {recording ? "Listening…" : "Narrate"}
            </Button>
        </Tooltip>
    );
};

export default DictationButton;
