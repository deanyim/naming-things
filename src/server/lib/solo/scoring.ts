import { createHash } from "crypto";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { type db as dbType } from "~/server/db";
import {
  soloRunAnswers,
  soloCategoryAnswerJudgments,
  soloRuns,
  soloRunJudgmentHistory,
  type SoloRunJudgmentSnapshotAnswer,
} from "~/server/db/schema";
import {
  judgeCategoryFit,
  type CategoryFitResult,
} from "~/server/lib/verification/category-fit";
import { CATEGORY_FIT_PROMPT } from "~/server/lib/verification/prompts";
import {
  getExistingCategoryEvidencePacket,
  getLatestCategoryEvidencePacket,
  recordCategoryJudgeRun,
} from "~/server/lib/verification/retrieval/packets";
import { resolveCategorySpec } from "~/server/lib/verification/retrieval/category-resolver";
import type { CategoryEvidencePacket } from "~/server/lib/verification/types";
import { env } from "~/env";

type DB = typeof dbType;

const BACKGROUND_BATCH_SIZE = 25;
const ANSWER_NORMALIZER_VERSION = "1";
const JUDGMENT_CACHE_SCHEMA_VERSION = "1";

export type SoloJudgmentCacheMode = "use" | "bypass";
type JudgmentSource = "cache" | "fresh";
type CachedJudgmentResult = CategoryFitResult & {
  cacheId: number;
  sourceRunId: number | null;
  sourceAnswerId: number | null;
};
type PersistableJudgmentResult = CategoryFitResult & {
  judgmentSource?: JudgmentSource;
  judgmentCacheId?: number | null;
};

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

export function computeSoloJudgmentContextKey(input: {
  judgeModel: string;
  judgeVersion: string;
  categoryEvidencePacketId: string | null;
}): string {
  return createHash("sha256")
    .update(input.judgeVersion)
    .update("|")
    .update(input.judgeModel)
    .update("|")
    .update(input.categoryEvidencePacketId ?? "none")
    .update("|")
    .update(ANSWER_NORMALIZER_VERSION)
    .update("|")
    .update(JUDGMENT_CACHE_SCHEMA_VERSION)
    .digest("hex")
    .slice(0, 16);
}

export type ScoringResult = {
  score: number;
  validCount: number;
  invalidCount: number;
  ambiguousCount: number;
  judgeModel: string;
  judgeVersion: string;
  categoryEvidencePacketId: string | null;
  results: CategoryFitResult[];
};

