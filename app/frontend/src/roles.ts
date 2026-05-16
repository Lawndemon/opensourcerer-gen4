/**
 * Role taxonomy and account-type model for opensourcerer-gen4.
 *
 * There are two distinct concepts in the role system:
 *  - AccountType: how a user signs in. Derived from the Entra UPN for MVP.
 *  - ActingRole: the persona that drives RAG retrieval, prompt tone, audit logging.
 *
 * Account type and acting role are related but not identical:
 *  - fire-officer / legacy per-role accounts map directly to an acting role; no
 *    picker shown.
 *  - incident_management_team / generic_user / site_administrator require the user
 *    to pick at login. Admins see the same picker as generic users plus the Fire
 *    Officer choice (2026-05-16 spec).
 *
 * See BACKLOG.md → "Event-level workflow and audit log" for the full design rationale.
 */

export type AccountType =
    | "fire-officer"
    | "incident_management_team"
    | "site_administrator"
    | "generic_user"
    | "direct_role";

export type ActingRole =
    | "fire-officer"
    | "incident-commander"
    | "safety-officer"
    | "liaison-officer"
    | "information-officer"
    | "section-chief-operations"
    | "section-chief-planning"
    | "section-chief-logistics"
    | "section-chief-finance"
    | "site-administrator";

export type RoleCategory = "field" | "ics-command" | "ics-command-staff" | "ics-section-chief" | "admin";

export interface RoleDefinition {
    id: ActingRole;
    displayName: string;
    description: string;
    category: RoleCategory;
}

export const ACTING_ROLES: RoleDefinition[] = [
    {
        id: "fire-officer",
        displayName: "Fire Officer",
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

export function getRoleDefinition(id: ActingRole): RoleDefinition {
    const role = ACTING_ROLES.find(r => r.id === id);
    if (!role) {
        throw new Error(`Unknown acting role: ${id}`);
    }
    return role;
}

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
 *
 * Fire Officer is intentionally excluded (2026-05-13 spec): a demo / generic account
 * should never be able to spin up the kiosk paradigm — only the dedicated `fireofficer@`
 * UPN can. This keeps demo sessions from accidentally landing on the kiosk.
 */
export type GenericPickerChoice = Exclude<AccountType, "generic_user" | "direct_role" | "fire-officer">;

export const GENERIC_PICKER_CHOICES: { id: GenericPickerChoice; displayName: string; description: string }[] = [
    {
        id: "incident_management_team",
        displayName: "Incident Management Team",
        description: "Operate as an Incident Management Team member. Select your specific ICS role next."
    },
    {
        id: "site_administrator",
        displayName: "Site Administrator",
        description: "Operate as a Site Administrator. Cross-event aggregate views, event closure, and report generation."
    }
];

/**
 * Account types offered on the site_administrator initial picker.
 *
 * Admins can operate as any role — including Fire Officer — so the admin picker
 * is the generic picker plus the Fire Officer option (2026-05-16 spec). Picking
 * IMT advances to the existing ICS sub-picker; picking Fire Officer routes
 * straight to the kiosk; picking Site Administrator routes to admin landing.
 */
export type AdminPickerChoice = Exclude<AccountType, "generic_user" | "direct_role">;

export const ADMIN_PICKER_CHOICES: { id: AdminPickerChoice; displayName: string; description: string }[] = [
    {
        id: "fire-officer",
        displayName: "Fire Officer",
        description: "Operate the kiosk paradigm for live field response. Voice + single-button; never keyboard."
    },
    {
        id: "incident_management_team",
        displayName: "Incident Management Team",
        description: "Operate as an Incident Management Team member. Select your specific ICS role next."
    },
    {
        id: "site_administrator",
        displayName: "Site Administrator",
        description: "Operate as a Site Administrator. Cross-event aggregate views, event closure, and report generation."
    }
];

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

const ADMIN_UPN_PREFIXES = new Set<string>(["site_administrator", "jhughes"]);

export interface AccountContext {
    accountType: AccountType;
    directActingRole?: ActingRole;
}

export function deriveAccountContext(upn: string): AccountContext {
    const localPart = upn.toLowerCase().split("@")[0];

    if (ADMIN_UPN_PREFIXES.has(localPart)) {
        // Admins do NOT get a directActingRole — they land on the picker every login so
        // they can choose any role (including Fire Officer) for the session. Per 2026-05-16
        // spec: admins can operate as any role; generic / non-admin users cannot pick
        // Fire Officer.
        return { accountType: "site_administrator" };
    }
    if (localPart === "fireofficer") {
        return { accountType: "fire-officer", directActingRole: "fire-officer" };
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

export const ACTING_ROLE_STORAGE_KEY = "opensourcerer.actingRole";
