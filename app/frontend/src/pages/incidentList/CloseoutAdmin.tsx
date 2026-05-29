/**
 * CloseoutAdmin — per-incident cleanup & reporting page for IC and Site-Administrator.
 *
 * Three-step workflow (SME, 2026-05-27):
 *   1. Update all reports — fan out extract-forms across every form-bearing role.
 *   2. Edit reports     — basic per-section/per-field text edit on each role's forms.
 *   3. Close out + lock — terminal seal. After lock, all mutation endpoints reject (423).
 *
 * This page is the **cleanup and corporate/municipal/federal reporting** surface — distinct
 * from Loss Stop (which already freezes the scene) and from the existing Close Incident
 * (lifecycle response→recovery). It can happen days after the callout.
 *
 * Faithful per-form layouts + matching PDFs come with the SME-provided ICS forms work later;
 * v1 edits operate on the structures we already have (ICS201Content fields + placeholder
 * sections).
 */

import { useCallback, useEffect, useState } from "react";
import { Body1, Button, Caption1, Field, Spinner, Textarea, Title2, Title3 } from "@fluentui/react-components";
import { ArrowLeft24Regular, ArrowSync24Regular, LockClosed24Regular } from "@fluentui/react-icons";

import { extractForms, formPdfDownloadUrl, getIcsFormSchemas, getIncident, lockIncident, saveFormContent } from "../../api/incidents";
import type { FormContent, FormFieldsContent, FormSummary, ICS201Content, IcsFormSchemas, IncidentDocument, PlaceholderFormContent } from "../../api/incidentTypes";
import { ACTING_ROLES, getRoleDefinition } from "../../roles";
import type { ActingRole } from "../../roles";

// Roles whose forms participate in update-all. Site-administrator has no scene-driven forms.
const ROLES_WITH_FORMS = ACTING_ROLES.filter(r => r.id !== "site-administrator").map(r => r.id);

interface CloseoutAdminProps {
    incident: IncidentDocument;
    actingRole: ActingRole | string;
    onBack: () => void;
    onIncidentChange: (incident: IncidentDocument) => void;
}

