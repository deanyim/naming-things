import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { games, gamePlayers } from "~/server/db/schema";
import { getPlayerBySession, requireHost } from "~/server/api/lib/session";
import { notify } from "~/server/ws/notify";
import { generateSlug, classifyUnverifiedAnswers } from "./helpers";

export const managementRouter = createTRPCRouter({
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

      timeRemainingMs = Math.max(0, timeRemainingMs);

      if (game.mode === "classic") {
        await ctx.db
          .update(games)
          .set({
            isPaused: true,
            pausedAt: new Date(),
            pausedTimeRemainingMs: timeRemainingMs,
            endedAt: null,
          })
          .where(eq(games.id, input.gameId));
      } else {
        await ctx.db
          .update(games)
          .set({
            isPaused: true,
            pausedAt: new Date(),
            pausedTimeRemainingMs: timeRemainingMs,
            currentTurnDeadline: null,
          })
          .where(eq(games.id, input.gameId));
      }

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

      if (game.mode === "classic") {
        await ctx.db
          .update(games)
          .set({
            isPaused: false,
            pausedAt: null,
            pausedTimeRemainingMs: null,
            endedAt: newDeadline,
          })
          .where(eq(games.id, input.gameId));
      } else {
        await ctx.db
          .update(games)
          .set({
            isPaused: false,
            pausedAt: null,
            pausedTimeRemainingMs: null,
            currentTurnDeadline: newDeadline,
          })
          .where(eq(games.id, input.gameId));
      }

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

      const newStatus = game.mode === "classic" ? "reviewing" : "finished";

      await ctx.db
        .update(games)
        .set({
          status: newStatus,
          isPaused: false,
          pausedAt: null,
          pausedTimeRemainingMs: null,
          endedAt: new Date(),
          currentTurnDeadline: null,
          currentTurnPlayerId: null,
        })
        .where(eq(games.id, input.gameId));

      if (newStatus === "reviewing" && game.isTeamMode && game.autoClassificationEnabled && game.category && env.OPENROUTER_API_KEY) {
        await classifyUnverifiedAnswers(ctx.db, input.gameId, game.category);
      }

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

      const newest = await ctx.db.query.games.findFirst({
        where: eq(games.code, game.code),
        orderBy: desc(games.id),
      });
      if (newest && newest.id !== game.id) {
        return { code: game.code };
      }

      const [newGame] = await ctx.db
        .insert(games)
        .values({
          code: game.code,
          slug: generateSlug(),
          hostPlayerId: player.id,
          status: "lobby",
          mode: game.mode,
          turnTimerSeconds: game.turnTimerSeconds,
          isTeamMode: game.isTeamMode,
          numTeams: game.numTeams,
        })
        .returning();

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
            teamId: game.isTeamMode ? gp.teamId : null,
          })),
        );
      }

      notify(game.code);
      return { code: game.code };
    }),
});