async function classifyAndPersist(
  db: DB,
  input: {
    category: string;
    categorySlug: string;
    sourceRunId: number;
    candidates: {
      answerId: number;
      text: string;
      normalizedText: string;
    }[];
    evidencePacket?: CategoryEvidencePacket | null;
    cacheMode?: SoloJudgmentCacheMode;
  },
): Promise<CategoryFitResult[]> {
  const {
    category,
    categorySlug,
    sourceRunId,
    candidates,
    evidencePacket = null,
    cacheMode = "use",
  } = input;
  if (candidates.length === 0) return [];

  const judgeModel = getJudgeModel();
  const judgeVersion = computeJudgeVersion();
  const judgmentContextKey = computeSoloJudgmentContextKey({
    judgeModel,
    judgeVersion,
    categoryEvidencePacketId: evidencePacket?.id ?? null,
  });

  const cachedResults =
    cacheMode === "use"
      ? await getCachedJudgments(db, {
          categorySlug,
          judgmentContextKey,
          candidates,
        })
      : new Map<string, CachedJudgmentResult>();

  const cachedByAnswerId = new Map<number, PersistableJudgmentResult>();
  const misses: typeof candidates = [];
  for (const candidate of candidates) {
    const cached = cachedResults.get(candidate.normalizedText);
    if (cached) {
      cachedByAnswerId.set(candidate.answerId, {
        ...cached,
        answerId: candidate.answerId,
        judgmentSource: "cache",
        judgmentCacheId: cached.cacheId,
      });
    } else {
      misses.push(candidate);
    }
  }

  await persistClassificationResults(db, Array.from(cachedByAnswerId.values()));

  const judgedResults =
    misses.length > 0
      ? await judgeCategoryFit(
          category,
          misses.map((candidate) => ({
            answerId: candidate.answerId,
            text: candidate.text,
          })),
          {
            retrieval: {
              enabled: !!evidencePacket,
              evidencePacket,
            },
          },
        )
      : [];

  await persistClassificationResults(
    db,
    judgedResults.map((result) => ({
      ...result,
      judgmentSource: "fresh",
      judgmentCacheId: null,
    })),
  );

  if (judgedResults.length > 0) {
    await writeJudgmentsToCache(db, {
      categorySlug,
      categoryDisplayName: category,
      sourceRunId,
      candidates: misses,
      results: judgedResults,
      judgeModel,
      judgeVersion,
      categoryEvidencePacketId: evidencePacket?.id ?? null,
      judgmentContextKey,
      overwrite: cacheMode === "bypass",
    });
  }

  if (judgedResults.length > 0) {
    const canonical = await getCachedJudgments(db, {
      categorySlug,
      judgmentContextKey,
      candidates: misses,
    });
    const canonicalResults: PersistableJudgmentResult[] = misses.flatMap(
      (candidate) => {
        const cached = canonical.get(candidate.normalizedText);
        return cached
          ? [
              {
                ...cached,
                answerId: candidate.answerId,
                judgmentSource:
                  cached.sourceAnswerId === candidate.answerId
                    ? "fresh"
                    : "cache",
                judgmentCacheId: cached.cacheId,
              },
            ]
          : [];
      },
    );
    if (canonicalResults.length > 0) {
      await persistClassificationResults(db, canonicalResults);
      for (const result of canonicalResults) {
        cachedByAnswerId.set(result.answerId, result);
      }
    }
  }

  const judgedByAnswerId = new Map(
    judgedResults.map((result) => [
      result.answerId,
      {
        ...result,
        judgmentSource: "fresh" as const,
        judgmentCacheId: null,
      },
    ]),
  );

  return candidates.map((candidate) => {
    const cached = cachedByAnswerId.get(candidate.answerId);
    if (cached) return cached;
    return judgedByAnswerId.get(candidate.answerId)!;
  });
}

async function persistClassificationResults(
  db: DB,
  results: PersistableJudgmentResult[],
) {
  if (results.length === 0) return;

  await Promise.all(
    results.map((result) =>
      db
        .update(soloRunAnswers)
        .set({
          label: result.label,
          confidence: result.confidence,
          reason: result.reason,
          judgmentSource: result.judgmentSource ?? null,
          judgmentCacheId: result.judgmentCacheId ?? null,
        })
        .where(eq(soloRunAnswers.id, result.answerId)),
    ),
  );
}

async function getCachedJudgments(
  db: DB,
  input: {
    categorySlug: string;
    judgmentContextKey: string;
    candidates: { normalizedText: string }[];
  },
): Promise<Map<string, CachedJudgmentResult>> {
  if (typeof db.select !== "function") return new Map();

  const normalizedTexts = Array.from(
    new Set(input.candidates.map((candidate) => candidate.normalizedText)),
  );
  if (normalizedTexts.length === 0) return new Map();

  const rows = await db
    .select()
    .from(soloCategoryAnswerJudgments)
    .where(
      and(
        eq(soloCategoryAnswerJudgments.categorySlug, input.categorySlug),
        eq(
          soloCategoryAnswerJudgments.judgmentContextKey,
          input.judgmentContextKey,
        ),
        inArray(soloCategoryAnswerJudgments.normalizedText, normalizedTexts),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.normalizedText,
      {
        answerId: row.sourceAnswerId ?? 0,
        cacheId: row.id,
        label: row.label,
        confidence: row.confidence ?? 0,
        reason: row.reason ?? "",
        sourceRunId: row.sourceRunId,
        sourceAnswerId: row.sourceAnswerId,
      },
    ]),
  );
}

