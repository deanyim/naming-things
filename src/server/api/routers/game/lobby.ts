import { z } from "zod";
import { eq, and, desc, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { games, gamePlayers, answers } from "~/server/db/schema";
import { getPlayerBySession, requireHost } from "~/server/api/lib/session";
import { notify } from "~/server/ws/notify";
import { generateCode, generateSlug } from "./helpers";

export const lobbyRouter = createTRPCRouter({
  create: publicProcedure
    .input(z.object({ sessionToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);

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
          slug: generateSlug(),
          hostPlayerId: player.id,
          status: "lobby",
        })
        .returning();

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
        slug: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);

      const game = input.slug
        ? await ctx.db.query.games.findFirst({
            where: eq(games.slug, input.slug),
            with: {
              gamePlayers: {
                with: { player: true },
              },
            },
          })
        : await ctx.db.query.games.findFirst({
            where: eq(games.code, input.code.toUpperCase()),
            orderBy: desc(games.id),
            with: {
              gamePlayers: {
                with: { player: true },
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
        slug: game.slug,
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
        isTeamMode: game.isTeamMode,
        numTeams: game.numTeams,
        autoClassificationEnabled: game.autoClassificationEnabled,
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
            teamId: gp.teamId,
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

  getVerifications: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        slug: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await getPlayerBySession(ctx.db, input.sessionToken);

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.slug, input.slug),
      });

      if (!game) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
      }

      const allAnswers = await ctx.db.query.answers.findMany({
        where: eq(answers.gameId, game.id),
        with: {
          player: true,
          verification: true,
        },
        orderBy: asc(answers.id),
      });

      return {
        category: game.category,
        model: env.OPENROUTER_MODEL,
        answers: allAnswers.map((a) => ({
          id: a.id,
          text: a.text,
          normalizedText: a.normalizedText,
          status: a.status,
          player: a.player.displayName,
          verification: a.verification
            ? {
                label: a.verification.label,
                confidence: a.verification.confidence,
                reason: a.verification.reason,
              }
            : null,
        })),
      };
    }),

  getHistory: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        code: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await getPlayerBySession(ctx.db, input.sessionToken);
      const code = input.code.toUpperCase();

      const allGames = await ctx.db.query.games.findMany({
        where: eq(games.code, code),
        orderBy: desc(games.id),
        with: {
          gamePlayers: {
            with: { player: true },
          },
        },
      });

      return allGames.map((game) => ({
        id: game.id,
        slug: game.slug,
        status: game.status,
        category: game.category,
        mode: game.mode,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
        createdAt: game.createdAt,
        playerCount: game.gamePlayers.filter((gp) => !gp.isSpectator).length,
        players: game.gamePlayers
          .filter((gp) => !gp.isSpectator)
          .map((gp) => ({
            displayName: gp.player.displayName,
            score: gp.score,
          })),
      }));
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

  setAutoClassificationEnabled: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (game.status === "finished") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot change auto-classification after the game ends",
        });
      }

      await ctx.db
        .update(games)
        .set({ autoClassificationEnabled: input.enabled })
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),

  setTeamMode: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        isTeamMode: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (game.status !== "lobby") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only change team mode in lobby",
        });
      }

      await ctx.db
        .update(games)
        .set({ isTeamMode: input.isTeamMode })
        .where(eq(games.id, input.gameId));

      if (input.isTeamMode) {
        const activePlayers = await ctx.db.query.gamePlayers.findMany({
          where: and(
            eq(gamePlayers.gameId, input.gameId),
            eq(gamePlayers.isSpectator, false),
          ),
          orderBy: asc(gamePlayers.id),
        });

        for (let i = 0; i < activePlayers.length; i++) {
          const teamId = (i % game.numTeams) + 1;
          await ctx.db
            .update(gamePlayers)
            .set({ teamId })
            .where(eq(gamePlayers.id, activePlayers[i]!.id));
        }
      } else {
        await ctx.db
          .update(gamePlayers)
          .set({ teamId: null })
          .where(eq(gamePlayers.gameId, input.gameId));
      }

      notify(game.code);
      return { success: true };
    }),

  setNumTeams: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        numTeams: z.number().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (game.status !== "lobby") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only change number of teams in lobby",
        });
      }

      await ctx.db
        .update(games)
        .set({ numTeams: input.numTeams })
        .where(eq(games.id, input.gameId));

      if (game.isTeamMode) {
        const activePlayers = await ctx.db.query.gamePlayers.findMany({
          where: and(
            eq(gamePlayers.gameId, input.gameId),
            eq(gamePlayers.isSpectator, false),
          ),
          orderBy: asc(gamePlayers.id),
        });

        for (let i = 0; i < activePlayers.length; i++) {
          const teamId = (i % input.numTeams) + 1;
          await ctx.db
            .update(gamePlayers)
            .set({ teamId })
            .where(eq(gamePlayers.id, activePlayers[i]!.id));
        }
      }

      notify(game.code);
      return { success: true };
    }),

  setPlayerTeam: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
        playerId: z.number(),
        teamId: z.number().min(1),
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

      if (game.status !== "lobby") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only change teams in lobby",
        });
      }

      if (!game.isTeamMode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Team mode is not enabled",
        });
      }

      if (input.teamId > game.numTeams) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid team number",
        });
      }

      const isHost = game.hostPlayerId === player.id;
      if (!isHost && input.playerId !== player.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the host can reassign other players",
        });
      }

      await ctx.db
        .update(gamePlayers)
        .set({ teamId: input.teamId })
        .where(
          and(
            eq(gamePlayers.gameId, input.gameId),
            eq(gamePlayers.playerId, input.playerId),
          ),
        );

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

      if (game.isTeamMode) {
        const activePlayers = await ctx.db.query.gamePlayers.findMany({
          where: and(
            eq(gamePlayers.gameId, input.gameId),
            eq(gamePlayers.isSpectator, false),
          ),
        });
        const unassigned = activePlayers.filter((p) => !p.teamId);
        if (unassigned.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "All players must be assigned to a team",
          });
        }
        const teamsWithPlayers = new Set(activePlayers.map((p) => p.teamId));
        if (teamsWithPlayers.size === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "At least one team must have players",
          });
        }
      }

      const now = new Date();

      if (game.mode === "turns") {
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

        const firstPlayer = activePlayers[0]!;
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
});
