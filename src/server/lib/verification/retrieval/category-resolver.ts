import type { CategorySpec } from "../types";

export function normalizeCanonicalCategory(category: string) {
  return category.trim().toLowerCase().replace(/\s+/g, " ");
}

function specId(normalizedCategory: string) {
  return normalizedCategory
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

type KnownCategorySpec = Omit<
  CategorySpec,
  "rawCategory" | "normalizedCategory" | "buildable"
>;

function knownPersonSpec(
  id: string,
  freshness: CategorySpec["freshness"],
  knownSourceUrls: string[],
): KnownCategorySpec {
  return {
    id,
    entityType: "person",
    unit: "entity",
    knownSourceUrls,
    freshness,
  };
}

const KNOWN_CATEGORY_SPECS: Record<string, KnownCategorySpec> = {
  "survivor contestants": knownPersonSpec("survivor-us-contestants", "seasonal", [
    "https://en.wikipedia.org/wiki/List_of_Survivor_(American_TV_series)_contestants",
  ]),
  "survivor us contestants": knownPersonSpec("survivor-us-contestants", "seasonal", [
    "https://en.wikipedia.org/wiki/List_of_Survivor_(American_TV_series)_contestants",
  ]),
  "survivor american contestants": knownPersonSpec("survivor-us-contestants", "seasonal", [
    "https://en.wikipedia.org/wiki/List_of_Survivor_(American_TV_series)_contestants",
  ]),
  "us presidents": knownPersonSpec("us-presidents", "static", [
    "https://en.wikipedia.org/wiki/List_of_presidents_of_the_United_States",
  ]),
  pokemon: {
    id: "pokemon",
    entityType: "other",
    unit: "entity",
    knownSourceUrls: ["https://en.wikipedia.org/wiki/List_of_Pok%C3%A9mon"],
    freshness: "seasonal",
  },
  "nfl quarterbacks": {
    id: "nfl-quarterbacks",
    entityType: "person",
    unit: "entity",
    freshness: "seasonal",
  },
};

function isBuildableCategory(normalizedCategory: string) {
  return /\b(contestants?|players?|roster|cast|starring|members?|cabinet|administration|officials?|ministers?|presidents?|pokemon|countries|quarterbacks?|qbs?|running backs?|wide receivers?|tight ends?|linebackers?|pitchers?|goalkeepers?)\b/.test(normalizedCategory);
}

function isPersonCategory(normalizedCategory: string) {
  return /\b(contestants?|players?|members?|cabinet|administration|officials?|ministers?|presidents?|cast|starring|quarterbacks?|qbs?|running backs?|wide receivers?|tight ends?|linebackers?|pitchers?|goalkeepers?)\b/.test(normalizedCategory);
}

function hasCurrentModifier(normalizedCategory: string) {
  return /\b(current|active|today)\b/.test(normalizedCategory);
}

function isSubjectiveCategory(normalizedCategory: string) {
  return /\b(best|favorite|favourite|worst|coolest|prettiest|most fun)\b/.test(normalizedCategory);
}

export function resolveCategorySpec(category: string): CategorySpec {
  const normalizedCategory = normalizeCanonicalCategory(category);
  const known = KNOWN_CATEGORY_SPECS[normalizedCategory];

  if (known) {
    return {
      ...known,
      rawCategory: category,
      normalizedCategory,
      buildable: true,
    };
  }

  if (isSubjectiveCategory(normalizedCategory)) {
    return {
      id: specId(normalizedCategory),
      rawCategory: category,
      normalizedCategory,
      buildable: false,
      notBuildableReason: "Subjective categories are not canonical datasets.",
      entityType: "other",
      unit: "entity",
      freshness: "unknown",
    };
  }

  if (isBuildableCategory(normalizedCategory)) {
    const currentOnly = hasCurrentModifier(normalizedCategory);
    return {
      id: specId(normalizedCategory),
      rawCategory: category,
      normalizedCategory,
      buildable: true,
      entityType: isPersonCategory(normalizedCategory) ? "person" : "other",
      unit: "entity",
      freshness: currentOnly ? "daily" : "unknown",
    };
  }

  return {
    id: specId(normalizedCategory),
    rawCategory: category,
    normalizedCategory,
    buildable: false,
    notBuildableReason:
      "No deterministic Wikipedia dataset strategy is known for this category.",
    entityType: "other",
    unit: "entity",
    freshness: "unknown",
  };
}

export function isDatasetBuildable(spec: CategorySpec) {
  return spec.buildable;
}
