import { eq } from "drizzle-orm";
import { type db as dbType } from "~/server/db";
import { categoryAliases } from "~/server/db/schema";

type DB = typeof dbType;

export type CategoryNormalizationResult = {
  inputCategory: string;
  displayName: string;
  slug: string;
};

const prefixPattern = /^(types of|kinds of|examples of|list of|name some)\s+/;
const punctuationPattern = /^[^\w]+|[^\w]+$/g;
const whitespacePattern = /\s+/g;

// Lightweight plural cleanup: only strip trailing 's' when it's safe
// (avoids breaking words like "bus", "gas", "dress")
const IRREGULAR_PLURALS: Record<string, string> = {
  children: "child",
  people: "person",
  mice: "mouse",
  geese: "goose",
  teeth: "tooth",
  feet: "foot",
  oxen: "ox",
  dice: "die",
};

function safeToSingular(word: string): string {
  if (IRREGULAR_PLURALS[word]) return IRREGULAR_PLURALS[word];
  // Don't singularize short words or words ending in ss, us, is
  if (word.length <= 3) return word;
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) {
    return word;
  }
  if (word.endsWith("ies") && word.length > 4) {
    return word.slice(0, -3) + "y";
  }
  if (word.endsWith("ves") && word.length > 4) {
    return word.slice(0, -3) + "f";
  }
  if (word.endsWith("es") && (word.endsWith("shes") || word.endsWith("ches") || word.endsWith("xes") || word.endsWith("zes"))) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Deterministic category normalization pipeline.
 * Returns a displayName (cleaned but readable) and a slug (for bucketing).
 */
export function normalizeCategory(raw: string): {
  displayName: string;
  slug: string;
} {
  let text = raw.trim();
  text = text.toLowerCase();
  text = text.replace(/-/g, " ");
  text = text.replace(whitespacePattern, " ");
  text = text.replace(punctuationPattern, "");
  text = text.replace(/&/g, "and");
  text = text.replace(prefixPattern, "");
  text = text.trim();

  const displayName = text;

  // For slug: apply singular normalization for bucketing
  const words = text.split(" ").map(safeToSingular);
  const slug = words.join("-");

  return { displayName, slug };
}

/**
 * Normalize a category and resolve against DB aliases.
 * If an alias match is found, use the canonical name/slug.
 */
export async function resolveCategory(
  db: DB,
  rawInput: string,
): Promise<CategoryNormalizationResult> {
  const { displayName, slug } = normalizeCategory(rawInput);

  // Check aliases table using the slug
  const alias = await db.query.categoryAliases.findFirst({
    where: eq(categoryAliases.aliasSlug, slug),
  });

  if (alias) {
    return {
      inputCategory: rawInput,
      displayName: alias.canonicalName,
      slug: alias.canonicalSlug,
    };
  }

  // First time seeing this slug — register it so the first display name becomes canonical
  if (slug) {
    await db.insert(categoryAliases).values({
      alias: displayName,
      aliasSlug: slug,
      canonicalName: displayName,
      canonicalSlug: slug,
    });
  }

  return {
    inputCategory: rawInput,
    displayName,
    slug,
  };
}