async function writeJudgmentsToCache(
  db: DB,
  input: {
    categorySlug: string;
    categoryDisplayName: string;
    sourceRunId: number;
    candidates: {
      answerId: number;
      normalizedText: string;
    }[];
    results: CategoryFitResult[];
    judgeModel: string;
    judgeVersion: string;
    categoryEvidencePacketId: string | null;
    judgmentContextKey: string;
    overwrite: boolean;
  },
) {
  if (typeof db.select !== "function") return;

  const resultMap = new Map(input.results.map((result) => [result.answerId, result]));
  const values = input.candidates.flatMap((candidate) => {
    const result = resultMap.get(candidate.answerId);
    if (!result) return [];
    return [
      {
        categorySlug: input.categorySlug,
        categoryDisplayName: input.categoryDisplayName,
        normalizedText: candidate.normalizedText,
        label: result.label,
        confidence: result.confidence,
        reason: result.reason,
        judgeModel: input.judgeModel,
        judgeVersion: input.judgeVersion,
        categoryEvidencePacketId: input.categoryEvidencePacketId,
        judgmentContextKey: input.judgmentContextKey,
        sourceRunId: input.sourceRunId,
        sourceAnswerId: candidate.answerId,
      },
    ];
  });

  if (values.length === 0) return;

  const insert = db.insert(soloCategoryAnswerJudgments).values(values);
  if (input.overwrite) {
    await insert.onConflictDoUpdate({
      target: [
        soloCategoryAnswerJudgments.categorySlug,
        soloCategoryAnswerJudgments.normalizedText,
        soloCategoryAnswerJudgments.judgmentContextKey,
      ],
      set: {
        categoryDisplayName: input.categoryDisplayName,
        label: excluded(soloCategoryAnswerJudgments.label),
        confidence: excluded(soloCategoryAnswerJudgments.confidence),
        reason: excluded(soloCategoryAnswerJudgments.reason),
        judgeModel: input.judgeModel,
        judgeVersion: input.judgeVersion,
        categoryEvidencePacketId: input.categoryEvidencePacketId,
        sourceRunId: input.sourceRunId,
        sourceAnswerId: excluded(soloCategoryAnswerJudgments.sourceAnswerId),
        updatedAt: new Date(),
      },
    });
    return;
  }

  await insert.onConflictDoNothing({
    target: [
      soloCategoryAnswerJudgments.categorySlug,
      soloCategoryAnswerJudgments.normalizedText,
      soloCategoryAnswerJudgments.judgmentContextKey,
    ],
  });
}

function excluded(column: { name: string }) {
  return sql.raw(`excluded."${column.name}"`);
}

export const __soloJudgmentCacheForTest = {
  classifyAndPersist,
};

/**
 * Check if there are enough unclassified answers to trigger a background
 * classification batch. Called after each answer submission for runs > 30s.
 * Fires and forgets — errors are logged but don't affect the caller.
 */
export function maybeClassifyBatch(
  db: DB,
  runId: number,
  category: string,
  categorySlug?: string | null,
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
      const candidates = batch.map((a) => ({
        answerId: a.id,
        text: a.text,
        normalizedText: a.normalizedText,
      }));
      const evidencePacket = await getExistingCategoryEvidencePacket(db, category, {
        categorySlug,
      });
      await classifyAndPersist(db, {
        category,
        categorySlug: categorySlug ?? category,
        sourceRunId: runId,
        candidates,
        evidencePacket,
        cacheMode: "use",
      });
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
  categorySlug?: string | null,
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
    normalizedText: a.normalizedText,
  }));

  const evidencePacket = await getExistingCategoryEvidencePacket(db, category, {
    categorySlug,
  });

  const newResults = await classifyAndPersist(db, {
    category,
    categorySlug: categorySlug ?? category,
    sourceRunId: runId,
    candidates,
    evidencePacket,
    cacheMode: "use",
  });

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
  await recordCategoryJudgeRun(
    db,
    `solo:${runId}`,
    evidencePacket?.id ?? null,
  );

  return {
    ...counts,
    judgeModel,
    judgeVersion,
    categoryEvidencePacketId: evidencePacket?.id ?? null,
    results: allResults,
  };
}

