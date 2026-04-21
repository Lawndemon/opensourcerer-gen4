import { useEffect, useRef, useState } from "react";
import { FluentProvider, webDarkTheme } from "@fluentui/react-components";
import { useMsal } from "@azure/msal-react";
import { useLogin, checkLoggedIn } from "./authConfig";
import { LoginContext } from "./loginContext";
import { RoleProvider } from "./roleContext";
import Layout from "./pages/layout/Layout";

const LayoutWrapper = () => {
    const [loggedIn, setLoggedIn] = useState(false);
    if (useLogin) {
        const { instance } = useMsal();
        // Keep track of the mounted state to avoid setting state in an unmounted component
        const mounted = useRef<boolean>(true);
        useEffect(() => {
            mounted.current = true;
            checkLoggedIn(instance)
                .then(isLoggedIn => {
                    if (mounted.current) setLoggedIn(isLoggedIn);
                })
                .catch(e => {
                    console.error("checkLoggedIn failed", e);
                });
            return () => {
                mounted.current = false;
            };
        }, [instance]);

        return (
            <LoginContext.Provider value={{ loggedIn, setLoggedIn }}>
                <RoleProvider>
                    <FluentProvider theme={webDarkTheme} style={{ height: "100%", backgroundColor: "transparent" }}>
                        <Layout />
                    </FluentProvider>
                </RoleProvider>
            </LoginContext.Provider>
        );
    } else {
        return (
            <LoginContext.Provider
                value={{
                    loggedIn,
                    setLoggedIn
                }}
            >
                <RoleProvider>
                    <FluentProvider theme={webDarkTheme} style={{ height: "100%", backgroundColor: "transparent" }}>
                        <Layout />
                    </FluentProvider>
                </RoleProvider>
            </LoginContext.Provider>
        );
    }
};

export default LayoutWrapper;
