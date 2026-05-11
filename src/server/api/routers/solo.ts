import { z } from "zod";
import { and, eq, desc, asc, sql, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  players,
  soloRuns,
  soloRunAnswers,
  categoryAliases,
  soloRunJudgmentHistory,
  categoryEvidencePackets,
  categoryEvidencePacketSlugAssignments,
} from "~/server/db/schema";
import { getPlayerBySession } from "~/server/api/lib/session";
import { resolveCategory } from "~/server/lib/categories/normalize";
import { normalizeAnswer } from "~/lib/normalize";
import {
  scoreRun,
  maybeClassifyBatch,
  computeJudgeVersion,
  rerunJudgingForRun,
  JudgeVersionAlreadyCurrentError,
} from "~/server/lib/solo/scoring";
import {
  classifyCategoryForRetrieval,
  getExistingCategoryEvidencePacket,
} from "~/server/lib/verification/retrieval";
import { resolveCategorySpec } from "~/server/lib/verification/retrieval/category-resolver";
import {
  insertWithUniqueSoloSlug,
  SoloSlugExhaustedError,
} from "~/server/lib/solo/slug";
import { ALLOWED_TIMERS } from "~/app/solo/constants";

export const soloRouter = createTRPCRouter({
  createRun: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        category: z.string().min(1).max(256),
        timerSeconds: z.number().refine((v) => ALLOWED_TIMERS.includes(v), {
          message: `Timer must be one of: ${ALLOWED_TIMERS.join(", ")}`,
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const resolved = await resolveCategory(ctx.db, input.category);

      // Count previous attempts for this player+bucket
      const [prev] = await ctx.db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(soloRuns)
        .where(
          and(
            eq(soloRuns.playerId, player.id),
            eq(soloRuns.categorySlug, resolved.slug),
            eq(soloRuns.timerSeconds, input.timerSeconds),
          ),
        );
      const attempt = (prev?.count ?? 0) + 1;

      const now = new Date();
      const run = await insertWithUniqueSoloSlug(async (slug) => {
        const [inserted] = await ctx.db
          .insert(soloRuns)
          .values({
            slug,
            playerId: player.id,
            inputCategory: resolved.inputCategory,
            categoryDisplayName: resolved.displayName,
            categorySlug: resolved.slug,
            timerSeconds: input.timerSeconds,
            attempt,
            status: "playing",
            startedAt: now,
          })
          .onConflictDoNothing({ target: soloRuns.slug })
          .returning();
        return inserted ?? null;
      }).catch((err) => {
        // Only convert the specific exhaustion sentinel into a user-facing
        // error. Any other thrown error (DB connection, drizzle driver,
        // etc.) propagates as-is so we don't mislabel a transient failure.
        if (err instanceof SoloSlugExhaustedError) {
          console.error("Solo slug space exhausted", err);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not start a new run. Please try again.",
          });
        }
        throw err;
      });

      return {
        slug: run.slug,
        categoryDisplayName: resolved.displayName,
        categorySlug: resolved.slug,
        timerSeconds: input.timerSeconds,
        startedAt: run.startedAt,
        endsAt: new Date(now.getTime() + input.timerSeconds * 1000),
      };
    }),

  getRun: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const run = await ctx.db.query.soloRuns.findFirst({
        where: and(
          eq(soloRuns.slug, input.slug),
          eq(soloRuns.playerId, player.id),
        ),
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      }

      const answers = await ctx.db.query.soloRunAnswers.findMany({
        where: eq(soloRunAnswers.runId, run.id),
        orderBy: [asc(soloRunAnswers.createdAt)],
      });

      const endsAt = new Date(
        run.startedAt.getTime() + run.timerSeconds * 1000,
      );

      return {
        ...run,
        endsAt,
        answers,
      };
    }),

  submitAnswer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        slug: z.string().min(1),
        text: z.string().min(1).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const run = await ctx.db.query.soloRuns.findFirst({
        where: and(
          eq(soloRuns.slug, input.slug),
          eq(soloRuns.playerId, player.id),
        ),
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      }

      if (run.status !== "playing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Run is not active",
        });
      }

      // Check timer expiry
      const endsAt = run.startedAt.getTime() + run.timerSeconds * 1000;
      if (Date.now() > endsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Timer has expired",
        });
      }

      const normalized = normalizeAnswer(input.text);
      if (!normalized.normalizedText.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Answer is empty after normalization",
        });
      }

      // Check for in-run duplicates
      const existingAnswer = await ctx.db.query.soloRunAnswers.findFirst({
        where: and(
          eq(soloRunAnswers.runId, run.id),
          eq(soloRunAnswers.normalizedText, normalized.normalizedText),
        ),
      });

      if (existingAnswer) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Duplicate answer",
        });
      }

      const [answer] = await ctx.db
        .insert(soloRunAnswers)
        .values({
          runId: run.id,
          playerId: player.id,
          text: input.text.trim(),
          normalizedText: normalized.normalizedText,
          isDuplicate: false,
        })
        .returning();

      // For longer runs, pre-classify in background batches of 25
      if (run.timerSeconds > 30) {
        maybeClassifyBatch(
          ctx.db,
          run.id,
          run.categoryDisplayName,
          run.categorySlug,
        );
      }

      return {
        id: answer!.id,
        text: answer!.text,
        normalizedText: answer!.normalizedText,
      };
    }),

  deleteAnswer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        slug: z.string().min(1),
        answerId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const run = await ctx.db.query.soloRuns.findFirst({
        where: and(
          eq(soloRuns.slug, input.slug),
          eq(soloRuns.playerId, player.id),
        ),
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      }

      if (run.status !== "playing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Run is not active",
        });
      }

      const endsAt = run.startedAt.getTime() + run.timerSeconds * 1000;
      if (Date.now() > endsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Timer has expired",
        });
      }

      const answer = await ctx.db.query.soloRunAnswers.findFirst({
        where: and(
          eq(soloRunAnswers.id, input.answerId),
          eq(soloRunAnswers.runId, run.id),
          eq(soloRunAnswers.playerId, player.id),
        ),
      });

      if (!answer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Answer not found",
        });
      }

      await ctx.db
        .delete(soloRunAnswers)
        .where(eq(soloRunAnswers.id, input.answerId));

      return { success: true };
    }),

  finishRun: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        slug: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const run = await ctx.db.query.soloRuns.findFirst({
        where: and(
          eq(soloRuns.slug, input.slug),
          eq(soloRuns.playerId, player.id),
        ),
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      }

      // Idempotent: if already finished, return current state
      if (run.status === "finished") {
        const answers = await ctx.db.query.soloRunAnswers.findMany({
          where: eq(soloRunAnswers.runId, run.id),
          orderBy: [asc(soloRunAnswers.createdAt)],
        });
        return { ...run, answers };
      }

      if (run.status !== "playing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Run cannot be finished",
        });
      }

      const now = new Date();
      const durationMs = now.getTime() - run.startedAt.getTime();

      // Classify answers
      const scoring = await scoreRun(
        ctx.db,
        run.id,
        run.categoryDisplayName,
        run.categorySlug,
      );

      // Finalize the run
      const [updatedRun] = await ctx.db
        .update(soloRuns)
        .set({
          status: "finished",
          endedAt: now,
          durationMs,
          score: scoring.score,
          validCount: scoring.validCount,
          invalidCount: scoring.invalidCount,
          ambiguousCount: scoring.ambiguousCount,
          judgeModel: scoring.judgeModel,
          judgeVersion: scoring.judgeVersion,
          categoryEvidencePacketId: scoring.categoryEvidencePacketId,
        })
        .where(eq(soloRuns.id, run.id))
        .returning();

      const answers = await ctx.db.query.soloRunAnswers.findMany({
        where: eq(soloRunAnswers.runId, run.id),
        orderBy: [asc(soloRunAnswers.createdAt)],
      });

      return { ...updatedRun!, answers };
    }),

  getLeaderboard: publicProcedure
    .input(
      z.object({
        categorySlug: z.string().min(1),
        timerSeconds: z.number(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const entries = await ctx.db
        .select({
          id: soloRuns.id,
          slug: soloRuns.slug,
          playerId: soloRuns.playerId,
          displayName: players.displayName,
          attempt: soloRuns.attempt,
          score: soloRuns.score,
          durationMs: soloRuns.durationMs,
          validCount: soloRuns.validCount,
          invalidCount: soloRuns.invalidCount,
          ambiguousCount: soloRuns.ambiguousCount,
          categoryDisplayName: soloRuns.categoryDisplayName,
          createdAt: soloRuns.createdAt,
        })
        .from(soloRuns)
        .innerJoin(players, eq(soloRuns.playerId, players.id))
        .where(
          and(
            eq(soloRuns.categorySlug, input.categorySlug),
            eq(soloRuns.timerSeconds, input.timerSeconds),
            eq(soloRuns.status, "finished"),
          ),
        )
        .orderBy(
          desc(soloRuns.score),
          asc(soloRuns.durationMs),
          asc(soloRuns.createdAt),
        );

      const seen = new Set<number>();
      const bestPerPlayer = entries.filter((e) => {
        if (seen.has(e.playerId)) return false;
        seen.add(e.playerId);
        return true;
      });

      return bestPerPlayer.slice(0, input.limit);
    }),

  getLeaderboardOverview: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const buckets = await ctx.db
        .select({
          categorySlug: soloRuns.categorySlug,
          categoryDisplayName: sql<string>`max(${soloRuns.categoryDisplayName})`.as("category_display_name"),
          timerSeconds: soloRuns.timerSeconds,
          runCount: sql<number>`count(*)::int`.as("run_count"),
          topScore: sql<number>`max(${soloRuns.score})::int`.as("top_score"),
        })
        .from(soloRuns)
        .where(eq(soloRuns.status, "finished"))
        .groupBy(
          soloRuns.categorySlug,
          soloRuns.timerSeconds,
        )
        .orderBy(sql`count(*) desc`)
        .limit(input.limit)
        .offset(input.offset);

      return buckets;
    }),

  searchCategories: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(256),
        limit: z.number().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const searchTerm = `%${input.query.toLowerCase()}%`;

      const fromRuns = await ctx.db
        .selectDistinct({
          categoryDisplayName: soloRuns.categoryDisplayName,
          categorySlug: soloRuns.categorySlug,
        })
        .from(soloRuns)
        .where(
          and(
            eq(soloRuns.status, "finished"),
            like(soloRuns.categorySlug, searchTerm),
          ),
        )
        .limit(input.limit);

      const fromAliases = await ctx.db
        .selectDistinct({
          categoryDisplayName: categoryAliases.canonicalName,
          categorySlug: categoryAliases.canonicalSlug,
        })
        .from(categoryAliases)
        .where(like(categoryAliases.canonicalSlug, searchTerm))
        .limit(input.limit);

      const seen = new Set<string>();
      const results: { categoryDisplayName: string; categorySlug: string }[] =
        [];
      for (const item of [...fromRuns, ...fromAliases]) {
        if (!seen.has(item.categorySlug)) {
          seen.add(item.categorySlug);
          results.push(item);
        }
      }

      return results.slice(0, input.limit);
    }),

  getMyBest: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        categorySlug: z.string().min(1),
        timerSeconds: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);

      const [bestRun] = await ctx.db
        .select()
        .from(soloRuns)
        .where(
          and(
            eq(soloRuns.playerId, player.id),
            eq(soloRuns.categorySlug, input.categorySlug),
            eq(soloRuns.timerSeconds, input.timerSeconds),
            eq(soloRuns.status, "finished"),
          ),
        )
        .orderBy(
          desc(soloRuns.score),
          asc(soloRuns.durationMs),
          asc(soloRuns.createdAt),
        )
        .limit(1);

      if (!bestRun) return null;

      const [rankResult] = await ctx.db
        .select({
          rank: sql<number>`count(distinct ${soloRuns.playerId})::int + 1`.as(
            "rank",
          ),
        })
        .from(soloRuns)
        .where(
          and(
            eq(soloRuns.categorySlug, input.categorySlug),
            eq(soloRuns.timerSeconds, input.timerSeconds),
            eq(soloRuns.status, "finished"),
            sql`(
              ${soloRuns.score} > ${bestRun.score}
              OR (${soloRuns.score} = ${bestRun.score} AND ${soloRuns.durationMs} < ${bestRun.durationMs})
              OR (${soloRuns.score} = ${bestRun.score} AND ${soloRuns.durationMs} = ${bestRun.durationMs} AND ${soloRuns.createdAt} < ${bestRun.createdAt})
            )`,
          ),
        );

      return {
        ...bestRun,
        rank: rankResult?.rank ?? 1,
      };
    }),

  getRunDebug: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.soloRuns.findFirst({
        where: and(
          eq(soloRuns.slug, input.slug),
          eq(soloRuns.status, "finished"),
        ),
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      }

      const player = await ctx.db.query.players.findFirst({
        where: eq(players.id, run.playerId),
      });

      const answers = await ctx.db.query.soloRunAnswers.findMany({
        where: eq(soloRunAnswers.runId, run.id),
        orderBy: [asc(soloRunAnswers.id)],
      });

      const history = await ctx.db.query.soloRunJudgmentHistory.findMany({
        where: eq(soloRunJudgmentHistory.runId, run.id),
        orderBy: [desc(soloRunJudgmentHistory.createdAt)],
      });
      const categorySpec = resolveCategorySpec(run.categoryDisplayName);
      const retrievalDecision = await classifyCategoryForRetrieval(
        run.categoryDisplayName,
      );
      const latestEvidencePacket = await getExistingCategoryEvidencePacket(
        ctx.db,
        run.categoryDisplayName,
        { includeStale: true, categorySlug: run.categorySlug },
      );
      const usedEvidencePacket = run.categoryEvidencePacketId
        ? await ctx.db.query.categoryEvidencePackets.findFirst({
            where: eq(categoryEvidencePackets.id, run.categoryEvidencePacketId),
          })
        : null;

      return {
        slug: run.slug,
        category: run.categoryDisplayName,
        categorySlug: run.categorySlug,
        inputCategory: run.inputCategory,
        timerSeconds: run.timerSeconds,
        score: run.score,
        validCount: run.validCount,
        invalidCount: run.invalidCount,
        ambiguousCount: run.ambiguousCount,
        judgeModel: run.judgeModel,
        judgeVersion: run.judgeVersion,
        currentJudgeVersion: computeJudgeVersion(),
        categoryEvidencePacketId: run.categoryEvidencePacketId,
        categorySpec,
        retrievalDecision,
        evidencePacket: usedEvidencePacket,
        latestEvidencePacket,
        hasNewerEvidencePacket:
          !!latestEvidencePacket &&
          latestEvidencePacket.id !== run.categoryEvidencePacketId,
        durationMs: run.durationMs,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        displayName: player?.displayName ?? "unknown",
        answers: answers.map((a) => ({
          id: a.id,
          text: a.text,
          normalizedText: a.normalizedText,
          label: a.label,
          confidence: a.confidence,
          reason: a.reason,
          isDuplicate: a.isDuplicate,
          createdAt: a.createdAt,
        })),
        history: history.map((h) => ({
          id: h.id,
          judgeModel: h.judgeModel,
          judgeVersion: h.judgeVersion,
          categoryEvidencePacketId: h.categoryEvidencePacketId,
          score: h.score,
          validCount: h.validCount,
          invalidCount: h.invalidCount,
          ambiguousCount: h.ambiguousCount,
          answersSnapshot: h.answersSnapshot,
          createdAt: h.createdAt,
        })),
      };
    }),

  rerunJudging: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        force: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // No owner check: matches `getRunDebug` which is also public.
      // The debug tool is intentionally open so any legacy/foreign run
      // can be re-judged after a prompt or model change.
      const run = await ctx.db.query.soloRuns.findFirst({
        where: eq(soloRuns.slug, input.slug),
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      }
      if (run.status !== "finished") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Run is not finished",
        });
      }

      try {
        await rerunJudgingForRun(ctx.db, run.id, { force: input.force });
      } catch (err) {
        if (err instanceof JudgeVersionAlreadyCurrentError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Judging is already up to date",
          });
        }
        throw err;
      }

      return { ok: true as const };
    }),

  getEvidencePacket: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const packet = await ctx.db.query.categoryEvidencePackets.findFirst({
        where: eq(categoryEvidencePackets.id, input.id),
      });

      if (!packet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence packet not found",
        });
      }

      const runs = await ctx.db
        .select({
          slug: soloRuns.slug,
          categoryDisplayName: soloRuns.categoryDisplayName,
          score: soloRuns.score,
        })
        .from(soloRuns)
        .where(eq(soloRuns.categoryEvidencePacketId, packet.id));
      const slugAssignments = await ctx.db
        .select()
        .from(categoryEvidencePacketSlugAssignments)
        .where(
          eq(
            categoryEvidencePacketSlugAssignments.categoryEvidencePacketId,
            packet.id,
          ),
        );

      return {
        ...packet,
        assignedCategorySlugs: slugAssignments.map(
          (assignment) => assignment.categorySlug,
        ),
        runs,
      };
    }),

  getRandomCategory: publicProcedure
    .query(async ({ ctx }) => {
      const categories = await ctx.db
        .selectDistinct({
          categoryDisplayName: soloRuns.categoryDisplayName,
          categorySlug: soloRuns.categorySlug,
        })
        .from(soloRuns)
        .where(eq(soloRuns.status, "finished"));

      if (categories.length === 0) {
        return null;
      }

      const random = categories[Math.floor(Math.random() * categories.length)];
      return random;
    }),

  getPublicRun: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.soloRuns.findFirst({
        where: and(
          eq(soloRuns.slug, input.slug),
          eq(soloRuns.status, "finished"),
        ),
      });

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      }

      const player = await ctx.db.query.players.findFirst({
        where: eq(players.id, run.playerId),
      });

      const answers = await ctx.db.query.soloRunAnswers.findMany({
        where: eq(soloRunAnswers.runId, run.id),
        orderBy: [asc(soloRunAnswers.createdAt)],
      });

      return {
        ...run,
        displayName: player?.displayName ?? "unknown",
        answers,
      };
    }),
});
