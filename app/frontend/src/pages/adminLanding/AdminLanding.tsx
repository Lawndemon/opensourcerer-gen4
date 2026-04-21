/**
 * AdminLanding — stub landing page for the Site Administrator acting role.
 *
 * Rendered by IndexRouter whenever the acting role is `site-administrator`.
 * Today it's a placeholder; real admin tooling (cross-event aggregate views,
 * event closure, report generation, taxonomy management) lands in later
 * sessions. See BACKLOG.md → "Event-level workflow" for the planned scope.
 */

import { Title1, Body1 } from "@fluentui/react-components";
import { useRole } from "../../roleContext";
import styles from "./AdminLanding.module.css";

const AdminLanding = () => {
    const { upn } = useRole();

    return (
        <div className={styles.container}>
            <Title1>Site Administrator</Title1>
            <Body1 className={styles.welcome}>
                Signed in as {upn ?? "administrator"}. Administrative tooling will appear here in a future release.
            </Body1>
            <section className={styles.futureSection}>
                <Body1>Planned admin capabilities:</Body1>
                <ul className={styles.plannedList}>
                    <li>Cross-event aggregate views of responder chat activity</li>
                    <li>Event closure and end-of-event report generation</li>
                    <li>Scenario and role taxonomy management</li>
                    <li>User invitation and role assignment</li>
                </ul>
            </section>
        </div>
    );
};

export default AdminLanding;
