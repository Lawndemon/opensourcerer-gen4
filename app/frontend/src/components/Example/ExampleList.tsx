import { Example } from "./Example";
import { useTranslation } from "react-i18next";

import styles from "./Example.module.css";

interface Props {
    onExampleClicked: (value: string) => void;
    useMultimodalAnswering?: boolean;
    roleExamples?: [string, string, string];
}

export const ExampleList = ({ onExampleClicked, useMultimodalAnswering, roleExamples }: Props) => {
    const { t } = useTranslation();

    const DEFAULT_EXAMPLES: string[] = [t("defaultExamples.1"), t("defaultExamples.2"), t("defaultExamples.3")];
    const MULTIMODAL_EXAMPLES: string[] = [t("multimodalExamples.1"), t("multimodalExamples.2"), t("multimodalExamples.3")];

    // Role-specific examples take priority; fall back to multimodal or default
    const examples: string[] = roleExamples ?? (useMultimodalAnswering ? MULTIMODAL_EXAMPLES : DEFAULT_EXAMPLES);

    return (
        <ul className={styles.examplesNavList}>
            {examples.map((question, i) => (
                <li key={i}>
                    <Example text={question} value={question} onClick={onExampleClicked} />
                </li>
            ))}
        </ul>
    );
};
