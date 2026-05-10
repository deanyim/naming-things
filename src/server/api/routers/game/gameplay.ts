import { z } from "zod";
import { eq, and, sql, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { games, gamePlayers, answers } from "~/server/db/schema";
import { getPlayerBySession, requireHost, requirePlayer } from "~/server/api/lib/session";
import { notify } from "~/server/ws/notify";
import { judgeCategoryFit } from "~/server/lib/verification/category-fit";
import {
  getExistingCategoryEvidencePacket,
  recordCategoryJudgeRun,
} from "~/server/lib/verification/retrieval/packets";
import {
  normalizeAnswer,
  advanceTurn,
  classifyAnswers,
  classifyUnverifiedAnswers,
  markClassificationAttempt,
} from "./helpers";

export const gameplayRouter = createTRPCRouter({
  submitTurnAnswer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        text: z.string().min(1).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      await requirePlayer(ctx.db, input.gameId, player.id);

      const result = await ctx.db.transaction(async (tx) => {
        const game = await tx.query.games.findFirst({
          where: eq(games.id, input.gameId),
        });

        if (!game || game.status !== "playing" || game.mode !== "turns") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Game is not in turns playing state",
          });
        }

        if (game.isPaused) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Game is paused",
          });
        }

        if (game.currentTurnPlayerId !== player.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "It's not your turn",
          });
        }

        const text = input.text.trim();
        const normalizedText = normalizeAnswer(text).canonicalText;

        const existingAnswer = await tx.query.answers.findFirst({
          where: and(
            eq(answers.gameId, input.gameId),
            eq(answers.normalizedText, normalizedText),
          ),
        });

        if (existingAnswer) {
          await tx
            .update(gamePlayers)
            .set({ isEliminated: true, eliminatedAt: new Date() })
            .where(
              and(
                eq(gamePlayers.gameId, input.gameId),
                eq(gamePlayers.playerId, player.id),
              ),
            );

          const turnResult = await advanceTurn(tx, input.gameId, player.id, game.turnTimerSeconds);
          return {
            success: false as const,
            reason: "duplicate" as const,
            ...turnResult,
            gameCode: game.code,
          };
        }

        await tx.insert(answers).values({
          gameId: input.gameId,
          playerId: player.id,
          text,
          normalizedText,
        });

        await tx
          .update(gamePlayers)
          .set({ score: sql`${gamePlayers.score} + 1` })
          .where(
            and(
              eq(gamePlayers.gameId, input.gameId),
              eq(gamePlayers.playerId, player.id),
            ),
          );

        const turnResult = await advanceTurn(tx, input.gameId, player.id, game.turnTimerSeconds);
        return {
          success: true as const,
          ...turnResult,
          gameCode: game.code,
        };
      });

      notify(result.gameCode);
      return {
        success: result.success,
        reason: result.success ? undefined : result.reason,
        nextPlayerId: result.nextPlayerId,
        nextDeadline: result.nextDeadline,
        gameFinished: result.gameFinished,
      };
    }),

  timeoutTurn: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getPlayerBySession(ctx.db, input.sessionToken);

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, input.gameId),
      });

      if (!game || game.status !== "playing" || game.mode !== "turns") {
        return { success: false };
      }

      if (game.isPaused) {
        return { success: false };
      }

      if (!game.currentTurnPlayerId || !game.currentTurnDeadline) {
        return { success: false };
      }

      if (new Date(game.currentTurnDeadline).getTime() > Date.now()) {
        return { success: false };
      }

      const result = await ctx.db
        .update(games)
        .set({ currentTurnDeadline: null })
        .where(
          and(
            eq(games.id, input.gameId),
            eq(games.currentTurnPlayerId, game.currentTurnPlayerId),
            sql`${games.currentTurnDeadline} <= NOW()`,
          ),
        )
        .returning();

      if (result.length === 0) {
        return { success: false };
      }

      await ctx.db
        .update(gamePlayers)
        .set({ isEliminated: true, eliminatedAt: new Date() })
        .where(
          and(
            eq(gamePlayers.gameId, input.gameId),
            eq(gamePlayers.playerId, game.currentTurnPlayerId),
          ),
        );

      await advanceTurn(ctx.db, input.gameId, game.currentTurnPlayerId, game.turnTimerSeconds);
      notify(game.code);
      return { success: true };
    }),

  submitAnswersBatch: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        answers: z.array(z.object({ text: z.string().min(1).max(256) })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      await requirePlayer(ctx.db, input.gameId, player.id);

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, input.gameId),
      });

      if (!game || (game.status !== "playing" && game.status !== "reviewing")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is not accepting answers",
        });
      }

      if (game.isTeamMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use submitTeamAnswer in team mode",
        });
      }

      if (input.answers.length === 0) {
        return { inserted: 0 };
      }

      const existing = await ctx.db.query.answers.findMany({
        where: and(
          eq(answers.gameId, input.gameId),
          eq(answers.playerId, player.id),
        ),
      });
      const existingNormalized = new Set(existing.map((a) => a.normalizedText));

      const seen = new Set<string>();
      const toInsert: { gameId: number; playerId: number; text: string; normalizedText: string }[] = [];

      for (const item of input.answers) {
        const text = item.text.trim();
        const normalizedText = normalizeAnswer(text).canonicalText;
        if (!text || seen.has(normalizedText) || existingNormalized.has(normalizedText)) {
          continue;
        }
        seen.add(normalizedText);
        toInsert.push({
          gameId: input.gameId,
          playerId: player.id,
          text,
          normalizedText,
        });
      }

      if (toInsert.length > 0) {
        await ctx.db.insert(answers).values(toInsert);
      }

      if (toInsert.length > 0 && game.autoClassificationEnabled && game.category && env.OPENROUTER_API_KEY) {
        await markClassificationAttempt(ctx.db, input.gameId);

        const myAnswers = await ctx.db.query.answers.findMany({
          where: and(
            eq(answers.gameId, input.gameId),
            eq(answers.playerId, player.id),
          ),
          orderBy: asc(answers.createdAt),
        });

        if (myAnswers.length > 0) {
          const evidencePacket = await getExistingCategoryEvidencePacket(
            ctx.db,
            game.category,
          );
          const results = await judgeCategoryFit(
            game.category,
            myAnswers.map((a) => ({ answerId: a.id, text: a.text })),
            {
              model: env.OPENROUTER_MODEL,
              retrieval: {
                enabled: !!evidencePacket,
                evidencePacket,
              },
            },
          );

          await ctx.db.transaction(async (tx) => {
            await classifyAnswers(
              tx,
              input.gameId,
              game.category!,
              results,
              evidencePacket?.id ?? null,
            );
          });
          await recordCategoryJudgeRun(
            ctx.db,
            `game:${input.gameId}`,
            evidencePacket?.id ?? null,
          );
        }
      }

      notify(game.code);
      return { inserted: toInsert.length };
    }),

  submitTeamAnswer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        text: z.string().min(1).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const gp = await requirePlayer(ctx.db, input.gameId, player.id);

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, input.gameId),
      });

      if (!game || game.status !== "playing" || !game.isTeamMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is not in team playing state",
        });
      }

      if (game.isPaused) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is paused",
        });
      }

      if (!gp.teamId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are not assigned to a team",
        });
      }

      const text = input.text.trim();
      const normalizedText = normalizeAnswer(text).canonicalText;

      const teamPlayerIds = await ctx.db.query.gamePlayers.findMany({
        where: and(
          eq(gamePlayers.gameId, input.gameId),
          eq(gamePlayers.teamId, gp.teamId),
        ),
      });
      const teamPlayerIdSet = new Set(teamPlayerIds.map((tp) => tp.playerId));

      const existingAnswers = await ctx.db.query.answers.findMany({
        where: eq(answers.gameId, input.gameId),
      });

      const duplicate = existingAnswers.find(
        (a) => a.normalizedText === normalizedText && teamPlayerIdSet.has(a.playerId),
      );

      if (duplicate) {
        return { success: false, reason: "duplicate" as const };
      }

      await ctx.db.insert(answers).values({
        gameId: input.gameId,
        playerId: player.id,
        text,
        normalizedText,
      });

      notify(game.code);
      return { success: true };
    }),

  removeTeamAnswer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        answerId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const gp = await requirePlayer(ctx.db, input.gameId, player.id);

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, input.gameId),
      });

      if (!game || game.status !== "playing" || !game.isTeamMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is not in team playing state",
        });
      }

      if (game.isPaused) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is paused",
        });
      }

      const answer = await ctx.db.query.answers.findFirst({
        where: eq(answers.id, input.answerId),
      });

      if (!answer || answer.gameId !== input.gameId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Answer not found" });
      }

      const answerPlayerGp = await ctx.db.query.gamePlayers.findFirst({
        where: and(
          eq(gamePlayers.gameId, input.gameId),
          eq(gamePlayers.playerId, answer.playerId),
        ),
      });

      if (!answerPlayerGp || answerPlayerGp.teamId !== gp.teamId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Can only remove answers from your own team",
        });
      }

      await ctx.db
        .delete(answers)
        .where(eq(answers.id, input.answerId));

      notify(game.code);
      return { success: true };
    }),

  getTeamAnswers: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const gp = await requirePlayer(ctx.db, input.gameId, player.id);

      if (!gp.teamId) {
        return [];
      }

      const teamPlayers = await ctx.db.query.gamePlayers.findMany({
        where: and(
          eq(gamePlayers.gameId, input.gameId),
          eq(gamePlayers.teamId, gp.teamId),
        ),
      });
      const teamPlayerIds = teamPlayers.map((tp) => tp.playerId);

      const teamAnswers = await ctx.db.query.answers.findMany({
        where: eq(answers.gameId, input.gameId),
        with: { player: true },
        orderBy: asc(answers.createdAt),
      });

      return teamAnswers
        .filter((a) => teamPlayerIds.includes(a.playerId))
        .map((a) => ({
          id: a.id,
          text: a.text,
          normalizedText: a.normalizedText,
          playerDisplayName: a.player.displayName,
          playerId: a.playerId,
        }));
    }),

  endAnswering: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (game.status !== "playing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is not in playing state",
        });
      }

      if (game.isPaused) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is paused",
        });
      }

      await ctx.db
        .update(games)
        .set({
          status: "reviewing",
          classifiedAt:
            game.isTeamMode && game.autoClassificationEnabled && game.category && env.OPENROUTER_API_KEY
              ? new Date()
              : game.classifiedAt,
        })
        .where(eq(games.id, input.gameId));

      if (game.isTeamMode && game.autoClassificationEnabled && game.category && env.OPENROUTER_API_KEY) {
        await classifyUnverifiedAnswers(ctx.db, input.gameId, game.category);
      }

      notify(game.code);
      return { success: true };
    }),
});
