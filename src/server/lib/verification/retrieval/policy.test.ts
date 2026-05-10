import { describe, expect, it } from "vitest";
import {
  RETRIEVAL_ELIGIBLE_KINDS,
  applyRetrievalPolicy,
  classifyCategoryWithHeuristics,
  normalizeCategoryForRetrieval,
} from "./policy";
import type { RetrievalCategoryKind } from "../types";

const ALL_KINDS: RetrievalCategoryKind[] = [
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
];

describe("retrieval policy", () => {
  it("only allows the three v1 retrieval kinds", () => {
    for (const kind of ALL_KINDS) {
      const decision = applyRetrievalPolicy({
        category: "test",
        normalizedCategory: "test",
        kind,
      });

      expect(decision.eligible).toBe(RETRIEVAL_ELIGIBLE_KINDS.has(kind));
    }
  });

  it("normalizes categories deterministically", () => {
    expect(normalizeCategoryForRetrieval("  Survivor   48 Contestants ")).toBe(
      "survivor 48 contestants",
    );
  });
});

describe("category classifier heuristics", () => {
  it.each([
    ["Survivor 48 contestants", "official_roster"],
    ["Survivor season 50 contestants", "official_roster"],
    ["Survivor winners", "public_result"],
    ["movies directed by Greta Gerwig", "canonical_media_metadata"],
    ["left-handed Survivor contestants", "low_indexability_biographical_detail"],
    ["latest npm package versions", "release_version"],
  ] as const)("%s -> %s", (category, expectedKind) => {
    expect(classifyCategoryWithHeuristics(category).kind).toBe(expectedKind);
  });
});
