import { createHash } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { type db as dbType } from "~/server/db";
import {
  soloRunAnswers,
  soloRuns,
  soloRunJudgmentHistory,
  type SoloRunJudgmentSnapshotAnswer,
} from "~/server/db/schema";
import {
  judgeCategoryFit,
  type CategoryFitResult,
} from "~/server/lib/verification/category-fit";
import { CATEGORY_FIT_PROMPT } from "~/server/lib/verification/prompts";
import { env } from "~/env";

type DB = typeof dbType;

const BACKGROUND_BATCH_SIZE = 25;

// Per-run lock to prevent concurrent classification of the same answers.
// Maps runId to a promise that resolves when the in-flight batch completes.
const classifyLocks = new Map<number, Promise<void>>();

// Exposed for tests so they can observe/await/clear the lock map.
export const __classifyLocksForTest = classifyLocks;

export function getJudgeModel(): string {
  return env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";
}

/**
 * Deterministic short hash of the current judging configuration
 * (category-fit prompt + model). Used as `judgeVersion` so we can
 * detect when a stored run was judged under stale config.
 */
export function computeJudgeVersion(): string {
  const model = getJudgeModel();
  return createHash("sha256")
    .update(CATEGORY_FIT_PROMPT)
    .update("|")
    .update(model)
    .digest("hex")
    .slice(0, 8);
}

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
  // Skip if a batch is already in-flight for this run
  if (classifyLocks.has(runId)) return;

  const work = (async () => {
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
    } finally {
      classifyLocks.delete(runId);
    }
  })();

  classifyLocks.set(runId, work);
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
  // Wait for any in-flight background batch to finish before scoring
  const pending = classifyLocks.get(runId);
  if (pending) await pending;

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
  const judgeModel = getJudgeModel();
  const judgeVersion = computeJudgeVersion();

  return {
    ...counts,
    judgeModel,
    judgeVersion,
    results: allResults,
  };
}

export class JudgeVersionAlreadyCurrentError extends Error {
  constructor() {
    super("Judge version is already up to date");
    this.name = "JudgeVersionAlreadyCurrentError";
  }
}

/**
 * Re-run category-fit judging on an already-finished run, snapshotting
 * the previous classification into `soloRunJudgmentHistory` first so the
 * old labels are preserved for review.
 *
 * Throws `JudgeVersionAlreadyCurrentError` if the stored judgeVersion
 * already matches the current config — both before and after acquiring
 * the classification lock, to guard against concurrent reruns.
 */
export async function rerunJudgingForRun(
  db: DB,
  runId: number,
): Promise<void> {
  const currentVersion = computeJudgeVersion();

  const initialRun = await db.query.soloRuns.findFirst({
    where: eq(soloRuns.id, runId),
  });
  if (!initialRun) {
    throw new Error(`Solo run ${runId} not found`);
  }
  if (initialRun.status !== "finished") {
    throw new Error(`Solo run ${runId} is not finished`);
  }
  if (initialRun.judgeVersion === currentVersion) {
    throw new JudgeVersionAlreadyCurrentError();
  }

  // Wait for any in-flight background batch before taking the lock
  const pending = classifyLocks.get(runId);
  if (pending) await pending;

  const work = (async () => {
    // Re-check staleness after the lock — another rerun could have completed
    // while we were waiting.
    const run = await db.query.soloRuns.findFirst({
      where: eq(soloRuns.id, runId),
    });
    if (!run) {
      throw new Error(`Solo run ${runId} not found`);
    }
    if (run.judgeVersion === currentVersion) {
      throw new JudgeVersionAlreadyCurrentError();
    }

    const answersBefore = await db.query.soloRunAnswers.findMany({
      where: eq(soloRunAnswers.runId, runId),
    });
    const nonDuplicates = answersBefore.filter((a) => !a.isDuplicate);

    // Snapshot the state we're about to overwrite.
    const snapshot: SoloRunJudgmentSnapshotAnswer[] = nonDuplicates.map(
      (a) => ({
        answerId: a.id,
        text: a.text,
        label: a.label,
        confidence: a.confidence,
        reason: a.reason,
      }),
    );

    await db.insert(soloRunJudgmentHistory).values({
      runId: run.id,
      judgeModel: run.judgeModel,
      judgeVersion: run.judgeVersion,
      score: run.score,
      validCount: run.validCount,
      invalidCount: run.invalidCount,
      ambiguousCount: run.ambiguousCount,
      answersSnapshot: snapshot,
    });

    // Re-classify every non-duplicate answer (not just unclassified ones —
    // the whole point of rerun is to overwrite the existing labels).
    const candidates = nonDuplicates.map((a) => ({
      answerId: a.id,
      text: a.text,
    }));

    await classifyAndPersist(db, run.categoryDisplayName, candidates);

    // Recompute counts from the fresh state.
    const answersAfter = await db.query.soloRunAnswers.findMany({
      where: eq(soloRunAnswers.runId, runId),
    });
    const results: CategoryFitResult[] = answersAfter
      .filter((a) => !a.isDuplicate && a.label !== null)
      .map((a) => ({
        answerId: a.id,
        label: a.label!,
        confidence: a.confidence ?? 0,
        reason: a.reason ?? "",
      }));
    const counts = computeCounts(results);

    await db
      .update(soloRuns)
      .set({
        score: counts.score,
        validCount: counts.validCount,
        invalidCount: counts.invalidCount,
        ambiguousCount: counts.ambiguousCount,
        judgeModel: getJudgeModel(),
        judgeVersion: currentVersion,
      })
      .where(eq(soloRuns.id, runId));
  })();

  // Wrap the work promise so waiters in the lock map never observe its
  // error (we don't want the error to leak to other rerun callers that
  // are just waiting for the slot to free up — they should proceed and
  // re-check staleness themselves). The real error still propagates to
  // the current caller via `await work` below.
  const lockPromise = work.then(
    () => undefined,
    () => undefined,
  );
  classifyLocks.set(runId, lockPromise);

  try {
    await work;
  } finally {
    // Only clear the map entry if it's still ours. Another rerun that
    // started while we were running may have already overwritten it, in
    // which case deleting would wipe their lock.
    if (classifyLocks.get(runId) === lockPromise) {
      classifyLocks.delete(runId);
    }
  }
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
