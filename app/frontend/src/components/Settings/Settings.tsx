import { useId } from "@fluentui/react-hooks";
import { useTranslation } from "react-i18next";
import { TextField, ITextFieldProps, Checkbox, ICheckboxProps, Dropdown, IDropdownProps, IDropdownOption, Stack } from "@fluentui/react";
import { HelpCallout } from "../HelpCallout";
import { VectorSettings } from "../VectorSettings";
import { RetrievalMode } from "../../api";
import styles from "./Settings.module.css";

// Add type for onRenderLabel
type RenderLabelType = ITextFieldProps | IDropdownProps | ICheckboxProps;

export interface SettingsProps {
    promptTemplate: string;
    temperature: number;
    retrieveCount: number;
    persona: string;
    agenticReasoningEffort: string;
    seed: number | null;
    minimumSearchScore: number;
    minimumRerankerScore: number;
    useSemanticRanker: boolean;
    useSemanticCaptions: boolean;
    useQueryRewriting: boolean;
    reasoningEffort: string;
    excludeCategory: string;
    includeCategory: string;
    retrievalMode: RetrievalMode;
    sendTextSources: boolean;
    sendImageSources: boolean;
    searchTextEmbeddings: boolean;
    searchImageEmbeddings: boolean;
    showSemanticRankerOption: boolean;
    showQueryRewritingOption: boolean;
    showReasoningEffortOption: boolean;
    showMultimodalOptions: boolean;
    showVectorOption: boolean;
    useLogin: boolean;
    loggedIn: boolean;
    requireAccessControl: boolean;
    className?: string;
    onChange: (field: string, value: any) => void;
    streamingEnabled?: boolean; // Only used in chat
    shouldStream?: boolean; // Only used in Chat
    useSuggestFollowupQuestions?: boolean; // Only used in Chat
    promptTemplatePrefix?: string;
    promptTemplateSuffix?: string;
    showAgenticRetrievalOption?: boolean;
    useAgenticKnowledgeBase?: boolean;
    hideMinimalRetrievalReasoningOption?: boolean;
    useWebSource?: boolean;
    showWebSourceOption?: boolean;
    useSharePointSource?: boolean;
    showSharePointSourceOption?: boolean;
}

