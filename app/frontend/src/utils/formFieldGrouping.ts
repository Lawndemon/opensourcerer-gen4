/**
 * Row-grouping helper for ICS AcroForm field rendering.
 *
 * Many ICS Canada forms are tabular (ICS-211 check-in list, ICS-214 activity log, ICS-215
 * planning worksheet, ICS-215A safety analysis) with a fixed set of columns repeated across
 * N rows. The AcroForm field names encode the row via a trailing "Row N" segment (e.g.
 * "Incident AreaRow1", "AgencyRow2", "MitigationsRow3"), and our schema-cleanup heuristic
 * turns those into "Incident Area (Row 1)" labels.
 *
 * Rendering those as a flat list of textareas loses the table semantics — the SME (via Dave,
 * 2026-05-29) flagged it: "row tag seems meaningless wrt/ form placement". This helper
 * groups fields by detected row number so editors can render row sections like:
 *
 *   Row 1: [Incident Area] [Hazards/Risks] [Mitigations]
 *   Row 2: [Incident Area] [Hazards/Risks] [Mitigations]
 *
 * Detection is label-based (matches the parenthesized "(Row N)" suffix our cleanup emits)
 * with two fallbacks for labels that survived without the parenthesized form.
 */

import type { IcsFormFieldDef } from "../api/incidentTypes";

export interface UnrowedEntry {
    field: IcsFormFieldDef;
    /** Display label (the field's `label` if present, else the raw name). */
    label: string;
}

export interface RowEntry {
    field: IcsFormFieldDef;
    /** Field's label stripped of the row suffix — e.g. "Incident Area (Row 1)" → "Incident Area". */
    baseLabel: string;
}

export interface RowGroup {
    rowNumber: number;
    fields: RowEntry[];
}

export interface GroupedFields {
    /** Header / non-row fields (Incident Name, Date Prepared, Prepared By, etc.). */
    unrowed: UnrowedEntry[];
    /** Row groups sorted by ascending row number. */
    rows: RowGroup[];
}

/**
 * Group the given fields into row sections.
 *
 * - Fields whose label ends in "(Row N)" / " Row N" / "RowN" are pulled into the
 *   corresponding row group (one group per distinct N).
 * - Within a row group, fields preserve their original schema order, which matches the
 *   PDF's left-to-right column order.
 * - Single-row groups are kept as rows (one row of N columns is still a table) rather than
 *   collapsed back into the unrowed list.
 */
export function groupFieldsByRow(fields: IcsFormFieldDef[]): GroupedFields {
    const unrowed: UnrowedEntry[] = [];
    const rowMap = new Map<number, RowEntry[]>();

    for (const field of fields) {
        const label = field.label || field.name || "";
        const parsed = parseRowSuffix(label);
        if (parsed) {
            const list = rowMap.get(parsed.row) ?? [];
            list.push({ field, baseLabel: parsed.base });
            rowMap.set(parsed.row, list);
        } else {
            unrowed.push({ field, label });
        }
    }

    const rows: RowGroup[] = Array.from(rowMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([rowNumber, rowFields]) => ({ rowNumber, fields: rowFields }));

    return { unrowed, rows };
}

/**
 * Returns the base label + row number if `label` ends with a row indicator, else null.
 *
 * Priority order matches the cleanup heuristic's expected outputs:
 *   1. "Foo (Row 3)"  ← parenthesized form (the cleanup's canonical output)
 *   2. "Foo Row 3"    ← space-separated fallback for less-processed labels
 *   3. "FooRow3"      ← squished fallback for raw field names that slipped through
 */
function parseRowSuffix(label: string): { base: string; row: number } | null {
    let m = label.match(/^(.*?)\s*\(Row\s+(\d+)\)\s*$/i);
    if (m) return { base: (m[1] || "").trim() || "Field", row: parseInt(m[2], 10) };
    m = label.match(/^(.*?)\s+Row\s+(\d+)\s*$/i);
    if (m) return { base: (m[1] || "").trim() || "Field", row: parseInt(m[2], 10) };
    m = label.match(/^(.*?)Row(\d+)\s*$/i);
    if (m) return { base: (m[1] || "").trim() || "Field", row: parseInt(m[2], 10) };
    return null;
}
