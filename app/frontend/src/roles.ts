/**
 * Role taxonomy and account-type model for opensourcerer-gen4.
 *
 * There are two distinct concepts in the role system, each on its own axis:
 *
 *  - AccountType: how a user signs in. Determines what login flow they see
 *    (which pickers, or none) and is derived from the Entra UPN for MVP.
 *    Real deployments would map this via Entra group membership or a Cosmos
 *    user record.
 *
 *  - ActingRole: the persona that drives RAG retrieval, system-prompt tone,
 *    and audit logging. One of 10 values, set at login and held for the
 *    session (stored in sessionStorage, not localStorage — intentional).
 *
 * Account type and acting role are related but not identical:
 *  - Some account types (firefighter, site_administrator, legacy per-role
 *    accounts) map directly to a single acting role — no picker shown.
 *  - Others (incident_management_team, generic_user) require the user to
 *    pick an acting role at login.
 *
 * See BACKLOG.md → "Event-level workflow and audit log" for the full design
 * rationale and the audit/immutability principles this file supports.
 */

/**
 * Account type — how a user enters the app.
 *
 * Derived from the UPN prefix in MVP. If a real deployment uses Entra groups
 * or Cosmos records for this instead, swap out `deriveAccountContext` below
 * without changing the rest of the app.
 */
export type AccountType =
    | "firefighter"
    | "incident_management_team"
    | "site_administrator"
    | "generic_user"
    | "direct_role";

/**
 * Acting role — the persona the user is acting as for this session.
 *
 * Drives:
 *  - RAG retrieval biasing (future: Task #6 — role-based document filtering)
 *  - System-prompt tone and assumed expertise level
 *  - Audit log entries on every chat/event action
 */
export type ActingRole =
    | "firefighter"
    | "incident-commander"
    | "safety-officer"
    | "liaison-officer"
    | "information-officer"
    | "section-chief-operations"
    | "section-chief-planning"
    | "section-chief-logistics"
    | "section-chief-finance"
    | "site-administrator";

/**
 * Display groups. Used to visually cluster roles in pickers.
 */
export type RoleCategory = "field" | "ics-command" | "ics-command-staff" | "ics-section-chief" | "admin";

export interface RoleDefinition {
    id: ActingRole;
    displayName: string;
    description: string;
    category: RoleCategory;
}

/**
 * Canonical list of all acting roles with display metadata.
 *
 * Edit this array to add, rename, or describe roles. This is the single
 * source of truth; other exports in this file derive from it.
 */
export const ACTING_ROLES: RoleDefinition[] = [
    {
        id: "firefighter",
        displayName: "Firefighter",
        description: "Field personnel responding to the incident.",
        category: "field"
    },
    {
        id: "incident-commander",
        displayName: "Incident Commander",
        description: "Overall authority and responsibility for the incident.",
        category: "ics-command"
    },
    {
        id: "safety-officer",
        displayName: "Safety Officer",
        description: "Monitors hazardous conditions and develops measures for responder safety.",
        category: "ics-command-staff"
    },
    {
        id: "liaison-officer",
        displayName: "Liaison Officer",
        description: "Primary contact for representatives of cooperating and assisting agencies.",
        category: "ics-command-staff"
    },
    {
        id: "information-officer",
        displayName: "Information Officer (PIO)",
        description: "Interfaces with media and public; manages information release.",
        category: "ics-command-staff"
    },
    {
        id: "section-chief-operations",
        displayName: "Section Chief — Operations",
        description: "Directs tactical operations carrying out the incident action plan.",
        category: "ics-section-chief"
    },
    {
        id: "section-chief-planning",
        displayName: "Section Chief — Planning",
        description: "Collects and disseminates incident information; maintains resource status.",
        category: "ics-section-chief"
    },
    {
        id: "section-chief-logistics",
        displayName: "Section Chief — Logistics",
        description: "Provides facilities, services, and materials required for the incident.",
        category: "ics-section-chief"
    },
    {
        id: "section-chief-finance",
        displayName: "Section Chief — Finance/Admin",
        description: "Tracks incident-related costs; handles procurement and compensation.",
        category: "ics-section-chief"
    },
    {
        id: "site-administrator",
        displayName: "Site Administrator",
        description: "Application admin: cross-event aggregation, event closure, report generation.",
        category: "admin"
    }
];

/**
 * Lookup a role definition by id. Throws if the id is unknown.
 */
