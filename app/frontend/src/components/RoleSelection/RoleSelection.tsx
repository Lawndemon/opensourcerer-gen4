import { useState } from "react";
import { Button } from "@fluentui/react-components";
import appLogo from "../../assets/applogo.svg";
import { EMERGENCY_ROLES, EmergencyRole } from "./roles";
import styles from "./RoleSelection.module.css";

interface RoleSelectionProps {
    onRoleSelected: (roleId: string) => void;
}

export const RoleSelection = ({ onRoleSelected }: RoleSelectionProps) => {
    const [hoveredRole, setHoveredRole] = useState<string | null>(null);

    return (
        <div className={styles.overlay}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <img src={appLogo} alt="Emergency Response Assistant" className={styles.logo} />
                    <h1 className={styles.title}>Emergency Response Assistant</h1>
                    <p className={styles.subtitle}>
                        Select your ICS role to configure the assistant for your responsibilities
                    </p>
                </div>

                <div className={styles.roleGrid}>
                    {EMERGENCY_ROLES.map((role: EmergencyRole) => (
                        <button
                            key={role.id}
                            className={`${styles.roleCard} ${hoveredRole === role.id ? styles.roleCardHovered : ""}`}
                            onClick={() => onRoleSelected(role.id)}
                            onMouseEnter={() => setHoveredRole(role.id)}
                            onMouseLeave={() => setHoveredRole(null)}
                            aria-label={`Select role: ${role.label}`}
                        >
                            <span className={styles.roleName}>{role.label}</span>
                            <span className={styles.roleDescription}>{role.description}</span>
                        </button>
                    ))}
                </div>

                <p className={styles.footer}>
                    You can change your role at any time using the <strong>Session Configuration</strong> panel
                </p>
            </div>
        </div>
    );
};
