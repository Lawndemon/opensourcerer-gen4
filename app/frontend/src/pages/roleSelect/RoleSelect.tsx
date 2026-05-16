/**
 * RoleSelect — the post-login role picker for accounts that need one.
 *
 * Only rendered for account types that require interactive selection:
 *  - generic_user: shows initial picker (IMT / Site Admin — Fire Officer
 *    intentionally excluded per 2026-05-13 spec), then (if user picks IMT)
 *    shows the ICS sub-picker.
 *  - site_administrator: shows the initial picker including Fire Officer
 *    (2026-05-16 spec — admins can operate as any role), then (if user picks IMT)
 *    shows the ICS sub-picker.
 *  - incident_management_team: shows the ICS sub-picker directly.
 *
 * Account types with a direct acting role (fire-officer, direct_role) auto-commit
 * in RoleProvider and never reach this component.
 */

import { useState } from "react";
import { Button, Card, CardHeader, Text, Title2, Title3, Body1 } from "@fluentui/react-components";
import { ArrowLeft24Regular } from "@fluentui/react-icons";

import { useRole } from "../../roleContext";
import {
    ACTING_ROLES,
    ActingRole,
    AccountType,
    ADMIN_PICKER_CHOICES,
    GENERIC_PICKER_CHOICES,
    IMT_ROLE_CHOICES,
    RoleCategory,
    getRoleDefinition
} from "../../roles";
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
    const [step, setStep] = useState<PickerStep>(accountContext?.accountType === "incident_management_team" ? "imt" : "initial");

    if (!accountContext) return null;

    const isAdminPicker = accountContext.accountType === "site_administrator";
    const showsInitialPicker = accountContext.accountType === "generic_user" || isAdminPicker;
    const initialChoices = isAdminPicker ? ADMIN_PICKER_CHOICES : GENERIC_PICKER_CHOICES;

    // The initial-picker choice id is an AccountType, but the set of admissible
    // values depends on whether this is the admin picker (includes Fire Officer)
    // or the generic picker (does not).
    const handleInitialChoice = (choice: AccountType) => {
        if (choice === "fire-officer") {
            // Admin chose to operate the kiosk paradigm. Generic users never see
            // this option, so this branch is only reachable for admins.
            setActingRole("fire-officer");
            return;
        }
        if (choice === "site_administrator") {
            setActingRole("site-administrator");
            return;
        }
        // Incident Management Team — advance to the ICS sub-picker.
        setStep("imt");
    };

    const handleImtChoice = (role: ActingRole) => {
        setActingRole(role);
    };

    const backToInitial = () => setStep("initial");

    if (step === "initial" && showsInitialPicker) {
        const title = isAdminPicker ? "Choose a role for this session" : "How would you like to proceed?";
        const subtitle = isAdminPicker
            ? "Signed in as an administrator. Pick the role you will be operating as for this session — you can choose any role."
            : "Your account is not tied to a specific role. Choose the role you will be operating as for this session.";
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <Title2>{title}</Title2>
                    <Body1 className={styles.subtitle}>{subtitle}</Body1>
                </div>
                <div className={styles.cardGrid}>
                    {initialChoices.map(choice => (
                        <Card
                            key={choice.id}
                            className={styles.choiceCard}
                            onClick={() => handleInitialChoice(choice.id as AccountType)}
                            role="button"
                            tabIndex={0}
                        >
                            <CardHeader header={<Text weight="semibold">{choice.displayName}</Text>} description={choice.description} />
                        </Card>
                    ))}
                </div>
            </div>
        );
    }

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
    // Admins and generic users both reach the ICS sub-picker via the initial picker,
    // so they can go back to revisit it. IMT accounts land directly here and can't.
    const canGoBack = accountContext.accountType === "generic_user" || isAdminPicker;

    const imtSubtitle = isAdminPicker
        ? "You chose Incident Management Team. Pick the specific ICS role you're operating in for this session."
        : "Signed in as Incident Management Team. Pick the specific ICS role you're operating in for this session.";

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Title2>Select your ICS role</Title2>
                <Body1 className={styles.subtitle}>{imtSubtitle}</Body1>
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