export const Settings = ({
    promptTemplate,
    temperature,
    retrieveCount,
    agenticReasoningEffort,
    persona,
    seed,
    minimumSearchScore,
    minimumRerankerScore,
    useSemanticRanker,
    useSemanticCaptions,
    useQueryRewriting,
    reasoningEffort,
    excludeCategory,
    includeCategory,
    retrievalMode,
    searchTextEmbeddings,
    searchImageEmbeddings,
    sendTextSources,
    sendImageSources,
    showSemanticRankerOption,
    showQueryRewritingOption,
    showReasoningEffortOption,
    showMultimodalOptions,
    showVectorOption,
    useLogin,
    loggedIn,
    requireAccessControl,
    className,
    onChange,
    streamingEnabled,
    shouldStream,
    useSuggestFollowupQuestions,
    promptTemplatePrefix,
    promptTemplateSuffix,
    showAgenticRetrievalOption,
    useAgenticKnowledgeBase = false,
    hideMinimalRetrievalReasoningOption = false,
    useWebSource = false,
    showWebSourceOption = false,
    useSharePointSource = false,
    showSharePointSourceOption = false
}: SettingsProps) => {
    const { t } = useTranslation();

    // Form field IDs
    const promptTemplateId = useId("promptTemplate");
    const promptTemplateFieldId = useId("promptTemplateField");
    const temperatureId = useId("temperature");
    const temperatureFieldId = useId("temperatureField");
    const seedId = useId("seed");
    const seedFieldId = useId("seedField");
    const agenticRetrievalId = useId("agenticRetrieval");
    const agenticRetrievalFieldId = useId("agenticRetrievalField");
    const webSourceId = useId("webSource");
    const webSourceFieldId = useId("webSourceField");
    const sharePointSourceId = useId("sharePointSource");
    const sharePointSourceFieldId = useId("sharePointSourceField");
    const searchScoreId = useId("searchScore");
    const searchScoreFieldId = useId("searchScoreField");
    const rerankerScoreId = useId("rerankerScore");
    const rerankerScoreFieldId = useId("rerankerScoreField");
    const retrieveCountId = useId("retrieveCount");
    const retrieveCountFieldId = useId("retrieveCountField");
    const agenticReasoningEffortId = useId("agenticReasoningEffort");
    const agenticReasoningEffortFieldId = useId("agenticReasoningEffortField");
    const includeCategoryId = useId("includeCategory");
    const includeCategoryFieldId = useId("includeCategoryField");
    const excludeCategoryId = useId("excludeCategory");
    const excludeCategoryFieldId = useId("excludeCategoryField");
    const semanticRankerId = useId("semanticRanker");
    const semanticRankerFieldId = useId("semanticRankerField");
    const queryRewritingFieldId = useId("queryRewritingField");
    const reasoningEffortFieldId = useId("reasoningEffortField");
    const semanticCaptionsId = useId("semanticCaptions");
    const semanticCaptionsFieldId = useId("semanticCaptionsField");
    const shouldStreamId = useId("shouldStream");
    const shouldStreamFieldId = useId("shouldStreamField");
    const suggestFollowupQuestionsId = useId("suggestFollowupQuestions");
    const suggestFollowupQuestionsFieldId = useId("suggestFollowupQuestionsField");

    const webSourceDisablesStreamingAndFollowup = !!useWebSource;

    const retrievalReasoningOptions: IDropdownOption[] = [
        { key: "minimal", text: t("labels.agenticReasoningEffortOptions.minimal") },
        { key: "low", text: t("labels.agenticReasoningEffortOptions.low") },
        { key: "medium", text: t("labels.agenticReasoningEffortOptions.medium") }
    ];

    const renderLabel = (props: RenderLabelType | undefined, labelId: string, fieldId: string, helpText: string) => (
        <HelpCallout labelId={labelId} fieldId={fieldId} helpText={helpText} label={props?.label} />
    );

    return (
        <div className={className}>
            <h3 className={styles.sectionHeader}>{t("basicSettings")}</h3>
            <Dropdown
                label="Select Role"
                selectedKey={persona}
                onChange={(_ev, option) => onChange("persona", option?.key)}
                options={[
                    { key: "default", text: "General Support" },
                    { key: "firefighter", text: "Firefighter" },
                    { key: "police", text: "Police Officer" },
                    { key: "coordinator", text: "Incident Management Team (IMT)" },
                    { key: "fire_chief", text: "Fire Chief" }
                ]}
                styles={{ dropdown: { width: "100%" } }}
            />

            {/* <Dropdown
                id={includeCategoryFieldId}
                className={styles.settingsSeparator}
                label={t("labels.includeCategory")}
                selectedKeys={includeCategory ? includeCategory.split(",") : []}
                multiSelect
                onChange={(_ev, option) => {
                    const currentKeys = includeCategory ? includeCategory.split(",") : [];
                    let newKeys;
                    if (option?.selected) {
                        newKeys = [...currentKeys, option.key as string];
                    } else {
                        newKeys = currentKeys.filter(k => k !== option?.key);
                    }
                    onChange("includeCategory", newKeys.join(","));
                }}
                aria-labelledby={includeCategoryId}
                options={[
                    { key: "Federal", text: t("labels.includeCategoryOptions.federal") },
                    { key: "Fire Behaviour", text: t("labels.includeCategoryOptions.fireBehaviour") },
                    { key: "Industry", text: t("labels.includeCategoryOptions.industry") },
                    { key: "Municipal", text: t("labels.includeCategoryOptions.municipal") },
                    { key: "NFPA", text: t("labels.includeCategoryOptions.nfpa") },
                    { key: "Regional", text: t("labels.includeCategoryOptions.regional") },
                    { key: "Risk", text: t("labels.includeCategoryOptions.risk") },
                    { key: "Staffing", text: t("labels.includeCategoryOptions.staffing") }
                ]}
                onRenderLabel={props => renderLabel(props, includeCategoryId, includeCategoryFieldId, t("helpTexts.includeCategory"))}
            />
            */}

            <h3 className={styles.sectionHeader}>{t("advancedSettings")}</h3>

            {showAgenticRetrievalOption && (
                <Checkbox
                    id={agenticRetrievalFieldId}
                    className={styles.settingsSeparator}
                    checked={useAgenticKnowledgeBase}
                    label={t("labels.useAgenticKnowledgeBase")}
                    onChange={(_ev, checked) => onChange("useAgenticKnowledgeBase", !!checked)}
                    aria-labelledby={agenticRetrievalId}
                    onRenderLabel={props => renderLabel(props, agenticRetrievalId, agenticRetrievalFieldId, t("helpTexts.useAgenticKnowledgeBase"))}
                />
            )}

            {showAgenticRetrievalOption && useAgenticKnowledgeBase && (
                <Dropdown
                    id={agenticReasoningEffortFieldId}
                    className={styles.settingsSeparator}
                    label={t("labels.agenticReasoningEffort")}
                    selectedKey={agenticReasoningEffort}
                    onChange={(_ev?: React.FormEvent<HTMLElement | HTMLInputElement>, option?: IDropdownOption) => {
                        const newValue = option?.key?.toString() ?? agenticReasoningEffort;
                        onChange("agenticReasoningEffort", newValue);
                        // If selecting minimal, disable and deselect web source
                        if (newValue === "minimal" && useWebSource) {
                            onChange("useWebSource", false);
                        }
                    }}
                    aria-labelledby={agenticReasoningEffortId}
                    options={retrievalReasoningOptions}
                    onRenderLabel={props => renderLabel(props, agenticReasoningEffortId, agenticReasoningEffortFieldId, t("helpTexts.agenticReasoningEffort"))}
                />
            )}

            {!useAgenticKnowledgeBase && (
                <TextField
                    id={retrieveCountFieldId}
                    className={styles.settingsSeparator}
                    label={t("labels.retrieveCount")}
                    type="number"
                    min={1}
                    max={20} // Cap this at 20 to protect your token usage
                    defaultValue={retrieveCount.toString()}
                    onChange={(_ev, val) => onChange("retrieveCount", parseInt(val || "7"))}
                    aria-labelledby={retrieveCountId}
                    onRenderLabel={props => renderLabel(props, retrieveCountId, retrieveCountFieldId, t("helpTexts.retrieveNumber"))}
                />
            )}

            {showAgenticRetrievalOption && useAgenticKnowledgeBase && showWebSourceOption && (
                <Checkbox
                    id={webSourceFieldId}
                    className={styles.settingsSeparator}
                    checked={useWebSource}
                    label={t("labels.useWebSource")}
                    onChange={(_ev, checked) => {
                        onChange("useWebSource", !!checked);
                        // If enabling web source, disable streaming and follow-up questions
                        if (checked) {
                            if (shouldStream) {
                                onChange("shouldStream", false);
                            }
                            if (useSuggestFollowupQuestions) {
                                onChange("useSuggestFollowupQuestions", false);
                            }
                        }
                    }}
                    aria-labelledby={webSourceId}
                    disabled={!useAgenticKnowledgeBase || agenticReasoningEffort === "minimal"}
                    onRenderLabel={props => renderLabel(props, webSourceId, webSourceFieldId, t("helpTexts.useWebSource"))}
                />
            )}
            {showAgenticRetrievalOption && useAgenticKnowledgeBase && showSharePointSourceOption && (
                <Checkbox
                    id={sharePointSourceFieldId}
                    className={styles.settingsSeparator}
                    checked={useSharePointSource}
                    label={t("labels.useSharePointSource")}
                    onChange={(_ev, checked) => onChange("useSharePointSource", !!checked)}
                    aria-labelledby={sharePointSourceId}
                    disabled={!useAgenticKnowledgeBase}
                    onRenderLabel={props => renderLabel(props, sharePointSourceId, sharePointSourceFieldId, t("helpTexts.useSharePointSource"))}
                />
            )}
            {!useAgenticKnowledgeBase && (
                <TextField
                    id={searchScoreFieldId}
                    className={styles.settingsSeparator}
                    label={t("labels.minimumSearchScore")}
                    type="number"
                    step={0.1}
                    // Multiply by 100 for display (0.019 -> 1.9)
                    defaultValue={(minimumSearchScore * 100).toString()}
                    // Divide by 100 for state (1.9 -> 0.019)
                    onChange={(_ev, val) => onChange("minimumSearchScore", parseFloat(val || "0") / 100)}
                    aria-labelledby={searchScoreId}
                    onRenderLabel={props => renderLabel(props, searchScoreId, searchScoreFieldId, t("helpTexts.searchScore"))}
                />
            )}

            {showSemanticRankerOption && (
                <TextField
                    id={rerankerScoreFieldId}
                    className={styles.settingsSeparator}
                    label={t("labels.minimumRerankerScore")}
                    type="number"
                    min={1}
                    max={4}
                    step={0.1}
                    defaultValue={minimumRerankerScore.toString()}
                    onChange={(_ev, val) => onChange("minimumRerankerScore", parseFloat(val || "0"))}
                    aria-labelledby={rerankerScoreId}
                    onRenderLabel={props => renderLabel(props, rerankerScoreId, rerankerScoreFieldId, t("helpTexts.rerankerScore"))}
                />
            )}

            {!useAgenticKnowledgeBase && (
                <TextField
                    id={retrieveCountFieldId}
                    className={styles.settingsSeparator}
                    label={t("labels.retrieveCount")}
                    type="number"
                    min={1}
                    max={50}
                    defaultValue={retrieveCount.toString()}
                    onChange={(_ev, val) => onChange("retrieveCount", parseInt(val || "10"))}
                    aria-labelledby={retrieveCountId}
                    onRenderLabel={props => renderLabel(props, retrieveCountId, retrieveCountFieldId, t("helpTexts.retrieveNumber"))}
                />
            )}

            {showQueryRewritingOption && !useAgenticKnowledgeBase && (
                <>
                    <Checkbox
                        id={queryRewritingFieldId}
                        className={styles.settingsSeparator}
                        checked={useQueryRewriting}
                        disabled={!useSemanticRanker}
                        label={t("labels.useQueryRewriting")}
                        onChange={(_ev, checked) => onChange("useQueryRewriting", !!checked)}
                        aria-labelledby={queryRewritingFieldId}
                        onRenderLabel={props => renderLabel(props, queryRewritingFieldId, queryRewritingFieldId, t("helpTexts.useQueryRewriting"))}
                    />
                </>
            )}
            {showReasoningEffortOption && (
                <Dropdown
                    id={reasoningEffortFieldId}
                    selectedKey={reasoningEffort}
                    label={t("labels.reasoningEffort")}
                    onChange={(_ev?: React.FormEvent<HTMLElement | HTMLInputElement>, option?: IDropdownOption) =>
                        onChange("reasoningEffort", option?.key || "")
                    }
                    aria-labelledby={reasoningEffortFieldId}
                    options={[
                        { key: "minimal", text: t("labels.reasoningEffortOptions.minimal") },
                        { key: "low", text: t("labels.reasoningEffortOptions.low") },
                        { key: "medium", text: t("labels.reasoningEffortOptions.medium") },
                        { key: "high", text: t("labels.reasoningEffortOptions.high") }
                    ]}
                    onRenderLabel={props => renderLabel(props, queryRewritingFieldId, queryRewritingFieldId, t("helpTexts.reasoningEffort"))}
                />
            )}

            {!useWebSource && (
                <>
                    <TextField
                        id={temperatureFieldId}
                        className={styles.settingsSeparator}
                        label={t("labels.temperature")}
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        defaultValue={temperature.toString()}
                        onChange={(_ev, val) => onChange("temperature", parseFloat(val || "0"))}
                        aria-labelledby={temperatureId}
                        onRenderLabel={props => renderLabel(props, temperatureId, temperatureFieldId, t("helpTexts.temperature"))}
                    />

                    {showMultimodalOptions && !useAgenticKnowledgeBase && (
                        <fieldset className={styles.fieldset + " " + styles.settingsSeparator}>
                            <legend className={styles.legend}>{t("labels.llmInputs")}</legend>
                            <Stack tokens={{ childrenGap: 8 }}>
                                <Checkbox
                                    id="sendTextSources"
                                    label={t("labels.llmInputsOptions.texts")}
                                    checked={sendTextSources}
                                    onChange={(_ev, checked) => {
                                        onChange("sendTextSources", !!checked);
                                    }}
                                    onRenderLabel={props => renderLabel(props, "sendTextSourcesLabel", "sendTextSources", t("helpTexts.llmTextInputs"))}
                                />
                                <Checkbox
                                    id="sendImageSources"
                                    label={t("labels.llmInputsOptions.images")}
                                    checked={sendImageSources}
                                    onChange={(_ev, checked) => {
                                        onChange("sendImageSources", !!checked);
                                    }}
                                    onRenderLabel={props => renderLabel(props, "sendImageSourcesLabel", "sendImageSources", t("helpTexts.llmImageInputs"))}
                                />
                            </Stack>
                        </fieldset>
                    )}
                </>
            )}
        </div>
    );
};
