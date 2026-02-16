import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  games,
  gamePlayers,
  answers,
  disputeVotes,
  players,
} from "~/server/db/schema";
import { getPlayerBySession, requireHost } from "~/server/api/lib/session";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/1/O/0
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export const gameRouter = createTRPCRouter({
  create: publicProcedure
    .input(z.object({ sessionToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);

      // Generate unique code with retry
      let code = generateCode();
      let attempts = 0;
      while (attempts < 10) {
        const existing = await ctx.db.query.games.findFirst({
          where: eq(games.code, code),
        });
        if (!existing) break;
        code = generateCode();
        attempts++;
      }

      const [game] = await ctx.db
        .insert(games)
        .values({
          code,
          hostPlayerId: player.id,
          status: "lobby",
        })
        .returning();

      // Add host as a player
      await ctx.db.insert(gamePlayers).values({
        gameId: game!.id,
        playerId: player.id,
      });

      return { code: game!.code };
    }),

  join: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        code: z.string().length(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const code = input.code.toUpperCase();

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.code, code),
      });

      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }

      if (game.status !== "lobby" && game.status !== "playing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This game is no longer accepting players",
        });
      }

      // Check if already joined
      const existing = await ctx.db.query.gamePlayers.findFirst({
        where: and(
          eq(gamePlayers.gameId, game.id),
          eq(gamePlayers.playerId, player.id),
        ),
      });

      if (!existing) {
        await ctx.db.insert(gamePlayers).values({
          gameId: game.id,
          playerId: player.id,
        });
      }

      return { code: game.code };
    }),

  getState: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        code: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const code = input.code.toUpperCase();

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.code, code),
        with: {
          gamePlayers: {
            with: {
              player: true,
            },
          },
        },
      });

      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }

      return {
        id: game.id,
        code: game.code,
        status: game.status,
        category: game.category,
        timerSeconds: game.timerSeconds,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
        isHost: game.hostPlayerId === player.id,
        hostPlayerId: game.hostPlayerId,
        players: game.gamePlayers.map((gp) => ({
          id: gp.player.id,
          displayName: gp.player.displayName,
          score: gp.score,
          isHost: gp.player.id === game.hostPlayerId,
        })),
        myPlayerId: player.id,
      };
    }),

  start: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        category: z.string().min(1).max(256),
        timerSeconds: z.number().min(10).max(300),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      await requireHost(ctx.db, input.gameId, player.id);

      const now = new Date();
      const endedAt = new Date(now.getTime() + input.timerSeconds * 1000);

      await ctx.db
        .update(games)
        .set({
          status: "playing",
          category: input.category,
          timerSeconds: input.timerSeconds,
          startedAt: now,
          endedAt,
        })
        .where(eq(games.id, input.gameId));

      return { startedAt: now, endedAt };
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

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, input.gameId),
      });

      if (!game || (game.status !== "playing" && game.status !== "reviewing")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is not accepting answers",
        });
      }

      if (input.answers.length === 0) {
        return { inserted: 0 };
      }

      // Get existing answers for this player to dedupe
      const existing = await ctx.db.query.answers.findMany({
        where: and(
          eq(answers.gameId, input.gameId),
          eq(answers.playerId, player.id),
        ),
      });
      const existingNormalized = new Set(existing.map((a) => a.normalizedText));

      // Dedupe within batch and against existing
      const seen = new Set<string>();
      const toInsert: { gameId: number; playerId: number; text: string; normalizedText: string }[] = [];

      for (const item of input.answers) {
        const text = item.text.trim();
        const normalizedText = text.toLowerCase();
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

      return { inserted: toInsert.length };
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

      await ctx.db
        .update(games)
        .set({ status: "reviewing" })
        .where(eq(games.id, input.gameId));

      return { success: true };
    }),

  getAllAnswers: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await getPlayerBySession(ctx.db, input.sessionToken);

      const allAnswers = await ctx.db.query.answers.findMany({
        where: eq(answers.gameId, input.gameId),
        with: {
          player: true,
          disputeVotes: true,
        },
      });

      // Group by normalizedText
      const groups = new Map<
        string,
        {
          normalizedText: string;
          answers: typeof allAnswers;
          isCommon: boolean;
        }
      >();

      for (const answer of allAnswers) {
        const key = answer.normalizedText;
        if (!groups.has(key)) {
          groups.set(key, {
            normalizedText: key,
            answers: [],
            isCommon: false,
          });
        }
        groups.get(key)!.answers.push(answer);
      }

      // Mark common (2+ unique players)
      for (const group of groups.values()) {
        const uniquePlayers = new Set(group.answers.map((a) => a.playerId));
        group.isCommon = uniquePlayers.size >= 2;
      }

      return Array.from(groups.values()).sort((a, b) =>
        a.normalizedText.localeCompare(b.normalizedText),
      );
    }),

  disputeAnswer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        answerId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getPlayerBySession(ctx.db, input.sessionToken);

      await ctx.db
        .update(answers)
        .set({ status: "disputed" })
        .where(eq(answers.id, input.answerId));

      return { success: true };
    }),

  castVote: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        answerId: z.number(),
        accept: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);

      // Can't vote on own answer
      const answer = await ctx.db.query.answers.findFirst({
        where: eq(answers.id, input.answerId),
      });
      if (!answer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Answer not found" });
      }
      if (answer.playerId === player.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot vote on your own answer",
        });
      }

      // Upsert vote
      await ctx.db
        .insert(disputeVotes)
        .values({
          answerId: input.answerId,
          voterPlayerId: player.id,
          accept: input.accept,
        })
        .onConflictDoUpdate({
          target: [disputeVotes.answerId, disputeVotes.voterPlayerId],
          set: { accept: input.accept },
        });

      return { success: true };
    }),

  finishGame: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      await requireHost(ctx.db, input.gameId, player.id);

      // Resolve disputed answers
      const allAnswers = await ctx.db.query.answers.findMany({
        where: eq(answers.gameId, input.gameId),
        with: { disputeVotes: true },
      });

      for (const answer of allAnswers) {
        if (answer.status === "disputed") {
          const votes = answer.disputeVotes;
          const acceptCount = votes.filter((v) => v.accept).length;
          const rejectCount = votes.filter((v) => !v.accept).length;

          // Majority wins, ties -> accepted
          const finalStatus =
            rejectCount > acceptCount ? "rejected" : "accepted";

          await ctx.db
            .update(answers)
            .set({ status: finalStatus })
            .where(eq(answers.id, answer.id));
        }
      }

      // Tally scores
      const acceptedAnswers = await ctx.db.query.answers.findMany({
        where: and(
          eq(answers.gameId, input.gameId),
          eq(answers.status, "accepted"),
        ),
      });

      const scoreMap = new Map<number, number>();
      for (const a of acceptedAnswers) {
        scoreMap.set(a.playerId, (scoreMap.get(a.playerId) ?? 0) + 1);
      }

      // Update scores
      for (const [playerId, score] of scoreMap) {
        await ctx.db
          .update(gamePlayers)
          .set({ score })
          .where(
            and(
              eq(gamePlayers.gameId, input.gameId),
              eq(gamePlayers.playerId, playerId),
            ),
          );
      }

      // Set game to finished
      await ctx.db
        .update(games)
        .set({ status: "finished" })
        .where(eq(games.id, input.gameId));

      return { success: true };
    }),
});
