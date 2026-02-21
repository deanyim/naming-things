import { z } from "zod";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  games,
  gamePlayers,
  answers,
  disputeVotes,
} from "~/server/db/schema";
import {
  getPlayerBySession,
  requireHost,
  requirePlayer,
} from "~/server/api/lib/session";
import { notify } from "~/server/ws/notify";
import { type db as dbType } from "~/server/db";

type DB = typeof dbType;

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/1/O/0
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

type AdvanceTurnResult = {
  nextPlayerId: number | null;
  nextDeadline: Date | null;
  gameFinished: boolean;
};

async function advanceTurn(
  dbOrTx: DB | Parameters<Parameters<DB["transaction"]>[0]>[0],
  gameId: number,
  currentTurnPlayerId: number,
  turnTimerSeconds: number,
): Promise<AdvanceTurnResult> {
  // Get ALL non-spectator players ordered by gamePlayers.id (need full list for ordering)
  const allPlayers = await dbOrTx.query.gamePlayers.findMany({
    where: and(
      eq(gamePlayers.gameId, gameId),
      eq(gamePlayers.isSpectator, false),
    ),
    orderBy: asc(gamePlayers.id),
  });

  const alivePlayers = allPlayers.filter((p) => !p.isEliminated);

  if (alivePlayers.length <= 1) {
    // Game over
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

  // Find next alive player after current in the full player order (cycling)
  const currentIndex = allPlayers.findIndex(
    (p) => p.playerId === currentTurnPlayerId,
  );

  let nextPlayer = alivePlayers[0]!; // fallback to first alive
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
        orderBy: desc(games.id),
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

      if (existing && existing.isSpectator) {
        // Upgrade spectator to player
        await ctx.db
          .update(gamePlayers)
          .set({ isSpectator: false })
          .where(eq(gamePlayers.id, existing.id));
      } else if (!existing) {
        await ctx.db.insert(gamePlayers).values({
          gameId: game.id,
          playerId: player.id,
        });
      }

      notify(code);
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
        orderBy: desc(games.id),
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

      const myEntry = game.gamePlayers.find(
        (gp) => gp.playerId === player.id,
      );
      const isSpectator = !myEntry || myEntry.isSpectator;

      // Build turnsHistory for turns mode
      let turnsHistory: { text: string; playerDisplayName: string }[] | null = null;
      if (game.mode === "turns" && game.status !== "lobby") {
        const allAnswers = await ctx.db.query.answers.findMany({
          where: eq(answers.gameId, game.id),
          with: { player: true },
          orderBy: asc(answers.id),
        });
        turnsHistory = allAnswers.map((a) => ({
          text: a.text,
          playerDisplayName: a.player.displayName,
        }));
      }

      return {
        id: game.id,
        code: game.code,
        status: game.status,
        mode: game.mode,
        category: game.category,
        timerSeconds: game.timerSeconds,
        turnTimerSeconds: game.turnTimerSeconds,
        currentTurnPlayerId: game.currentTurnPlayerId,
        currentTurnDeadline: game.currentTurnDeadline,
        turnsHistory,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
        isPaused: game.isPaused,
        pausedTimeRemainingMs: game.pausedTimeRemainingMs,
        isHost: game.hostPlayerId === player.id,
        isSpectator,
        hostPlayerId: game.hostPlayerId,
        players: game.gamePlayers
          .filter((gp) => !gp.isSpectator)
          .map((gp) => ({
            id: gp.player.id,
            displayName: gp.player.displayName,
            score: gp.score,
            isHost: gp.player.id === game.hostPlayerId,
            isEliminated: gp.isEliminated,
            eliminatedAt: gp.eliminatedAt,
          })),
        spectators: game.gamePlayers
          .filter((gp) => gp.isSpectator)
          .map((gp) => ({
            id: gp.player.id,
            displayName: gp.player.displayName,
          })),
        myPlayerId: player.id,
      };
    }),

  setCategory: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        category: z.string().min(1).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      await ctx.db
        .update(games)
        .set({ category: input.category })
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),

  setTimer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        timerSeconds: z.number().min(10).max(7200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      await ctx.db
        .update(games)
        .set({ timerSeconds: input.timerSeconds })
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),

  setMode: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        mode: z.enum(["classic", "turns"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (game.status !== "lobby") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only change mode in lobby",
        });
      }

      await ctx.db
        .update(games)
        .set({ mode: input.mode })
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),

  setTurnTimer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        turnTimerSeconds: z.number().min(3).max(30),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (game.status !== "lobby") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only change turn timer in lobby",
        });
      }

      await ctx.db
        .update(games)
        .set({ turnTimerSeconds: input.turnTimerSeconds })
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),

  start: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (!game.category) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Set a category before starting",
        });
      }

      const now = new Date();

      if (game.mode === "turns") {
        // Get all non-spectator players ordered by id
        const activePlayers = await ctx.db.query.gamePlayers.findMany({
          where: and(
            eq(gamePlayers.gameId, input.gameId),
            eq(gamePlayers.isSpectator, false),
          ),
          orderBy: asc(gamePlayers.id),
        });

        if (activePlayers.length < 2) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Need at least 2 players to start last one standing",
          });
        }

        const firstPlayer = activePlayers[0]!

        const deadline = new Date(now.getTime() + game.turnTimerSeconds * 1000);

        await ctx.db
          .update(games)
          .set({
            status: "playing",
            startedAt: now,
            currentTurnPlayerId: firstPlayer.playerId,
            currentTurnDeadline: deadline,
          })
          .where(eq(games.id, input.gameId));

        notify(game.code);
        return { startedAt: now, endedAt: null };
      }

      // Classic mode
      const endedAt = new Date(now.getTime() + game.timerSeconds * 1000);

      await ctx.db
        .update(games)
        .set({
          status: "playing",
          startedAt: now,
          endedAt,
        })
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { startedAt: now, endedAt };
    }),

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
        const normalizedText = text.toLowerCase();

        // Check for duplicate against all prior answers in this game
        const existingAnswer = await tx.query.answers.findFirst({
          where: and(
            eq(answers.gameId, input.gameId),
            eq(answers.normalizedText, normalizedText),
          ),
        });

        if (existingAnswer) {
          // Duplicate — eliminate the player
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

        // Unique answer — insert and score
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

      // Atomic guard: only process if deadline has passed
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

      // Atomic update: only succeed if currentTurnPlayerId hasn't changed
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

      // Eliminate the timed-out player
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

      notify(game.code);
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

      if (game.isPaused) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is paused",
        });
      }

      await ctx.db
        .update(games)
        .set({ status: "reviewing" })
        .where(eq(games.id, input.gameId));

      notify(game.code);
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
      const player = await getPlayerBySession(ctx.db, input.sessionToken);

      // Look up the answer to get gameId for requirePlayer check
      const answer = await ctx.db.query.answers.findFirst({
        where: eq(answers.id, input.answerId),
      });
      if (!answer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Answer not found" });
      }
      await requirePlayer(ctx.db, answer.gameId, player.id);

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, answer.gameId),
      });

      await ctx.db
        .update(answers)
        .set({ status: "disputed" })
        .where(eq(answers.id, input.answerId));

      if (game) notify(game.code);
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
      await requirePlayer(ctx.db, answer.gameId, player.id);
      if (answer.playerId === player.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot vote on your own answer",
        });
      }

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, answer.gameId),
      });

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

      if (game) notify(game.code);
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
      const game = await requireHost(ctx.db, input.gameId, player.id);

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

      notify(game.code);
      return { success: true };
    }),

  spectate: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        code: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const code = input.code.toUpperCase();

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.code, code),
        orderBy: desc(games.id),
      });

      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }

      // Idempotent — skip if already in game
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
          isSpectator: true,
        });
      }

      notify(code);
      return { success: true };
    }),

  joinAsPlayer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, input.gameId),
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

      const existing = await ctx.db.query.gamePlayers.findFirst({
        where: and(
          eq(gamePlayers.gameId, game.id),
          eq(gamePlayers.playerId, player.id),
        ),
      });

      if (existing && existing.isSpectator) {
        await ctx.db
          .update(gamePlayers)
          .set({ isSpectator: false })
          .where(eq(gamePlayers.id, existing.id));
      } else if (!existing) {
        await ctx.db.insert(gamePlayers).values({
          gameId: game.id,
          playerId: player.id,
          isSpectator: false,
        });
      }

      notify(game.code);
      return { success: true };
    }),

  kickPlayer: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        playerId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (game.status !== "lobby") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only kick players during lobby",
        });
      }

      if (input.playerId === player.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot kick yourself",
        });
      }

      await ctx.db
        .delete(gamePlayers)
        .where(
          and(
            eq(gamePlayers.gameId, input.gameId),
            eq(gamePlayers.playerId, input.playerId),
          ),
        );

      notify(game.code);
      return { success: true };
    }),

  pauseGame: publicProcedure
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
          message: "Game is already paused",
        });
      }

      const now = Date.now();
      let timeRemainingMs: number;

      if (game.mode === "classic") {
        if (!game.endedAt) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Classic game missing endedAt",
          });
        }
        timeRemainingMs = new Date(game.endedAt).getTime() - now;
      } else {
        if (!game.currentTurnDeadline) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Turns game missing currentTurnDeadline",
          });
        }
        timeRemainingMs = new Date(game.currentTurnDeadline).getTime() - now;
      }

      // Clamp to at least 0
      timeRemainingMs = Math.max(0, timeRemainingMs);

      const updateFields: Record<string, unknown> = {
        isPaused: true,
        pausedAt: new Date(),
        pausedTimeRemainingMs: timeRemainingMs,
      };

      // Null out the deadline so countdown hooks stop
      if (game.mode === "classic") {
        updateFields.endedAt = null;
      } else {
        updateFields.currentTurnDeadline = null;
      }

      await ctx.db
        .update(games)
        .set(updateFields)
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),

  resumeGame: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (!game.isPaused) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game is not paused",
        });
      }

      if (game.pausedTimeRemainingMs == null) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Missing pausedTimeRemainingMs",
        });
      }

      const now = new Date();
      const newDeadline = new Date(now.getTime() + game.pausedTimeRemainingMs);

      const updateFields: Record<string, unknown> = {
        isPaused: false,
        pausedAt: null,
        pausedTimeRemainingMs: null,
      };

      if (game.mode === "classic") {
        updateFields.endedAt = newDeadline;
      } else {
        updateFields.currentTurnDeadline = newDeadline;
      }

      await ctx.db
        .update(games)
        .set(updateFields)
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),

  terminateGame: publicProcedure
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
        .set({
          status: game.mode === "classic" ? "reviewing" : "finished",
          isPaused: false,
          pausedAt: null,
          pausedTimeRemainingMs: null,
          endedAt: new Date(),
          currentTurnDeadline: null,
          currentTurnPlayerId: null,
        })
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),

  createRematch: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (game.status !== "finished") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Game must be finished to create a rematch",
        });
      }

      // Idempotent: if a newer game already exists with same code, rematch was already created
      const newest = await ctx.db.query.games.findFirst({
        where: eq(games.code, game.code),
        orderBy: desc(games.id),
      });
      if (newest && newest.id !== game.id) {
        return { code: game.code };
      }

      // Create new game with same code, preserving mode
      const [newGame] = await ctx.db
        .insert(games)
        .values({
          code: game.code,
          hostPlayerId: player.id,
          status: "lobby",
          mode: game.mode,
          turnTimerSeconds: game.turnTimerSeconds,
        })
        .returning();

      // Copy all players/spectators from old game with reset scores
      const oldPlayers = await ctx.db.query.gamePlayers.findMany({
        where: eq(gamePlayers.gameId, input.gameId),
      });

      if (oldPlayers.length > 0) {
        await ctx.db.insert(gamePlayers).values(
          oldPlayers.map((gp) => ({
            gameId: newGame!.id,
            playerId: gp.playerId,
            score: 0,
            isSpectator: gp.isSpectator,
            isEliminated: false,
          })),
        );
      }

      notify(game.code);
      return { code: game.code };
    }),
});
