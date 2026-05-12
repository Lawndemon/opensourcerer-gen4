/**
 * FormTabStrip — per-role ICS form tabs along the bottom of the kiosk.
 *
 * Fire Officer's tab strip: ICS 201 + 2 role-specific placeholders (`AIPform1`, `AIPform2`).
 * Tabs "pop up" / open a preview panel when poked. In this iteration we render the strip and
 * a read-only preview panel for whichever tab is open — full form generation, structured
 * field layout matching the real ICS 201, and editability all land in Session 4.
 *
 * Forms passed in already carry the right structure from the backend's ValidateIAPResponse;
 * we just render `content` as a JSON-ish read-only view for the prototype.
 */

import { useState } from "react";
import { Badge, Body1, Caption1 } from "@fluentui/react-components";

import type { FormSummary } from "../../api/incidentTypes";

import styles from "./FormTabStrip.module.css";

interface FormTabStripProps {
    forms: FormSummary[];
    /** If true, all forms render as locked/read-only (Loss Stop has been pressed). */
    locked?: boolean;
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
                <div className={styles.field}>
                    <Caption1 className={styles.fieldLabel}>Situation summary</Caption1>
                    <Body1>{c.situationSummary || "—"}</Body1>
                </div>
                <div className={styles.field}>
                    <Caption1 className={styles.fieldLabel}>Current objectives</Caption1>
                    <Body1>{c.currentObjectives || "—"}</Body1>
                </div>
                <div className={styles.field}>
                    <Caption1 className={styles.fieldLabel}>Current actions</Caption1>
                    <Body1>{c.currentActions || "—"}</Body1>
                </div>
                <div className={styles.field}>
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

const FormTabStrip = ({ forms, locked = false }: FormTabStripProps) => {
    const [openFormId, setOpenFormId] = useState<string | null>(null);

    if (forms.length === 0) {
        return (
            <div className={styles.emptyStrip}>
                <Caption1>No forms attached to this incident yet.</Caption1>
            </div>
        );
    }

    const openForm = forms.find(f => f.formId === openFormId) ?? null;

    return (
        <div className={styles.wrapper}>
            {openForm && (
                <div className={styles.previewPanel}>
                    <div className={styles.previewHeader}>
                        <div>
                            <Caption1 className={styles.formTypeLabel}>{openForm.title}</Caption1>
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
                    <div className={styles.previewBody}>{renderFormContent(openForm)}</div>
                </div>
            )}
            <div className={styles.tabRow} role="tablist">
                {forms.map(f => {
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
                            <span className={styles.tabTitle}>{f.title}</span>
                            <span
                                className={`${styles.tabStatus} ${
                                    f.status === "locked" || locked ? styles.tabStatusLocked : ""
                                }`}
                            >
                                {f.status === "locked" || locked ? "locked" : "active"}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default FormTabStrip;
