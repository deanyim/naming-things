import { eq } from "drizzle-orm";
import { type db as dbType } from "~/server/db";
import { soloRunAnswers } from "~/server/db/schema";
import {
  judgeCategoryFit,
  type CategoryFitResult,
} from "~/server/lib/verification/category-fit";
import { env } from "~/env";

type DB = typeof dbType;

export type ScoringResult = {
  score: number;
  validCount: number;
  invalidCount: number;
  ambiguousCount: number;
  judgeModel: string;
  judgeVersion: string;
  results: CategoryFitResult[];
};

/**
 * Classify all non-duplicate answers for a solo run and compute the score.
 * Only `valid` answers contribute to the score.
 */
export async function scoreRun(
  db: DB,
  runId: number,
  category: string,
): Promise<ScoringResult> {
  const answersToJudge = await db.query.soloRunAnswers.findMany({
    where: eq(soloRunAnswers.runId, runId),
  });

  const nonDuplicates = answersToJudge.filter((a) => !a.isDuplicate);

  const candidates = nonDuplicates.map((a) => ({
    answerId: a.id,
    text: a.text,
  }));

  const results = await judgeCategoryFit(category, candidates);

  // Persist labels onto answers concurrently
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

  const counts = computeCounts(results);
  const judgeModel = env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";
  const judgeVersion = "1";

  return {
    ...counts,
    judgeModel,
    judgeVersion,
    results,
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
