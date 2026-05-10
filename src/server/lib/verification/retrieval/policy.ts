import { z } from "zod";
import { env } from "~/env";
import { callOpenRouterJson, type JsonSchemaSpec } from "../../openrouter/client";
import type {
  CategoryRetrievalDecision,
  RetrievalCategoryKind,
} from "../types";

export const RETRIEVAL_ELIGIBLE_KINDS = new Set<RetrievalCategoryKind>([
  "official_roster",
  "canonical_media_metadata",
  "public_result",
]);

export const retrievalCategoryKindSchema = z.enum([
  "official_roster",
  "canonical_media_metadata",
  "public_result",
  "public_schedule",
  "release_version",
  "government_or_legal",
  "public_company_fact",
  "business_listing",
  "private_trait",
  "rumor",
  "subjective_preference",
  "low_indexability_biographical_detail",
  "sensitive_personal_attribute",
  "unknown",
]);

const classifierSchema = z.object({
  normalizedCategory: z.string().min(1),
  kind: retrievalCategoryKindSchema,
});

const classifierJsonSchema: JsonSchemaSpec = {
  name: "retrieval_category_classifier",
  schema: {
    type: "object",
    properties: {
      normalizedCategory: { type: "string" },
      kind: {
        type: "string",
        enum: retrievalCategoryKindSchema.options,
      },
    },
    required: ["normalizedCategory", "kind"],
    additionalProperties: false,
  },
};

export type RetrievalPolicyInput = Omit<
  CategoryRetrievalDecision,
  "eligible" | "reason"
>;

export type CategoryClassifierOptions = {
  model?: string;
  timeoutMs?: number;
  useModel?: boolean;
};

export function normalizeCategoryForRetrieval(category: string) {
  return category.trim().toLowerCase().replace(/\s+/g, " ");
}

export function applyRetrievalPolicy(
  decision: RetrievalPolicyInput,
): CategoryRetrievalDecision {
  const eligible = RETRIEVAL_ELIGIBLE_KINDS.has(decision.kind);
  return {
    ...decision,
    eligible,
    reason: eligible
      ? "Allowlisted well-indexed category type."
      : `Excluded category type: ${decision.kind}.`,
  };
}

export function classifyCategoryWithHeuristics(
  category: string,
): RetrievalPolicyInput {
  const normalizedCategory = normalizeCategoryForRetrieval(category);
  const text = ` ${normalizedCategory} `;

  let kind: RetrievalCategoryKind = "unknown";

  if (/\b(latest|current|newest)\b.*\b(version|versions|release|releases)\b/.test(text)) {
    kind = "release_version";
  } else if (/\b(schedule|fixture|fixtures|upcoming|tour dates?|calendar)\b/.test(text)) {
    kind = "public_schedule";
  } else if (/\b(law|laws|legal|regulation|regulations|statute|court|tax code)\b/.test(text)) {
    kind = "government_or_legal";
  } else if (/\b(ceo|cfo|cto|stock price|market cap|revenue|earnings|employees)\b/.test(text)) {
    kind = "public_company_fact";
  } else if (/\b(restaurants?|bars?|coffee shops?|businesses?|stores?|near me|open now|address|phone)\b/.test(text)) {
    kind = "business_listing";
  } else if (/\b(rumou?rs?|alleged|gossip|dating|secretly)\b/.test(text)) {
    kind = "rumor";
  } else if (/\b(best|favorite|favourite|worst|coolest|prettiest|most fun)\b/.test(text)) {
    kind = "subjective_preference";
  } else if (/\b(age|religion|ethnicity|race|health|medical|disability|sexual orientation|political affiliation)\b/.test(text)) {
    kind = "sensitive_personal_attribute";
  } else if (/\b(left-handed|right-handed|height|hometown|middle name|siblings?|spouse|married|birthday)\b/.test(text)) {
    kind = "low_indexability_biographical_detail";
  } else if (/\b(roster|squad|lineup|cast list|contestants?|players?|senators?|representatives?|board members?|cabinet members?)\b/.test(text)) {
    kind = "official_roster";
  } else if (/\b(winners?|losers?|results?|scores?|champions?|final standings|eliminated|elimination|won|winner)\b/.test(text)) {
    kind = "public_result";
  } else if (/\b(episodes?|season|seasons|movies?|films?|directed by|written by|starring|cast of|credits?|release dates?)\b/.test(text)) {
    kind = "canonical_media_metadata";
  }

  return { category, normalizedCategory, kind };
}

export async function classifyCategoryForRetrieval(
  category: string,
  options: CategoryClassifierOptions = {},
): Promise<CategoryRetrievalDecision> {
  const heuristic = classifyCategoryWithHeuristics(category);

  if (!options.useModel || env.OPENROUTER_MOCK || !env.OPENROUTER_API_KEY) {
    return applyRetrievalPolicy(heuristic);
  }

  try {
    const result = await callOpenRouterJson({
      model: options.model,
      timeoutMs: options.timeoutMs ?? 4_000,
      maxOutputTokens: 128,
      schema: classifierSchema,
      jsonSchema: classifierJsonSchema,
      messages: [
        {
          role: "user",
          content: [
            "Classify this game category for retrieval eligibility.",
            "Classify only the category, not submitted answers.",
            "Prefer unknown when unclear.",
            "Sparse personal traits, rumors, subjective categories, and sensitive traits are ineligible.",
            "Do not expand retrieval beyond official rosters, canonical media metadata, and public results.",
            "",
            JSON.stringify({ category }),
          ].join("\n"),
        },
      ],
    });

    return applyRetrievalPolicy({
      category,
      normalizedCategory:
        result.parsed.normalizedCategory || heuristic.normalizedCategory,
      kind: result.parsed.kind,
    });
  } catch {
    return applyRetrievalPolicy({
      category,
      normalizedCategory: heuristic.normalizedCategory,
      kind: "unknown",
    });
  }
}

export function getEvidenceFreshnessMs(kind: RetrievalCategoryKind) {
  switch (kind) {
    case "official_roster":
      return 60 * 24 * 60 * 60 * 1000;
    case "canonical_media_metadata":
      return 180 * 24 * 60 * 60 * 1000;
    case "public_result":
      return 90 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

export function getRetrievalTimeoutMs(_debug = false) {
  return 300_000;
}
