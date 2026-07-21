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

import { useMemo, useState } from "react";
import { Badge, Body1, Button, Caption1 } from "@fluentui/react-components";

import { formPdfDownloadUrl } from "../../api/incidents";
import type { FormSummary, IncidentDocument } from "../../api/incidentTypes";
import type { ActingRole } from "../../roles";
import PdfFormViewer from "../../components/PdfFormViewer";
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
                            onClick={() => setOpenFormId(isOpen ? null : f.formId)}
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
                            {openForm.content.kind === "form_fields" && incidentId ? (
                                /* PDF-first + edit-in-place (2026-07-21): the populated official
                                   ICS Canada form renders via PdfFormViewer with editable field
                                   overlays. Saves harvest into Cosmos through saveFormContent, so
                                   edits are shared across roles and audit-logged — the old
                                   field-list editor is gone. */
                                <div className={styles.pdfPane}>
                                    <div className={styles.pdfToolbar}>
                                        <Button
                                            appearance="secondary"
                                            size="small"
                                            onClick={() => window.open(formPdfDownloadUrl(incidentId, openForm.formId), "_blank")}
                                        >
                                            Open full screen
                                        </Button>
                                        <Caption1 className={styles.pdfHint}>
                                            Official ICS Canada form — populated from the incident
                                            {editable && !locked && openForm.status !== "locked" ? "; type directly on the form" : ""}
                                        </Caption1>
                                    </div>
                                    <PdfFormViewer
                                        key={`${openForm.formId}-${openForm.lastUpdated}`}
                                        incidentId={incidentId}
                                        formId={openForm.formId}
                                        content={openForm.content}
                                        lastUpdated={openForm.lastUpdated}
                                        editable={editable && !locked && openForm.status !== "locked" && !!actingRole}
                                        actingRole={actingRole}
                                        onSaved={onSaved}
                                    />
                                </div>
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
