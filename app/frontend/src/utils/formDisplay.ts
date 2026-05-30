/**
 * Display helpers for ICS form labels.
 *
 * SME (via Dave, 2026-05-29): tab labels should lead with the form number, e.g.
 * "ICS201 - Incident Briefing" not just "Incident Briefing". The form_type values
 * we ship use the official hyphenated form ("ICS-201", "ICS-215A", "OF-288"); the
 * SME's preferred compact display drops the internal hyphen ("ICS201"), so this
 * helper normalizes the prefix on the display side without changing the canonical
 * form_type used by the backend / API.
 *
 * `formType` lives on `FormSummary.content` (each FormContent variant carries it),
 * not at the top level — so the helper takes the surrounding form + reads
 * `content.formType`.
 */

export interface FormLabelShape {
    title: string;
    content: { formType: string };
}

/** Format as "ICS201 - Incident Briefing" (compact form_type prefix + title). */
export function formatFormLabel(form: FormLabelShape): string {
    const compactType = form.content.formType.replace("-", "");
    return `${compactType} - ${form.title}`;
}
