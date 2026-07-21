/**
 * FormTabStrip — per-role ICS form tabs along the bottom of the kiosk / support view.
 *
 * Excel-sheet-tab paradigm per Dave's structural feedback (2026-05-12):
 *   - Thin tab strip at the very bottom of the screen.
 *   - Tapping a tab opens a near-full-screen overlay showing the report.
 *   - **Single tap anywhere on the overlay minimizes it back to the strip.** No close
 *     button — kiosk-friendly. The whole overlay is the close-target.
 *
 * Role filtering (5d, 2026-05-19; revised 2026-05-29): the backend generates role-tagged
 * forms with **variable per-role counts** per ICS Canada doctrine (see
 * app/backend/incidents/form_templates.py — FO has 3, IC has 6, Liaison has 2, etc.). This
 * component filters `forms[]` to those matching `currentRole` so each role sees only their
 * own forms. Pass `currentRole={null}` to show every form (useful for an admin cross-role
 * view down the road).
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Body1, Button, Caption1, Field, Textarea } from "@fluentui/react-components";

import { formPdfDownloadUrl, getIcsFormSchemas, saveFormContent } from "../../api/incidents";
import type { FormSummary, IcsFormSchemas, IncidentDocument } from "../../api/incidentTypes";
import type { ActingRole } from "../../roles";
import { groupFieldsByRow } from "../../utils/formFieldGrouping";
import { formatFormLabel } from "../../utils/formDisplay";

import styles from "./FormTabStrip.module.css";

interface FormTabStripProps {
    forms: FormSummary[];
    /**
     * Filter forms to those tagged with this role. Pass null/undefined to show every
     * form regardless of role.
     */
    currentRole?: string | null;
    /** If true, all forms render as locked/read-only (Loss Stop has been pressed). */
    locked?: boolean;
    /**
     * True while a background forms-extraction is in flight (5d.1). When there are no
     * forms to show yet, the empty state reads "Generating forms…" instead of "none".
     */
    generating?: boolean;
    /**
     * If true, form_fields content offers an "Edit fields" flip into the inline field
     * editor (with Save + Download PDF buttons). Used on non-FO kiosks (IC + support
     * views). The FO kiosk leaves this off and uses CloseoutAdmin for form editing.
     */
    editable?: boolean;
    /**
     * Enables the PDF-first overlay for form_fields forms (the populated official ICS
     * Canada PDF renders embedded when a tab opens — Dave, 2026-07-21: "the PDF is the
     * thing"). Required when editable=true (save endpoint) and for PDF render/download.
     * Ephemeral (unpersisted) incidents omit it and fall back to the summary card.
     */
    incidentId?: string;
    /** Required when editable=true — recorded on the form_content_edited audit event. */
    actingRole?: ActingRole | string;
    /** Called after a successful save with the updated incident document. */
    onSaved?: (incident: IncidentDocument) => void;
}

const renderFormContent = (form: FormSummary) => {
    if (form.content.kind === "ics_201") {
        const c = form.content;
        return (
            <div className={styles.ics201}>
                <div className={styles.field}>
                    <Caption1 className={styles.fieldLabel}>Incident name</Caption1>
                    <Body1>{c.incidentName || "—"}</Body1>
                </div>
                <div className={styles.field}>
                    <Caption1 className={styles.fieldLabel}>Date / time initiated</Caption1>
                    <Body1>{c.dateTimeInitiated || "—"}</Body1>
                </div>
                <div className={styles.fieldFull}>
                    <Caption1 className={styles.fieldLabel}>Situation summary</Caption1>
                    <Body1>{c.situationSummary || "—"}</Body1>
                </div>
                <div className={styles.fieldFull}>
                    <Caption1 className={styles.fieldLabel}>Current objectives</Caption1>
                    <Body1>{c.currentObjectives || "—"}</Body1>
                </div>
                <div className={styles.fieldFull}>
                    <Caption1 className={styles.fieldLabel}>Current actions</Caption1>
                    <Body1>{c.currentActions || "—"}</Body1>
                </div>
                <div className={styles.fieldFull}>
                    <Caption1 className={styles.fieldLabel}>Resource summary</Caption1>
                    <Body1>{c.resourceSummary || "—"}</Body1>
                </div>
                <div className={styles.field}>
                    <Caption1 className={styles.fieldLabel}>Prepared by</Caption1>
                    <Body1>{c.preparedBy || "—"}</Body1>
                </div>
            </div>
        );
    }
    if (form.content.kind === "form_fields") {
        // Fallback card for unpersisted incidents only — persisted incidents render the
        // populated official PDF instead (see the pdfPane branch in the overlay).
        const filled = Object.values(form.content.fields).filter(v => (v ?? "").trim().length > 0).length;
        const total = Object.keys(form.content.fields).length;
        return (
            <div className={styles.placeholderForm}>
                <Caption1 className={styles.fieldLabel}>{form.content.formType}</Caption1>
                <Body1 className={styles.empty}>
                    Official ICS Canada template{total > 0 ? ` — ${filled}/${total} fields filled` : ""}. The filled PDF renders here once the incident is persisted.
                </Body1>
            </div>
        );
    }
    return (
        <div className={styles.placeholderForm}>
            <Caption1 className={styles.fieldLabel}>{form.content.title}</Caption1>
            {form.content.sections.length === 0 ? (
                <Body1 className={styles.empty}>
                    Placeholder form — content arrives in a later session.
                </Body1>
            ) : (
                form.content.sections.map((s, i) => (
                    <div key={i} className={styles.field}>
                        <Caption1 className={styles.fieldLabel}>{s.heading}</Caption1>
                        <Body1>{s.body}</Body1>
                    </div>
                ))
            )}
        </div>
    );
};

