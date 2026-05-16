/**
 * IndexRouter — the post-login dispatcher.
 *
 * Decides what the user sees after sign-in based on their account context
 * and whether they've picked an acting role yet. Renders one of:
 *
 *  - <RoleSelect />     — the user needs to pick (or confirm) their acting role
 *  - <AdminLanding />   — the user's acting role is Site Administrator
 *  - <IncidentKiosk />  — the user's acting role is Fire Officer (kiosk paradigm)
 *  - <IncidentList />   — every other ICS / IMT role (Session 5 landing)
 *
 * Chat is no longer the default landing for IMT roles per BACKLOG.md →
 * "Incident-centric architecture". Chat remains available as an interaction mode within
 * an incident's context (post-demo work).
 */

import { useRole } from "../roleContext";
import { useLogin } from "../authConfig";

import Chat from "./chat/Chat";
import RoleSelect from "./roleSelect/RoleSelect";
import AdminLanding from "./adminLanding/AdminLanding";
import IncidentKiosk from "./incidentKiosk/IncidentKiosk";
import IncidentList from "./incidentList/IncidentList";

const IndexRouter = () => {
    const { actingRole, accountContext } = useRole();

    // If login is disabled (no-auth dev mode), skip role plumbing entirely and render
    // chat — the role system is meaningless without a signed-in user to attribute it to.
    if (!useLogin) {
        return <Chat />;
    }

    // Account context resolves asynchronously after MSAL settles. While it's
    // loading, render nothing rather than flash the role picker.
    if (!accountContext) {
        return null;
    }

    // No acting role chosen yet — show the picker. (Account types with a
    // direct role auto-commit in RoleProvider and won't reach this branch.)
    if (!actingRole) {
        return <RoleSelect />;
    }

    // Fire Officer is the kiosk paradigm — voice + single-button-press, never keyboard.
    if (actingRole === "fire-officer") {
        return <IncidentKiosk />;
    }

    // Site Administrator takes its own landing page (stub today; real admin
    // tooling lands in later sessions).
    if (actingRole === "site-administrator") {
        return <AdminLanding />;
    }

    // Every other ICS / IMT role lands on the incidents dashboard (Session 5).
    // Click into an incident → read-only kiosk view with citations rendered.
    return <IncidentList />;
};

export default IndexRouter;
