/**
 * RoleSelect — the post-login role picker for accounts that need one.
 *
 * Only rendered for account types that require interactive selection:
 *  - generic_user: shows initial picker (Fire Officer / IMT / Site Admin),
 *    then (if user picks IMT) shows the ICS sub-picker.
 *  - incident_management_team: shows the ICS sub-picker directly.
 *
 * Account types with a direct acting role (fire-officer, site_administrator,
 * direct_role) auto-commit in RoleProvider and never reach this component.
 */

import { useState } from "react";
import { Button, Card, CardHeader, Text, Title2, Title3, Body1 } from "@fluentui/react-components";
import { ArrowLeft24Regular } from "@fluentui/react-icons";

import { useRole } from "../../roleContext";
import { ACTING_ROLES, ActingRole, GENERIC_PICKER_CHOICES, GenericPickerChoice, IMT_ROLE_CHOICES, RoleCategory, getRoleDefinition } from "../../roles";
import styles from "./RoleSelect.module.css";

type PickerStep = "initial" | "imt";

const ICS_CATEGORY_LABELS: Record<RoleCategory, string> = {
    field: "Field",
    "ics-command": "ICS Command",
    "ics-command-staff": "ICS Command Staff",
    "ics-section-chief": "ICS General Staff (Section Chiefs)",
    admin: "Administration"
};

const RoleSelect = () => {
    const { accountContext, setActingRole } = useRole();
    // For generic_user, we show the initial picker first, then advance to the IMT sub-picker
    // if the user chose "Incident Management Team". IMT accounts start directly on the sub-picker.
    const [step, setStep] = useState<PickerStep>(accountContext?.accountType === "incident_management_team" ? "imt" : "initial");

    if (!accountContext) return null;

    const handleGenericChoice = (choice: GenericPickerChoice) => {
        if (choice === "fire-officer") {
            setActingRole("fire-officer");
            return;
        }
        if (choice === "site_administrator") {
            setActingRole("site-administrator");
            return;
        }
        // Incident Management Team — advance to the ICS sub-picker
        setStep("imt");
    };

    const handleImtChoice = (role: ActingRole) => {
        setActingRole(role);
    };

    const backToInitial = () => setStep("initial");

    // Render the initial account-type picker (generic_user only)
    if (step === "initial" && accountContext.accountType === "generic_user") {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <Title2>How would you like to proceed?</Title2>
                    <Body1 className={styles.subtitle}>
                        Your account is not tied to a specific role. Choose the role you will be operating as for this session.
                    </Body1>
                </div>
                <div className={styles.cardGrid}>
                    {GENERIC_PICKER_CHOICES.map(choice => (
                        <Card key={choice.id} className={styles.choiceCard} onClick={() => handleGenericChoice(choice.id)} role="button" tabIndex={0}>
                            <CardHeader header={<Text weight="semibold">{choice.displayName}</Text>} description={choice.description} />
                        </Card>
                    ))}
                </div>
            </div>
        );
    }

    // Render the ICS sub-picker (IMT accounts, or generic users who chose IMT)
    // Group roles by category so the picker reads like an org chart.
    const grouped = IMT_ROLE_CHOICES.reduce<Record<RoleCategory, ActingRole[]>>(
        (acc, roleId) => {
            const def = getRoleDefinition(roleId);
            if (!acc[def.category]) acc[def.category] = [];
            acc[def.category].push(roleId);
            return acc;
        },
        {} as Record<RoleCategory, ActingRole[]>
    );

    const orderedCategories: RoleCategory[] = ["ics-command", "ics-command-staff", "ics-section-chief"];
    const canGoBack = accountContext.accountType === "generic_user";

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Title2>Select your ICS role</Title2>
                <Body1 className={styles.subtitle}>
                    Signed in as Incident Management Team. Pick the specific ICS role you're operating in for this session.
                </Body1>
                {canGoBack && (
                    <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={backToInitial} className={styles.backButton}>
                        Back to account type
                    </Button>
                )}
            </div>
            <div className={styles.imtGroups}>
                {orderedCategories.map(category => {
                    const roles = grouped[category];
                    if (!roles || roles.length === 0) return null;
                    return (
                        <section key={category} className={styles.imtGroup}>
                            <Title3 className={styles.groupTitle}>{ICS_CATEGORY_LABELS[category]}</Title3>
                            <div className={styles.cardGrid}>
                                {roles.map(roleId => {
                                    const def = ACTING_ROLES.find(r => r.id === roleId)!;
                                    return (
                                        <Card key={def.id} className={styles.choiceCard} onClick={() => handleImtChoice(def.id)} role="button" tabIndex={0}>
                                            <CardHeader header={<Text weight="semibold">{def.displayName}</Text>} description={def.description} />
                                        </Card>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
            </div>
        </div>
    );
};

export default RoleSelect;
