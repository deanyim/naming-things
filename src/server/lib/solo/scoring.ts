import { eq, and, isNull } from "drizzle-orm";
import { type db as dbType } from "~/server/db";
import { soloRunAnswers } from "~/server/db/schema";
import {
  judgeCategoryFit,
  type CategoryFitResult,
} from "~/server/lib/verification/category-fit";
import { env } from "~/env";

type DB = typeof dbType;

const BACKGROUND_BATCH_SIZE = 25;

export type ScoringResult = {
  score: number;
  validCount: number;
  invalidCount: number;
  ambiguousCount: number;
  judgeModel: string;
  judgeVersion: string;
  results: CategoryFitResult[];
};

async function classifyAndPersist(
  db: DB,
  category: string,
  candidates: { answerId: number; text: string }[],
): Promise<CategoryFitResult[]> {
  if (candidates.length === 0) return [];

  const results = await judgeCategoryFit(category, candidates);

  await Promise.all(
    results.map((result) =>
      db
        .update(soloRunAnswers)
        .set({
          label: result.label,
          confidence: result.confidence,
          reason: result.reason,
        })
        .where(eq(soloRunAnswers.id, result.answerId)),
    ),
  );

  return results;
}

/**
 * Check if there are enough unclassified answers to trigger a background
 * classification batch. Called after each answer submission for runs > 30s.
 * Fires and forgets — errors are logged but don't affect the caller.
 */
export function maybeClassifyBatch(
  db: DB,
  runId: number,
  category: string,
): void {
  void (async () => {
    try {
      const unclassified = await db.query.soloRunAnswers.findMany({
        where: and(
          eq(soloRunAnswers.runId, runId),
          eq(soloRunAnswers.isDuplicate, false),
          isNull(soloRunAnswers.label),
        ),
      });

      if (unclassified.length < BACKGROUND_BATCH_SIZE) return;

      const batch = unclassified.slice(0, BACKGROUND_BATCH_SIZE);
      const candidates = batch.map((a) => ({ answerId: a.id, text: a.text }));
      await classifyAndPersist(db, category, candidates);
    } catch (err) {
      console.error("Background classification batch failed:", err);
    }
  })();
}

/**
 * Classify all remaining unclassified answers for a solo run and compute
 * the final score. Answers already classified by background batches are
 * included in the count but not re-classified.
 */
export async function scoreRun(
  db: DB,
  runId: number,
  category: string,
): Promise<ScoringResult> {
  const allAnswers = await db.query.soloRunAnswers.findMany({
    where: eq(soloRunAnswers.runId, runId),
  });

  const nonDuplicates = allAnswers.filter((a) => !a.isDuplicate);

  // Only classify answers that haven't been classified yet
  const unclassified = nonDuplicates.filter((a) => a.label === null);
  const candidates = unclassified.map((a) => ({
    answerId: a.id,
    text: a.text,
  }));

  const newResults = await classifyAndPersist(db, category, candidates);

  // Combine pre-classified results with newly classified ones
  const preClassified: CategoryFitResult[] = nonDuplicates
    .filter((a) => a.label !== null)
    .map((a) => ({
      answerId: a.id,
      label: a.label!,
      confidence: a.confidence ?? 0,
      reason: a.reason ?? "",
    }));

  const allResults = [...preClassified, ...newResults];
  const counts = computeCounts(allResults);
  const judgeModel = env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";
  const judgeVersion = "1";

  return {
    ...counts,
    judgeModel,
    judgeVersion,
    results: allResults,
  };
}

/**
 * Compute score from classification results.
 * Only `valid` labels contribute to score. `ambiguous` and `invalid` score 0.
 */
export function computeCounts(results: CategoryFitResult[]): {
  score: number;
  validCount: number;
  invalidCount: number;
  ambiguousCount: number;
} {
  let validCount = 0;
  let invalidCount = 0;
  let ambiguousCount = 0;

  for (const r of results) {
    switch (r.label) {
      case "valid":
        validCount++;
        break;
      case "invalid":
        invalidCount++;
        break;
      case "ambiguous":
        ambiguousCount++;
        break;
    }
  }

  return {
    score: validCount,
    validCount,
    invalidCount,
    ambiguousCount,
  };
}
