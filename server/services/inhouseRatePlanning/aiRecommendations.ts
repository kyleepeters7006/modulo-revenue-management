import { callGPT } from "../../aiRouter";
import type {
  StreetRateRecommendation,
  StreetRecommendationAction,
} from "@shared/streetRateRecommendations";

interface AiRationale {
  id: string;
  action?: StreetRecommendationAction;
  rationale?: string;
}

/**
 * AI is used only to explain the deterministic recommendation set. It cannot
 * choose a rate, bypass a ceiling, or change the feasibility result.
 */
export async function addAiRationales(
  recommendations: StreetRateRecommendation[],
): Promise<StreetRateRecommendation[]> {
  if (!recommendations.length) return recommendations;
  try {
    const prompt = recommendations.slice(0, 50).map((row) => ({
      id: row.id,
      campus: row.location,
      serviceLine: row.serviceLine,
      product: row.product,
      currentRate: row.currentStreetRate,
      topCompetitor: row.topCompetitorRate,
      premiumCeiling: row.premiumCeilingRate,
      suggestedRate: row.suggestedRate,
      deterministicAction: row.action,
      occupancyPct: row.occupancyPct,
      validation: row.validation,
    }));
    const text = await callGPT(
      [
        {
          role: "system",
          content:
            "You are a senior-living pricing analyst. Explain the supplied deterministic Street Rate recommendations. Return JSON only: {\"items\":[{\"id\":\"...\",\"action\":\"push|measured_increase|hold\",\"rationale\":\"one concise sentence\"}]}. Never invent numbers, never recommend a rate different from suggestedRate, and never override validation messages.",
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
      { maxTokens: 1600, jsonMode: true, label: "inhouse-street-rate-rationale" },
    );
    const parsed = JSON.parse(text) as { items?: AiRationale[] };
    const byId = new Map((parsed.items ?? []).map((item) => [item.id, item]));
    return recommendations.map((row) => {
      const ai = byId.get(row.id);
      if (!ai?.rationale || !ai.rationale.trim()) return row;
      const actionNote = ai.action && ai.action !== row.action
        ? ` Deterministic classification remains ${row.action}.`
        : "";
      return {
        ...row,
        rationale: `${ai.rationale.trim()}${actionNote}`,
      };
    });
  } catch (error) {
    console.warn("[inhouse-planning] AI rationale unavailable; using deterministic explanations", error);
    return recommendations;
  }
}