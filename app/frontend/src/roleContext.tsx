/**
 * RoleContext — holds the user's account context (derived from UPN) and the
 * acting role they've chosen (or that was auto-assigned) for this session.
 *
 * The acting role is persisted to sessionStorage so a page refresh doesn't
 * drop the user back into the role picker. sessionStorage is deliberate — we
 * want role to reset on tab close, matching the "session-scoped acting role"
 * design principle. localStorage would make the role sticky forever, which
 * contradicts the audit-discipline model (see BACKLOG.md).
 */

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";

import { useLogin, getUsername } from "./authConfig";
import { ACTING_ROLE_STORAGE_KEY, AccountContext, ActingRole, deriveAccountContext } from "./roles";

interface RoleContextValue {
    /** The signed-in user's UPN, or null if not available yet. */
    upn: string | null;
    /** Account context derived from the UPN. Null until UPN is loaded. */
    accountContext: AccountContext | null;
    /** The acting role for this session, or null if the user hasn't picked one yet. */
    actingRole: ActingRole | null;
    /** Commit an acting role choice (persists to sessionStorage). */
    setActingRole: (role: ActingRole) => void;
    /** Clear the acting role (used when we want to force a re-pick, e.g. sign-out). */
    clearActingRole: () => void;
}

const defaultValue: RoleContextValue = {
    upn: null,
    accountContext: null,
    actingRole: null,
    setActingRole: () => {},
    clearActingRole: () => {}
};

export const RoleContext = createContext<RoleContextValue>(defaultValue);

export const useRole = () => useContext(RoleContext);

interface RoleProviderProps {
    children: ReactNode;
}

export const RoleProvider = ({ children }: RoleProviderProps) => {
    const [upn, setUpn] = useState<string | null>(null);
    const [actingRole, setActingRoleState] = useState<ActingRole | null>(() => {
        // Read initial value from sessionStorage so refreshes don't bounce the user back to the picker.
        if (typeof window === "undefined") return null;
        const stored = window.sessionStorage.getItem(ACTING_ROLE_STORAGE_KEY);
        return (stored as ActingRole | null) ?? null;
    });

    // Resolve the signed-in user's UPN once MSAL is ready.
    const msal = useLogin ? useMsal() : null;
    useEffect(() => {
        if (!msal) return;
        let cancelled = false;
        getUsername(msal.instance)
            .then(name => {
                if (!cancelled) setUpn(name);
            })
            .catch(e => {
                console.error("RoleProvider: failed to resolve UPN", e);
            });
        return () => {
            cancelled = true;
        };
    }, [msal]);

    const accountContext = useMemo<AccountContext | null>(() => {
        if (!upn) return null;
        return deriveAccountContext(upn);
    }, [upn]);

    // If the account has a direct acting role and the user hasn't picked one yet,
    // auto-commit the direct role. This is what makes fire-officer/site_administrator/
    // direct_role accounts skip the picker.
    useEffect(() => {
        if (!accountContext) return;
        if (actingRole) return;
        if (accountContext.directActingRole) {
            setActingRoleInternal(accountContext.directActingRole);
        }
        // Intentionally depending only on accountContext: setting a role shouldn't retrigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountContext]);

    const setActingRoleInternal = useCallback((role: ActingRole) => {
        setActingRoleState(role);
        if (typeof window !== "undefined") {
            window.sessionStorage.setItem(ACTING_ROLE_STORAGE_KEY, role);
        }
    }, []);

    const clearActingRole = useCallback(() => {
        setActingRoleState(null);
        if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(ACTING_ROLE_STORAGE_KEY);
        }
    }, []);

    const value = useMemo<RoleContextValue>(
        () => ({
            upn,
            accountContext,
            actingRole,
            setActingRole: setActingRoleInternal,
            clearActingRole
        }),
        [upn, accountContext, actingRole, setActingRoleInternal, clearActingRole]
    );

    return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};