const CloseoutAdmin = ({ incident, actingRole, onBack, onIncidentChange }: CloseoutAdminProps) => {
    const [updating, setUpdating] = useState(false);
    const [updateError, setUpdateError] = useState<string | null>(null);
    const [lockBusy, setLockBusy] = useState(false);
    const [lockError, setLockError] = useState<string | null>(null);
    const [confirmingLock, setConfirmingLock] = useState(false);
    const [schemas, setSchemas] = useState<IcsFormSchemas | null>(null);

    // Load the ICS PDF schemas once on mount. Drives the generic field editor below.
    useEffect(() => {
        let cancelled = false;
        getIcsFormSchemas()
            .then(s => { if (!cancelled) setSchemas(s); })
            .catch(() => { /* non-fatal: form_fields editor will show a fallback */ });
        return () => { cancelled = true; };
    }, []);

    const isLocked = incident.lockedAt != null;

    // --- Step 1: Update all reports ---------------------------------------
    const handleUpdateAll = useCallback(async () => {
        if (updating || isLocked) return;
        setUpdating(true);
        setUpdateError(null);
        try {
            // Fan out per role in parallel; per-role failures are non-fatal (some roles may
            // have no templates yet — that's not a real error in v1).
            await Promise.all(
                ROLES_WITH_FORMS.map(role =>
                    extractForms(incident.id, { actingRole: role }).catch(() => null)
                )
            );
            const fresh = await getIncident(incident.id);
            onIncidentChange(fresh);
        } catch (e) {
            setUpdateError(e instanceof Error ? e.message : "Update all reports failed.");
        } finally {
            setUpdating(false);
        }
    }, [updating, isLocked, incident.id, onIncidentChange]);

    // --- Step 3: Close out + lock -----------------------------------------
    const handleLock = useCallback(async () => {
        if (lockBusy || isLocked) return;
        setLockBusy(true);
        setLockError(null);
        try {
            const updated = await lockIncident(incident.id, { actingRole, userId: "closeout" });
            onIncidentChange(updated);
            setConfirmingLock(false);
        } catch (e) {
            setLockError(e instanceof Error ? e.message : "Lock event failed.");
        } finally {
            setLockBusy(false);
        }
    }, [lockBusy, isLocked, incident.id, actingRole, onIncidentChange]);

    return (
        <div style={{ padding: "16px 24px", maxWidth: 1100, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={onBack}>
                    Back to incident
                </Button>
                <Title2>Closeout &amp; reporting</Title2>
            </div>
            <Caption1 style={{ display: "block", marginBottom: 16 }}>
                Final cleanup workflow for the IC and Site Administrator. Update reports, edit as needed, then close out and lock the event for the official record. Once locked, no further changes are accepted.
            </Caption1>

            {isLocked && (
                <div
                    style={{
                        padding: "10px 14px",
                        margin: "0 0 16px",
                        borderRadius: 6,
                        background: "#FDECEA",
                        border: "1px solid #C62828",
                        color: "#7A1F1A",
                        fontWeight: 600
                    }}
                >
                    🔒 Event locked
                    {incident.lockedAt ? ` on ${new Date(incident.lockedAt).toLocaleString()}` : ""}
                    {incident.lockedBy ? ` by ${incident.lockedBy.role}` : ""}. No further changes can be made.
                </div>
            )}

            {/* ---- Step 1 ---- */}
            <section style={{ padding: "14px 18px", border: "1px solid #DDD", borderRadius: 8, marginBottom: 14 }}>
                <Title3>Step 1 — Update all reports</Title3>
                <Body1 style={{ display: "block", margin: "4px 0 10px" }}>
                    Regenerates every role&apos;s reports from the current scene state. Use this before editing so you&apos;re working from the latest content.
                </Body1>
                <Button
                    appearance="primary"
                    icon={updating ? <Spinner size="tiny" /> : <ArrowSync24Regular />}
                    onClick={handleUpdateAll}
                    disabled={updating || isLocked}
                >
                    {updating ? "Updating…" : "Update all reports"}
                </Button>
                {updateError && <Caption1 style={{ display: "block", color: "#C62828", marginTop: 8 }}>{updateError}</Caption1>}
            </section>

            {/* ---- Step 2: per-form edit ---- */}
            <section style={{ padding: "14px 18px", border: "1px solid #DDD", borderRadius: 8, marginBottom: 14 }}>
                <Title3>Step 2 — Edit reports</Title3>
                <Body1 style={{ display: "block", margin: "4px 0 10px" }}>
                    Adjust any report&apos;s text before sealing. Faithful per-form layouts and matching PDFs will land with the SME-supplied templates; for now you can revise the field/section text.
                </Body1>
                {incident.forms.length === 0 ? (
                    <Body1 style={{ color: "#666" }}>No reports yet. Run Step 1 first.</Body1>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {incident.forms.map(form => (
                            <FormEditor
                                key={form.formId}
                                form={form}
                                incidentId={incident.id}
                                actingRole={actingRole}
                                disabled={isLocked}
                                onSaved={onIncidentChange}
                                schemas={schemas}
                            />
                        ))}
                    </div>
                )}
            </section>

            {/* ---- Step 3 ---- */}
            <section style={{ padding: "14px 18px", border: "1px solid #DDD", borderRadius: 8, marginBottom: 24 }}>
                <Title3>Step 3 — Close out &amp; lock event</Title3>
                <Body1 style={{ display: "block", margin: "4px 0 10px" }}>
                    Terminal seal. Once locked, the incident becomes the immutable corporate / municipal / federal record. There is no unlock action.
                </Body1>
                {isLocked ? (
                    <Body1 style={{ color: "#7A1F1A", fontWeight: 600 }}>This event is already locked.</Body1>
                ) : !confirmingLock ? (
                    <Button appearance="primary" icon={<LockClosed24Regular />} onClick={() => setConfirmingLock(true)}>
                        Close out &amp; lock event
                    </Button>
                ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Body1>Confirm: lock this event permanently?</Body1>
                        <Button appearance="primary" onClick={() => void handleLock()} disabled={lockBusy}>
                            {lockBusy ? "Locking…" : "Yes, lock event"}
                        </Button>
                        <Button onClick={() => setConfirmingLock(false)} disabled={lockBusy}>
                            Cancel
                        </Button>
                    </div>
                )}
                {lockError && <Caption1 style={{ display: "block", color: "#C62828", marginTop: 8 }}>{lockError}</Caption1>}
            </section>
        </div>
    );
};

// --------------------------------------------------------------------------
// FormEditor — per-form text editing for ICS201 (named fields) or placeholder (sections)
// --------------------------------------------------------------------------

interface FormEditorProps {
    form: FormSummary;
    incidentId: string;
    actingRole: ActingRole | string;
    disabled: boolean;
    onSaved: (incident: IncidentDocument) => void;
    schemas: IcsFormSchemas | null;
}

const FormEditor = ({ form, incidentId, actingRole, disabled, onSaved, schemas }: FormEditorProps) => {
    const [content, setContent] = useState<FormContent>(form.content);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);

    const roleDef = (() => {
        try { return getRoleDefinition(form.role as ActingRole); }
        catch { return { displayName: form.role, id: form.role, category: "field" as const, description: "" }; }
    })();

    const dirty = JSON.stringify(content) !== JSON.stringify(form.content);

    const handleSave = useCallback(async () => {
        if (!dirty || saving || disabled) return;
        setSaving(true);
        setError(null);
        try {
            const updated = await saveFormContent(incidentId, form.formId, {
                content,
                actingRole,
                userId: "closeout"
            });
            onSaved(updated);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed.");
        } finally {
            setSaving(false);
        }
    }, [dirty, saving, disabled, incidentId, form.formId, content, actingRole, onSaved]);

    return (
        <div style={{ border: "1px solid #E6E6E6", borderRadius: 6, padding: "10px 12px" }}>
            <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(e => !e)}
                onKeyDown={e => { if (e.key === "Enter") setExpanded(x => !x); }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            >
                <div>
                    <strong>{form.title}</strong>
                    <Caption1 style={{ marginLeft: 8, color: "#666" }}>{roleDef.displayName}</Caption1>
                </div>
                <Caption1 style={{ color: "#666" }}>{expanded ? "Hide" : "Edit"}</Caption1>
            </div>
            {expanded && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                    {content.kind === "form_fields" ? (
                        <FormFieldsFields content={content} disabled={disabled} schemas={schemas} onChange={setContent} />
                    ) : content.kind === "ics_201" ? (
                        <ICS201Fields content={content} disabled={disabled} onChange={setContent} />
                    ) : (
                        <PlaceholderFields content={content} disabled={disabled} onChange={setContent} />
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Button appearance="primary" onClick={() => void handleSave()} disabled={!dirty || saving || disabled}>
                            {saving ? "Saving…" : "Save"}
                        </Button>
                        {content.kind === "form_fields" && (
                            <Button
                                appearance="secondary"
                                onClick={() => window.open(formPdfDownloadUrl(incidentId, form.formId), "_blank")}
                                disabled={dirty}
                                title={dirty ? "Save changes first" : "Download as the official ICS Canada PDF"}
                            >
                                Download PDF
                            </Button>
                        )}
                        {dirty && <Caption1 style={{ color: "#7A5B00" }}>Unsaved changes</Caption1>}
                        {error && <Caption1 style={{ color: "#C62828" }}>{error}</Caption1>}
                    </div>
                </div>
            )}
        </div>
    );
};

const ICS201Fields = ({
    content,
    disabled,
    onChange
}: {
    content: ICS201Content;
    disabled: boolean;
    onChange: (c: ICS201Content) => void;
}) => {
    const set = (k: keyof ICS201Content, v: string) => onChange({ ...content, [k]: v });
    const longField = (label: string, key: keyof ICS201Content) => (
        <Field label={label}>
            <Textarea
                value={String(content[key] ?? "")}
                disabled={disabled}
                onChange={(_, data) => set(key, data.value)}
                rows={3}
            />
        </Field>
    );
    const shortField = (label: string, key: keyof ICS201Content) => (
        <Field label={label}>
            <Textarea
                value={String(content[key] ?? "")}
                disabled={disabled}
                onChange={(_, data) => set(key, data.value)}
                rows={1}
            />
        </Field>
    );
    return (
        <>
            {shortField("Incident name", "incidentName")}
            {shortField("Date/Time initiated", "dateTimeInitiated")}
            {longField("Situation summary", "situationSummary")}
            {longField("Current objectives", "currentObjectives")}
            {longField("Current actions", "currentActions")}
            {longField("Resource summary", "resourceSummary")}
            {shortField("Prepared by", "preparedBy")}
        </>
    );
};

const FormFieldsFields = ({
    content,
    disabled,
    schemas,
    onChange
}: {
    content: FormFieldsContent;
    disabled: boolean;
    schemas: IcsFormSchemas | null;
    onChange: (c: FormFieldsContent) => void;
}) => {
    const schema = schemas?.[content.formIdKey];
    if (!schemas) {
        return <Caption1 style={{ color: "#666" }}>Loading form schema…</Caption1>;
    }
    if (!schema) {
        return <Caption1 style={{ color: "#C62828" }}>No schema found for form id &ldquo;{content.formIdKey}&rdquo;.</Caption1>;
    }
    const setField = (name: string, value: string) =>
        onChange({ ...content, fields: { ...content.fields, [name]: value } });
    return (
        <>
            <Caption1 style={{ color: "#666", display: "block", marginBottom: 6 }}>
                {schema.fieldCount} fields · {schema.pageCount} page(s) · official template
            </Caption1>
            {schema.fields.map((f, idx) => (
                <Field key={`${f.name}-${idx}`} label={f.label || f.name || "(unnamed field)"}>
                    <Textarea
                        value={content.fields[f.name] ?? ""}
                        disabled={disabled}
                        onChange={(_, data) => setField(f.name, data.value)}
                        rows={1}
                    />
                </Field>
            ))}
        </>
    );
};

const PlaceholderFields = ({
    content,
    disabled,
    onChange
}: {
    content: PlaceholderFormContent;
    disabled: boolean;
    onChange: (c: PlaceholderFormContent) => void;
}) => {
    const setSection = (idx: number, key: "heading" | "body", v: string) => {
        const next = content.sections.map((s, i) => (i === idx ? { ...s, [key]: v } : s));
        onChange({ ...content, sections: next });
    };
    return (
        <>
            {content.sections.length === 0 ? (
                <Caption1 style={{ color: "#666" }}>No sections to edit yet.</Caption1>
            ) : (
                content.sections.map((s, idx) => (
                    <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <Field label="Heading">
                            <Textarea
                                value={s.heading}
                                disabled={disabled}
                                onChange={(_, data) => setSection(idx, "heading", data.value)}
                                rows={1}
                            />
                        </Field>
                        <Field label="Body">
                            <Textarea
                                value={s.body}
                                disabled={disabled}
                                onChange={(_, data) => setSection(idx, "body", data.value)}
                                rows={4}
                            />
                        </Field>
                    </div>
                ))
            )}
        </>
    );
};

export default CloseoutAdmin;