export class JudgeVersionAlreadyCurrentError extends Error {
  constructor() {
    super("Judge version is already up to date");
    this.name = "JudgeVersionAlreadyCurrentError";
  }
}

async function getNewerEvidencePacketIdForRun(
  db: DB,
  run: {
    categoryDisplayName: string;
    categorySlug?: string | null;
    categoryEvidencePacketId: string | null;
  },
) {
  if (typeof db.select !== "function") return null;

  if (run.categorySlug) {
    const latestForSlug = await getExistingCategoryEvidencePacket(
      db,
      run.categoryDisplayName,
      { includeStale: true, categorySlug: run.categorySlug },
    );
    if (latestForSlug && latestForSlug.id !== run.categoryEvidencePacketId) {
      return latestForSlug.id;
    }
  }

  const spec = resolveCategorySpec(run.categoryDisplayName);

  const latest = await getLatestCategoryEvidencePacket(
    db,
    spec.normalizedCategory,
    { includeStale: true },
  );

  if (!latest || latest.id === run.categoryEvidencePacketId) return null;
  return latest.id;
}

/**
 * Re-run category-fit judging on an already-finished run, snapshotting
 * the previous classification into `soloRunJudgmentHistory` first so the
 * old labels are preserved for review.
 *
 * Throws `JudgeVersionAlreadyCurrentError` if the stored judgeVersion
 * already matches the current config and no newer evidence packet exists —
 * both before and after acquiring the classification lock, to guard against
 * concurrent reruns.
 */
export async function rerunJudgingForRun(
  db: DB,
  runId: number,
  options: { force?: boolean; cacheMode?: SoloJudgmentCacheMode } = {},
): Promise<void> {
  const currentVersion = computeJudgeVersion();
  const force = options.force === true;
  const cacheMode = options.cacheMode ?? "use";

  const initialRun = await db.query.soloRuns.findFirst({
    where: eq(soloRuns.id, runId),
  });
  if (!initialRun) {
    throw new Error(`Solo run ${runId} not found`);
  }
  if (initialRun.status !== "finished") {
    throw new Error(`Solo run ${runId} is not finished`);
  }
  const initialNewerEvidencePacketId = await getNewerEvidencePacketIdForRun(
    db,
    initialRun,
  );
  if (
    !force &&
    initialRun.judgeVersion === currentVersion &&
    !initialNewerEvidencePacketId
  ) {
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
    const newerEvidencePacketId = await getNewerEvidencePacketIdForRun(db, run);
    if (!force && run.judgeVersion === currentVersion && !newerEvidencePacketId) {
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
      categoryEvidencePacketId: run.categoryEvidencePacketId,
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
      normalizedText: a.normalizedText,
    }));

    const evidencePacket = await getExistingCategoryEvidencePacket(
      db,
      run.categoryDisplayName,
      {
        includeStale: !!newerEvidencePacketId,
        categorySlug: run.categorySlug,
      },
    );

    await classifyAndPersist(db, {
      category: run.categoryDisplayName,
      categorySlug: run.categorySlug,
      sourceRunId: run.id,
      candidates,
      evidencePacket,
      cacheMode,
    });

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
        categoryEvidencePacketId: evidencePacket?.id ?? null,
      })
      .where(eq(soloRuns.id, runId));

    await recordCategoryJudgeRun(
      db,
      `solo:${runId}`,
      evidencePacket?.id ?? null,
    );
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
