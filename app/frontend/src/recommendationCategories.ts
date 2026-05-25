import type { RecommendationCategory } from "./api/incidentTypes";

/** ICS urgency order — most urgent first. Drives the support-pane section headers. */
export const RECOMMENDATION_CATEGORY_ORDER: RecommendationCategory[] = ["life_safety", "incident_stabilization", "property_conservation"];

/** Human-readable section header per category. */
export const RECOMMENDATION_CATEGORY_LABEL: Record<RecommendationCategory, string> = {
    life_safety: "Life Safety",
    incident_stabilization: "Incident Stabilization",
    property_conservation: "Property Conservation"
};
