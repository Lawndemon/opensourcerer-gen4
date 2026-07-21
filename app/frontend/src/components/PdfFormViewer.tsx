/**
 * PdfFormViewer — renders a filled official ICS Canada form PDF with EDITABLE fields,
 * and harvests edits back into the incident record (Dave, 2026-07-21: "I like the UI
 * that comes with editing the PDFs directly but we need to harvest changes from them
 * so that the changes are shared across roles and logged in cosmos").
 *
 * Why not the browser's built-in PDF viewer (the previous iframe approach)? It's a
 * sealed plugin — the embedding page can never read what the user typed, so edits
 * were local-only and silently lost. Why not PDF.js's own AnnotationLayer forms? Its
 * API churns between majors and gives us little control. Instead:
 *
 *   1. PDF.js renders each page to a canvas with annotationMode ENABLE_FORMS, which
 *      deliberately SKIPS painting form-field contents onto the canvas (the official
 *      artwork — lines, labels, logos — still paints).
 *   2. We overlay absolutely-positioned HTML inputs (textarea / checkbox) at each
 *      field widget's rectangle, seeded from the incident's authoritative field map.
 *   3. Save merges the edited values over the form's stored fields and POSTs through
 *      the existing saveFormContent endpoint — Cosmos persistence, the
 *      form_content_edited audit event, and cross-role sharing via polling all ride
 *      the same rails as the old field editor.
 *
 * Read-only mode (FO kiosk voice-and-button doctrine; locked incidents) renders the
 * same overlay disabled with no tint.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Caption1 } from "@fluentui/react-components";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { IncidentApiError, formPdfDownloadUrl, getIncident, saveFormContent } from "../api/incidents";
import type { FormFieldsContent, IncidentDocument } from "../api/incidentTypes";
import { getBearerAuthHeaders } from "../authConfig";
import { getRoleDefinition } from "../roles";
import type { ActingRole } from "../roles";

/** Human-readable role name for conflict messages; falls back to the raw id. */
const roleDisplayName = (role: string | null | undefined): string => {
    if (!role) return "another user";
    if (role === "system") return "an automatic form regeneration";
    try {
        return `the ${getRoleDefinition(role as ActingRole).displayName}`;
    } catch {
        return `the ${role}`;
    }
};

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Truthy spellings for a checked checkbox — mirror of pdf_filler.py's _CHECKBOX_TRUTHY. */
const CHECKBOX_TRUTHY = new Set(["yes", "true", "checked", "x", "on", "1", "/yes"]);
const isChecked = (v: string | undefined) => CHECKBOX_TRUTHY.has((v ?? "").trim().toLowerCase());

interface FieldWidget {
    /** AcroForm fully-qualified field name — the key used by schemas.json + pdf_filler. */
    fieldName: string;
    kind: "text" | "checkbox";
    /** CSS rect within the page, in viewport pixels. */
    left: number;
    top: number;
    width: number;
    height: number;
}

interface RenderedPage {
    pageNumber: number;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
    widgets: FieldWidget[];
}

interface PdfFormViewerProps {
    incidentId: string;
    formId: string;
    content: FormFieldsContent;
    /** Cache-buster + reload trigger: pass the form's lastUpdated stamp. */
    lastUpdated: string;
    /** When false the overlay renders disabled (FO kiosk / locked incidents). */
    editable: boolean;
    actingRole?: string;
    onSaved?: (incident: IncidentDocument) => void;
}