const FormTabStrip = ({ forms, currentRole, locked = false, generating = false, editable = false, incidentId, actingRole, onSaved }: FormTabStripProps) => {
    const [openFormId, setOpenFormId] = useState<string | null>(null);
    const [schemas, setSchemas] = useState<IcsFormSchemas | null>(null);
    const [editingFields, setEditingFields] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    // PDF-first (2026-07-21): form_fields tabs open on the populated official PDF; the
    // inline field editor is an explicit flip (support roles only), not the default.
    const [showEditor, setShowEditor] = useState(false);

    // Load schemas once on mount when editable. Drives the inline field editor for form_fields.
    useEffect(() => {
        if (!editable) return;
        let cancelled = false;
        getIcsFormSchemas()
            .then(s => { if (!cancelled) setSchemas(s); })
            .catch(() => { /* non-fatal: fallback message shows */ });
        return () => { cancelled = true; };
    }, [editable]);

    const visibleForms = useMemo(
        () => (currentRole ? forms.filter(f => f.role === currentRole) : forms),
        [forms, currentRole]
    );

    if (visibleForms.length === 0) {
        return (
            <div className={styles.emptyStrip}>
                <Caption1>
                    {generating
                        ? "Generating forms…"
                        : currentRole
                          ? "No forms assigned to this role on this incident yet."
                          : "No forms attached to this incident yet."}
                </Caption1>
            </div>
        );
    }

    const openForm = visibleForms.find(f => f.formId === openFormId) ?? null;

    return (
        <>
            {/* Excel-style tab strip pinned to the bottom of the dashboard area. */}
            <div className={styles.tabRow} role="tablist">
                {visibleForms.map(f => {
                    const isOpen = f.formId === openFormId;
                    return (
                        <button
                            key={f.formId}
                            type="button"
                            role="tab"
                            aria-selected={isOpen}
                            className={`${styles.tab} ${isOpen ? styles.tabOpen : ""}`}
                            onClick={() => {
                                setOpenFormId(isOpen ? null : f.formId);
                                setShowEditor(false);
                            }}
                        >
                            <span className={styles.tabTitle}>{formatFormLabel(f)}</span>
                        </button>
                    );
                })}
            </div>

            {/*
                Full-screen overlay when a form is open. The whole overlay is the
                close target — single tap anywhere collapses it back to the strip.
                Inner content also gets the same handler so any tap dismisses; we
                stopPropagation on nothing because we want the simplest possible
                kiosk gesture.
            */}
            {openForm && (
                <div
                    className={styles.overlay}
                    role="dialog"
                    aria-label={openForm.title}
                    onClick={() => setOpenFormId(null)}
                >
                    <div className={styles.overlayCard}>
                        <div className={styles.overlayHeader}>
                            <div>
                                <Caption1 className={styles.formTypeLabel}>{formatFormLabel(openForm)}</Caption1>
                                <Body1 className={styles.formId}>{openForm.formId}</Body1>
                            </div>
                            <Badge
                                appearance="outline"
                                color={openForm.status === "locked" || locked ? "danger" : "success"}
                                size="small"
                            >
                                {openForm.status === "locked" || locked ? "Locked" : "Active"}
                            </Badge>
                        </div>
                        <div
                            className={styles.overlayBody}
                            onClick={openForm.content.kind === "form_fields" && incidentId ? e => e.stopPropagation() : undefined}
                        >
                            {openForm.content.kind === "form_fields" && incidentId && !showEditor ? (
                                /* PDF-first: the populated official ICS Canada form IS the view.
                                   lastUpdated in key + query string busts the browser cache after
                                   every regeneration/save. */
                                <div className={styles.pdfPane}>
                                    <div className={styles.pdfToolbar}>
                                        {editable && actingRole && (
                                            <Button appearance="secondary" size="small" onClick={() => setShowEditor(true)} disabled={locked}>
                                                Edit fields
                                            </Button>
                                        )}
                                        <Button
                                            appearance="secondary"
                                            size="small"
                                            onClick={() => window.open(formPdfDownloadUrl(incidentId, openForm.formId), "_blank")}
                                        >
                                            Open full screen
                                        </Button>
                                        <Caption1 className={styles.pdfHint}>Official ICS Canada form — populated from the incident</Caption1>
                                    </div>
                                    <iframe
                                        key={`${openForm.formId}-${openForm.lastUpdated}`}
                                        src={`${formPdfDownloadUrl(incidentId, openForm.formId)}?v=${encodeURIComponent(openForm.lastUpdated)}`}
                                        title={formatFormLabel(openForm)}
                                        className={styles.pdfFrame}
                                    />
                                </div>
                            ) : editable && openForm.content.kind === "form_fields" && incidentId && actingRole ? (
                                (() => {
                                    const ff = openForm.content;
                                    const schema = schemas?.[ff.formIdKey];
                                    if (!schemas) return <Caption1>Loading form schema…</Caption1>;
                                    if (!schema) return <Caption1>No schema for &ldquo;{ff.formIdKey}&rdquo;.</Caption1>;
                                    const current: Record<string, string> = { ...ff.fields, ...editingFields };
                                    const setField = (name: string, value: string) =>
                                        setEditingFields(prev => ({ ...prev, [name]: value }));
                                    const dirty = schema.fields.some(f => (current[f.name] ?? "") !== (ff.fields[f.name] ?? ""));
                                    const onSave = async () => {
                                        if (saving) return;
                                        setSaving(true); setSaveError(null);
                                        try {
                                            const merged: Record<string, string> = { ...ff.fields, ...editingFields };
                                            const updated = await saveFormContent(incidentId, openForm.formId, {
                                                content: { ...ff, fields: merged },
                                                actingRole,
                                                userId: "form-popup"
                                            });
                                            setEditingFields({});
                                            onSaved?.(updated);
                                            // Land back on the PDF so the editor is a detour, not a destination.
                                            setShowEditor(false);
                                        } catch (e) {
                                            setSaveError(e instanceof Error ? e.message : "Save failed.");
                                        } finally {
                                            setSaving(false);
                                        }
                                    };
                                    const grouped = groupFieldsByRow(schema.fields);
                                    return (
                                        <>
                                            <Caption1 style={{ color: "#666", display: "block", marginBottom: 8 }}>
                                                {schema.fieldCount} fields · {schema.pageCount} page(s) · official template
                                            </Caption1>
                                            {/* Header (non-row) fields first */}
                                            {grouped.unrowed.map(({ field: f, label }, idx) => (
                                                <Field key={`${f.name}-${idx}`} label={label || "(unnamed field)"}>
                                                    <Textarea
                                                        value={current[f.name] ?? ""}
                                                        disabled={saving || locked}
                                                        onChange={(_, data) => setField(f.name, data.value)}
                                                        rows={1}
                                                    />
                                                </Field>
                                            ))}
                                            {/* Tabular row groups (one section per row) */}
                                            {grouped.rows.map(row => (
                                                <div
                                                    key={`row-${row.rowNumber}`}
                                                    style={{
                                                        borderTop: "1px solid #E0E0E0",
                                                        paddingTop: 8,
                                                        marginTop: 12,
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: 6
                                                    }}
                                                >
                                                    <Caption1 style={{ color: "#555", fontWeight: 600 }}>
                                                        Row {row.rowNumber}
                                                    </Caption1>
                                                    {row.fields.map(({ field: f, baseLabel }, idx) => (
                                                        <Field
                                                            key={`${f.name}-${idx}`}
                                                            label={baseLabel || f.name || "(unnamed field)"}
                                                        >
                                                            <Textarea
                                                                value={current[f.name] ?? ""}
                                                                disabled={saving || locked}
                                                                onChange={(_, data) => setField(f.name, data.value)}
                                                                rows={1}
                                                            />
                                                        </Field>
                                                    ))}
                                                </div>
                                            ))}
                                            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                                                <Button appearance="primary" onClick={() => void onSave()} disabled={!dirty || saving || locked}>
                                                    {saving ? "Saving…" : "Save"}
                                                </Button>
                                                <Button
                                                    appearance="secondary"
                                                    onClick={() => { setEditingFields({}); setShowEditor(false); }}
                                                    disabled={saving}
                                                    title="Back to the populated PDF view (discards unsaved edits)"
                                                >
                                                    View PDF
                                                </Button>
                                                {dirty && <Caption1 style={{ color: "#7A5B00" }}>Unsaved changes</Caption1>}
                                                {saveError && <Caption1 style={{ color: "#C62828" }}>{saveError}</Caption1>}
                                            </div>
                                        </>
                                    );
                                })()
                            ) : (
                                renderFormContent(openForm)
                            )}
                        </div>
                        <div className={styles.overlayHint}>Tap anywhere to minimize</div>
                    </div>
                </div>
            )}
        </>
    );
};

export default FormTabStrip;
