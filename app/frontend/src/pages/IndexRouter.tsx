/**
 * IndexRouter — the post-login dispatcher.
 *
 * Decides what the user sees after sign-in based on their account context
 * and whether they've picked an acting role yet. Renders one of:
 *
 *  - <RoleSelect /> — the user needs to pick (or confirm) their acting role
 *  - <AdminLanding /> — the user's acting role is Site Administrator
 *  - <Chat />         — the user's acting role is set; normal app UI
 *
 * See BACKLOG.md → "Event-level workflow" for the design rationale.
 */

import { useRole } from "../roleContext";
import { useLogin } from "../authConfig";

import Chat from "./chat/Chat";
import RoleSelect from "./roleSelect/RoleSelect";
import AdminLanding from "./adminLanding/AdminLanding";

const IndexRouter = () => {
    const { actingRole, accountContext } = useRole();

    // If login is disabled (demo/dev mode with no auth), skip role plumbing
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

    // Site Administrator takes its own landing page (stub today; real admin
    // tooling lands in later sessions).
    if (actingRole === "site-administrator") {
        return <AdminLanding />;
    }

    // Everyone else proceeds to the main chat UI.
    return <Chat />;
};

export default IndexRouter;