const PdfFormViewer = ({ incidentId, formId, content, lastUpdated, editable, actingRole, onSaved }: PdfFormViewerProps) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [pages, setPages] = useState<RenderedPage[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    // Base = the persisted field map + its optimistic-concurrency stamp. Normally these
    // track the props; a 409 conflict rebases them onto the other editor's newer save
    // WITHOUT remounting, so this user's unsaved edits survive on top.
    const [baseFields, setBaseFields] = useState<Record<string, string>>(content.fields);
    const [baseStamp, setBaseStamp] = useState<string>(lastUpdated);

    // The authoritative field map (persisted base) + any local unsaved edits on top.
    const currentValues = useMemo(() => ({ ...baseFields, ...edits }), [baseFields, edits]);
    const dirty = Object.keys(edits).some(k => (edits[k] ?? "") !== (baseFields[k] ?? ""));

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        setPages([]);
        setEdits({});
        (async () => {
            try {
                const headers = await getBearerAuthHeaders();
                const res = await fetch(`${formPdfDownloadUrl(incidentId, formId)}?v=${encodeURIComponent(lastUpdated)}`, {
                    credentials: "include",
                    headers
                });
                if (!res.ok) throw new Error(`PDF fetch failed: HTTP ${res.status}`);
                const data = await res.arrayBuffer();
                if (cancelled) return;
                const pdf = await pdfjsLib.getDocument({ data }).promise;
                if (cancelled) return;

                // Fit-to-width against the container, capped so text stays crisp.
                const containerWidth = containerRef.current?.clientWidth ?? 900;
                const firstPage = await pdf.getPage(1);
                const baseWidth = firstPage.getViewport({ scale: 1 }).width;
                const scale = Math.min(1.8, Math.max(0.9, (containerWidth - 24) / baseWidth));

                const rendered: RenderedPage[] = [];
                for (let n = 1; n <= pdf.numPages; n++) {
                    const page = await pdf.getPage(n);
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement("canvas");
                    // Render at devicePixelRatio for sharpness, display at CSS size.
                    const dpr = window.devicePixelRatio || 1;
                    canvas.width = Math.floor(viewport.width * dpr);
                    canvas.height = Math.floor(viewport.height * dpr);
                    canvas.style.width = `${viewport.width}px`;
                    canvas.style.height = `${viewport.height}px`;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) throw new Error("Canvas 2D context unavailable");
                    await page.render({
                        canvas,
                        canvasContext: ctx,
                        viewport,
                        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
                        // ENABLE_FORMS skips painting widget contents on the canvas —
                        // our HTML overlay is the single source of field text.
                        annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS
                    }).promise;

                    const annotations = await page.getAnnotations();
                    const widgets: FieldWidget[] = [];
                    for (const a of annotations) {
                        if (a.subtype !== "Widget" || !a.fieldName) continue;
                        if (a.fieldType !== "Tx" && a.fieldType !== "Btn") continue; // skip signatures/choice
                        if (a.fieldType === "Btn" && (a.radioButton || a.pushButton)) continue;
                        const [rx1, ry1, rx2, ry2] = a.rect as number[];
                        const [x1, y1] = viewport.convertToViewportPoint(rx1, ry1);
                        const [x2, y2] = viewport.convertToViewportPoint(rx2, ry2);
                        widgets.push({
                            fieldName: a.fieldName as string,
                            kind: a.fieldType === "Btn" ? "checkbox" : "text",
                            left: Math.min(x1, x2),
                            top: Math.min(y1, y2),
                            width: Math.abs(x2 - x1),
                            height: Math.abs(y2 - y1)
                        });
                    }
                    rendered.push({ pageNumber: n, width: viewport.width, height: viewport.height, canvas, widgets });
                }
                if (!cancelled) {
                    setPages(rendered);
                    setLoading(false);
                }
            } catch (e) {
                if (!cancelled) {
                    setLoadError(e instanceof Error ? e.message : "Failed to render PDF.");
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [incidentId, formId, lastUpdated]);

    const setField = useCallback((name: string, value: string) => {
        setEdits(prev => ({ ...prev, [name]: value }));
    }, []);

    const onSave = async () => {
        if (saving || !dirty) return;
        setSaving(true);
        setSaveError(null);
        try {
            const merged = { ...baseFields, ...edits };
            const updated = await saveFormContent(incidentId, formId, {
                content: { ...content, fields: merged },
                actingRole: actingRole ?? "incident-commander",
                userId: "pdf-form-viewer",
                expectedLastUpdated: baseStamp
            });
            setEdits({});
            onSaved?.(updated);
        } catch (e) {
            // Graceful concurrent-edit handling (Dave, 2026-07-21): a 409 means someone
            // saved this form after we started editing. Rebase onto their version (kept
            // underneath), preserve this user's edits on top, and say who got there first.
            const conflictBody = e instanceof IncidentApiError && e.status === 409 ? (e.body as { conflict?: boolean; lastUpdatedBy?: string | null } | null) : null;
            if (conflictBody?.conflict) {
                try {
                    const fresh = await getIncident(incidentId);
                    const freshForm = fresh.forms.find(f => f.formId === formId);
                    if (freshForm && freshForm.content.kind === "form_fields") {
                        setBaseFields(freshForm.content.fields);
                        setBaseStamp(freshForm.lastUpdated);
                    }
                } catch {
                    /* rebase fetch failed — the message below still explains the situation */
                }
                setSaveError(
                    `This form was updated by ${roleDisplayName(conflictBody.lastUpdatedBy)} while you were editing. ` +
                        `Their changes are now loaded underneath yours — review the fields and Save again.`
                );
            } else {
                setSaveError(e instanceof Error ? e.message : "Save failed.");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div ref={containerRef} style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            {editable && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    <Button appearance="primary" size="small" onClick={() => void onSave()} disabled={!dirty || saving}>
                        {saving ? "Saving…" : "Save changes"}
                    </Button>
                    {dirty && <Caption1 style={{ color: "#E0B84C" }}>Unsaved edits — Save to share with all roles</Caption1>}
                    {!dirty && !saving && <Caption1 style={{ opacity: 0.55 }}>Type directly on the form, then Save</Caption1>}
                    {saveError && <Caption1 style={{ color: "#FF7A7A" }}>{saveError}</Caption1>}
                </div>
            )}
            {loading && <Caption1>Rendering official form…</Caption1>}
            {loadError && <Caption1 style={{ color: "#FF7A7A" }}>{loadError}</Caption1>}
            <div style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
                {pages.map(p => (
                    <div
                        key={p.pageNumber}
                        style={{ position: "relative", width: p.width, height: p.height, backgroundColor: "#fff", boxShadow: "0 2px 10px rgba(0,0,0,0.4)" }}
                        ref={el => {
                            // Mount the pre-rendered canvas once per page div.
                            if (el && p.canvas.parentElement !== el) {
                                el.insertBefore(p.canvas, el.firstChild);
                                p.canvas.style.position = "absolute";
                                p.canvas.style.left = "0";
                                p.canvas.style.top = "0";
                            }
                        }}
                    >
                        {p.widgets.map((w, i) =>
                            w.kind === "checkbox" ? (
                                <input
                                    key={`${w.fieldName}-${i}`}
                                    type="checkbox"
                                    checked={isChecked(currentValues[w.fieldName])}
                                    disabled={!editable}
                                    onChange={e => setField(w.fieldName, e.target.checked ? "Yes" : "")}
                                    title={w.fieldName}
                                    style={{
                                        position: "absolute",
                                        left: w.left,
                                        top: w.top,
                                        width: w.width,
                                        height: w.height,
                                        margin: 0,
                                        cursor: editable ? "pointer" : "default",
                                        accentColor: "#1a3a5a"
                                    }}
                                />
                            ) : (
                                <textarea
                                    key={`${w.fieldName}-${i}`}
                                    value={currentValues[w.fieldName] ?? ""}
                                    disabled={!editable}
                                    onChange={e => setField(w.fieldName, e.target.value)}
                                    title={w.fieldName}
                                    spellCheck={false}
                                    style={{
                                        position: "absolute",
                                        left: w.left,
                                        top: w.top,
                                        width: w.width,
                                        height: w.height,
                                        margin: 0,
                                        padding: "1px 2px",
                                        border: "none",
                                        outline: editable ? "1px dashed rgba(26,58,90,0.25)" : "none",
                                        outlineOffset: -1,
                                        resize: "none",
                                        overflow: "hidden",
                                        backgroundColor: editable ? "rgba(255,249,196,0.35)" : "transparent",
                                        color: "#111",
                                        fontFamily: "Helvetica, Arial, sans-serif",
                                        // Single-line boxes get a font that fills the box; tall boxes read as multiline.
                                        fontSize: Math.max(9, Math.min(13, w.height > 30 ? 12 : w.height * 0.62)),
                                        lineHeight: 1.25
                                    }}
                                />
                            )
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default PdfFormViewer;
