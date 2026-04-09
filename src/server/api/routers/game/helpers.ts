import { eq, and, asc } from "drizzle-orm";
import { env } from "~/env";
import {
  games,
  gamePlayers,
  answers,
  answerVerifications,
} from "~/server/db/schema";
import { normalizeAnswer } from "~/lib/normalize";
import { judgeCategoryFit } from "~/server/lib/verification/category-fit";
import type { CategoryFitResult } from "~/server/lib/verification/category-fit";
import { type db as dbType } from "~/server/db";

export type DB = typeof dbType;
export const CLASSIFICATION_RETRY_AFTER_MS = 15_000;

export { normalizeAnswer };

export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/1/O/0
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generateSlug(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let slug = "";
  for (let i = 0; i < 8; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }
  return slug;
}

export type AdvanceTurnResult = {
  nextPlayerId: number | null;
  nextDeadline: Date | null;
  gameFinished: boolean;
};

export async function advanceTurn(
  dbOrTx: DB | Parameters<Parameters<DB["transaction"]>[0]>[0],
  gameId: number,
  currentTurnPlayerId: number,
  turnTimerSeconds: number,
): Promise<AdvanceTurnResult> {
  const allPlayers = await dbOrTx.query.gamePlayers.findMany({
    where: and(
      eq(gamePlayers.gameId, gameId),
      eq(gamePlayers.isSpectator, false),
    ),
    orderBy: asc(gamePlayers.id),
  });

  const alivePlayers = allPlayers.filter((p) => !p.isEliminated);

  if (alivePlayers.length <= 1) {
    await dbOrTx
      .update(games)
      .set({
        status: "finished",
        endedAt: new Date(),
        currentTurnPlayerId: null,
        currentTurnDeadline: null,
      })
      .where(eq(games.id, gameId));
    return { nextPlayerId: null, nextDeadline: null, gameFinished: true };
  }

  const currentIndex = allPlayers.findIndex(
    (p) => p.playerId === currentTurnPlayerId,
  );

  let nextPlayer = alivePlayers[0]!;
  for (let i = 1; i <= allPlayers.length; i++) {
    const candidate = allPlayers[(currentIndex + i) % allPlayers.length]!;
    if (!candidate.isEliminated) {
      nextPlayer = candidate;
      break;
    }
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + turnTimerSeconds * 1000);

  await dbOrTx
    .update(games)
    .set({
      currentTurnPlayerId: nextPlayer.playerId,
      currentTurnDeadline: deadline,
    })
    .where(eq(games.id, gameId));

  return { nextPlayerId: nextPlayer.playerId, nextDeadline: deadline, gameFinished: false };
}

export async function classifyAnswers(
  dbOrTx: DB | Parameters<Parameters<DB["transaction"]>[0]>[0],
  gameId: number,
  category: string,
  results: CategoryFitResult[],
) {
  const resultMap = new Map(results.map((r) => [r.answerId, r]));
  const allAnswers = await dbOrTx.query.answers.findMany({
    where: eq(answers.gameId, gameId),
    orderBy: asc(answers.createdAt),
  });

  for (const answer of allAnswers) {
    const llm = resultMap.get(answer.id);
    if (!llm) continue;

    await dbOrTx
      .insert(answerVerifications)
      .values({
        answerId: answer.id,
        gameId,
        label: llm.label,
        confidence: Math.round(llm.confidence * 100),
        reason: llm.reason,
      })
      .onConflictDoUpdate({
        target: answerVerifications.answerId,
        set: {
          label: llm.label,
          confidence: Math.round(llm.confidence * 100),
          reason: llm.reason,
        },
      });

    const newStatus = llm.label === "invalid" ? "rejected" : "accepted";
    await dbOrTx
      .update(answers)
      .set({ status: newStatus })
      .where(eq(answers.id, answer.id));
  }
}

export async function classifyUnverifiedAnswers(
  db: DB,
  gameId: number,
  category: string,
) {
  const verified = await db.query.answerVerifications.findMany({
    where: eq(answerVerifications.gameId, gameId),
  });
  const verifiedIds = new Set(verified.map((v) => v.answerId));

  const unclassified = await db.query.answers.findMany({
    where: and(eq(answers.gameId, gameId), eq(answers.status, "accepted")),
    orderBy: asc(answers.createdAt),
  });
  const toClassify = unclassified.filter((a) => !verifiedIds.has(a.id));

  if (toClassify.length === 0) return;

  const results = await judgeCategoryFit(
    category,
    toClassify.map((a) => ({ answerId: a.id, text: a.text })),
    { model: env.OPENROUTER_MODEL },
  );

  await db.transaction(async (tx) => {
    await classifyAnswers(tx, gameId, category, results);
  });
}

export function canRetryClassification(classifiedAt: Date | null | undefined) {
  if (!classifiedAt) return true;
  return classifiedAt.getTime() <= Date.now() - CLASSIFICATION_RETRY_AFTER_MS;
}

export async function markClassificationAttempt(
  dbOrTx: DB | Parameters<Parameters<DB["transaction"]>[0]>[0],
  gameId: number,
) {
  await dbOrTx
    .update(games)
    .set({ classifiedAt: new Date() })
    .where(eq(games.id, gameId));
}