export function getRoleDefinition(id: ActingRole): RoleDefinition {
    const role = ACTING_ROLES.find(r => r.id === id);
    if (!role) {
        throw new Error(`Unknown acting role: ${id}`);
    }
    return role;
}

/**
 * The 8 ICS roles offered on the IMT sub-picker.
 * (Firefighter is not here — it's its own account type. Site Administrator
 * is not here — IMT accounts don't grant admin powers.)
 */
export const IMT_ROLE_CHOICES: ActingRole[] = [
    "incident-commander",
    "safety-officer",
    "liaison-officer",
    "information-officer",
    "section-chief-operations",
    "section-chief-planning",
    "section-chief-logistics",
    "section-chief-finance"
];

/**
 * Account types offered on the generic_user initial picker.
 * Selecting one routes to the corresponding account-type flow.
 */
export type GenericPickerChoice = Exclude<AccountType, "generic_user" | "direct_role">;

export const GENERIC_PICKER_CHOICES: { id: GenericPickerChoice; displayName: string; description: string }[] = [
    {
        id: "firefighter",
        displayName: "Firefighter",
        description: "Demo as a field responder. Goes straight to chat with the Firefighter role."
    },
    {
        id: "incident_management_team",
        displayName: "Incident Management Team",
        description: "Demo as an ICS-role holder. You'll pick a specific ICS role next."
    },
    {
        id: "site_administrator",
        displayName: "Site Administrator",
        description: "Demo the admin flow (aggregate views, event closure, report generation)."
    }
];

/**
 * Legacy per-role test accounts (created pre-refinement for advanced-client
 * demos where Entra accounts are 1:1 with ICS roles). UPN prefix directly
 * maps to an acting role; these accounts skip all pickers.
 */
const LEGACY_UPN_TO_ROLE: Record<string, ActingRole> = {
    incident_commander: "incident-commander",
    safety_officer: "safety-officer",
    liaison_officer: "liaison-officer",
    information_officer: "information-officer",
    section_chief_operations: "section-chief-operations",
    section_chief_planning: "section-chief-planning",
    section_chief_logistics: "section-chief-logistics",
    section_chief_finance: "section-chief-finance"
};

/**
 * UPN local-parts that should be treated as Site Administrator accounts.
 * Add additional admin users here. This is a stopgap until role assignment
 * moves to Entra group membership or a Cosmos user record (see BACKLOG.md).
 *
 * Includes the literal `site_administrator` test account plus any real users
 * who should have admin powers (cross-event aggregate views, event closure,
 * report generation, taxonomy management).
 */
const ADMIN_UPN_PREFIXES = new Set<string>(["site_administrator", "jhughes"]);

/**
 * Result of deriving account context from the signed-in user's UPN.
 */
export interface AccountContext {
    accountType: AccountType;
    /**
     * Populated when the account type implies a direct acting role with
     * no picker shown to the user. Undefined for IMT and generic_user,
     * which require interactive selection.
     */
    directActingRole?: ActingRole;
}

/**
 * Derive account context from a user's UPN (lab-MVP implementation).
 *
 * Inspects the UPN local-part prefix and matches against the known account
 * cohort. Real deployments would replace this with an Entra group lookup
 * or Cosmos user record lookup — swap this function, keep the rest of the
 * app unchanged.
 *
 * Unrecognized UPNs fall back to `generic_user` so unknown accounts still
 * get a usable (if demo-style) flow rather than an error page.
 */
export function deriveAccountContext(upn: string): AccountContext {
    const localPart = upn.toLowerCase().split("@")[0];

    if (ADMIN_UPN_PREFIXES.has(localPart)) {
        return { accountType: "site_administrator", directActingRole: "site-administrator" };
    }
    if (localPart === "firefighter") {
        return { accountType: "firefighter", directActingRole: "firefighter" };
    }
    if (localPart === "incident_management_team") {
        return { accountType: "incident_management_team" };
    }
    if (localPart === "generic_user") {
        return { accountType: "generic_user" };
    }

    const legacyRole = LEGACY_UPN_TO_ROLE[localPart];
    if (legacyRole) {
        return { accountType: "direct_role", directActingRole: legacyRole };
    }

    return { accountType: "generic_user" };
}

/**
 * sessionStorage key used by RoleContext to persist the selected acting
 * role across page refreshes within a single browser tab. Cleared on tab
 * close (matches session-scoped semantics we agreed to).
 */
export const ACTING_ROLE_STORAGE_KEY = "opensourcerer.actingRole";
