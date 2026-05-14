import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "~/server/db";
import {
  soloCategoryAnswerJudgments,
  soloRunAnswers,
  soloRuns,
} from "~/server/db/schema";
import { computeSoloJudgmentContextKey } from "~/server/lib/solo/scoring";

type CacheKey = string;

function makeKey(input: {
  categorySlug: string;
  normalizedText: string;
  judgmentContextKey: string;
}): CacheKey {
  return [
    input.categorySlug,
    input.normalizedText,
    input.judgmentContextKey,
  ].join("\u001f");
}

const rows = await db
  .select({
    runId: soloRuns.id,
    categorySlug: soloRuns.categorySlug,
    categoryDisplayName: soloRuns.categoryDisplayName,
    judgeModel: soloRuns.judgeModel,
    judgeVersion: soloRuns.judgeVersion,
    categoryEvidencePacketId: soloRuns.categoryEvidencePacketId,
    runCreatedAt: soloRuns.createdAt,
    runEndedAt: soloRuns.endedAt,
    answerId: soloRunAnswers.id,
    normalizedText: soloRunAnswers.normalizedText,
    label: soloRunAnswers.label,
    confidence: soloRunAnswers.confidence,
    reason: soloRunAnswers.reason,
  })
  .from(soloRunAnswers)
  .innerJoin(soloRuns, eq(soloRunAnswers.runId, soloRuns.id))
  .where(
    and(
      eq(soloRuns.status, "finished"),
      eq(soloRunAnswers.isDuplicate, false),
      isNotNull(soloRunAnswers.label),
      isNotNull(soloRuns.judgeVersion),
    ),
  )
  .orderBy(
    desc(soloRuns.endedAt),
    desc(soloRuns.createdAt),
    desc(soloRunAnswers.id),
  );

const selected = new Map<
  CacheKey,
  (typeof rows)[number] & { judgmentContextKey: string }
>();
const conflicts = new Map<CacheKey, number>();

for (const row of rows) {
  if (!row.label || !row.judgeVersion) continue;

  const judgmentContextKey = computeSoloJudgmentContextKey({
    judgeModel: row.judgeModel ?? "unknown",
    judgeVersion: row.judgeVersion,
    categoryEvidencePacketId: row.categoryEvidencePacketId,
  });
  const key = makeKey({
    categorySlug: row.categorySlug,
    normalizedText: row.normalizedText,
    judgmentContextKey,
  });

  const existing = selected.get(key);
  if (!existing) {
    selected.set(key, { ...row, judgmentContextKey });
    continue;
  }

  if (
    existing.label !== row.label ||
    existing.confidence !== row.confidence ||
    existing.reason !== row.reason
  ) {
    conflicts.set(key, (conflicts.get(key) ?? 0) + 1);
  }
}

const values = Array.from(selected.values()).map((row) => ({
  categorySlug: row.categorySlug,
  categoryDisplayName: row.categoryDisplayName,
  normalizedText: row.normalizedText,
  label: row.label!,
  confidence: row.confidence,
  reason: row.reason,
  judgeModel: row.judgeModel,
  judgeVersion: row.judgeVersion!,
  categoryEvidencePacketId: row.categoryEvidencePacketId,
  judgmentContextKey: row.judgmentContextKey,
  sourceRunId: row.runId,
  sourceAnswerId: row.answerId,
}));

const chunkSize = 500;
let insertedOrSkipped = 0;
for (let i = 0; i < values.length; i += chunkSize) {
  const chunk = values.slice(i, i + chunkSize);
  await db
    .insert(soloCategoryAnswerJudgments)
    .values(chunk)
    .onConflictDoNothing({
      target: [
        soloCategoryAnswerJudgments.categorySlug,
        soloCategoryAnswerJudgments.normalizedText,
        soloCategoryAnswerJudgments.judgmentContextKey,
      ],
    });
  insertedOrSkipped += chunk.length;
}

console.log(
  JSON.stringify(
    {
      eligibleRows: rows.length,
      canonicalRows: values.length,
      insertedOrAlreadyPresent: insertedOrSkipped,
      conflictingKeys: conflicts.size,
      conflictingHistoricalRows: Array.from(conflicts.values()).reduce(
        (sum, count) => sum + count,
        0,
      ),
    },
    null,
    2,
  ),
);
