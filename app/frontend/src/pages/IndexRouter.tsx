/**
 * IndexRouter — the post-login dispatcher.
 *
 * Decides what the user sees after sign-in based on their account context
 * and whether they've picked an acting role yet. Renders one of:
 *
 *  - <RoleSelect />     — the user needs to pick (or confirm) their acting role
 *  - <AdminLanding />   — the user's acting role is Site Administrator
 *  - <IncidentKiosk />  — the user's acting role is Fire Officer (kiosk paradigm)
 *  - <Chat />           — every other acting role (chat UI for now; will switch to
 *                         the active-incidents dashboard in a later session)
 *
 * See BACKLOG.md → "Incident-centric architecture" for the routing rationale.
 */

import { useRole } from "../roleContext";
import { useLogin } from "../authConfig";

import Chat from "./chat/Chat";
import RoleSelect from "./roleSelect/RoleSelect";
import AdminLanding from "./adminLanding/AdminLanding";
import IncidentKiosk from "./incidentKiosk/IncidentKiosk";

const IndexRouter = () => {
    const { actingRole, accountContext } = useRole();

    // If login is disabled (no-auth dev mode), skip role plumbing
    // entirely and render the chat — role system is meaningless without a
    // signed-in user to attribute it to.
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
    // This is the prototype's primary surface.
    if (actingRole === "fire-officer") {
        return <IncidentKiosk />;
    }

    // Site Administrator takes its own landing page (stub today; real admin
    // tooling lands in later sessions).
    if (actingRole === "site-administrator") {
        return <AdminLanding />;
    }

    // Every other ICS role still lands on chat for now. Later sessions switch them
    // to the active-incidents dashboard described in BACKLOG.md.
    return <Chat />;
};

export default IndexRouter;
