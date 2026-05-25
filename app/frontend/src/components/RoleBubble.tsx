import { ACTING_ROLES } from "../roles";
import styles from "./RoleBubble.module.css";

interface RoleBubbleProps {
    /** ActingRole id, e.g. "safety-officer". */
    role: string;
    /** Optional provenance suffix, e.g. "AI" / "HIC" (wired in a later slice). */
    suffix?: string;
}

/**
 * Coloured role chip showing the ICS acronym in the role's official vest colour.
 * NOTE: Command Staff (SO, PIO, LNO) all share Red, so the acronym — not the colour —
 * disambiguates them. Roles without an ICS vest (field/admin/unknown) get a neutral chip.
 */
const RoleBubble = ({ role, suffix }: RoleBubbleProps) => {
    const def = ACTING_ROLES.find(r => r.id === role);
    const text = (label: string) => (suffix ? `${label} - ${suffix}` : label);
    if (def?.acronym && def.vestColour) {
        return (
            <span
                className={styles.bubble}
                style={{ backgroundColor: def.vestColour.background, color: def.vestColour.text }}
                title={def.displayName}
            >
                {text(def.acronym)}
            </span>
        );
    }
    return (
        <span className={`${styles.bubble} ${styles.fallback}`} title={def?.displayName ?? role}>
            {text(def?.displayName ?? role)}
        </span>
    );
};

export default RoleBubble;
