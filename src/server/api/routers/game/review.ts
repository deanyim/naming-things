import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import {
  games,
  gamePlayers,
  answers,
  disputeVotes,
  answerVerifications,
} from "~/server/db/schema";
import { getPlayerBySession, requireHost, requirePlayer } from "~/server/api/lib/session";
import { notify } from "~/server/ws/notify";
import {
  canRetryClassification,
  classifyUnverifiedAnswers,
  markClassificationAttempt,
} from "./helpers";

export const reviewRouter = createTRPCRouter({
  getAllAnswers: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await getPlayerBySession(ctx.db, input.sessionToken);

      const game = await ctx.db.query.games.findFirst({
        where: eq(games.id, input.gameId),
      });

      const allAnswers = await ctx.db.query.answers.findMany({
        where: eq(answers.gameId, input.gameId),
        with: {
          player: true,
          disputeVotes: true,
          verification: true,
        },
      });

      const canAutoClassify =
        !!game &&
        game.status === "reviewing" &&
        game.autoClassificationEnabled &&
        !!game.category &&
        !!env.OPENROUTER_API_KEY;

      const hasUnverifiedAcceptedAnswers = allAnswers.some(
        (answer) => answer.status === "accepted" && !answer.verification,
      );
      const canManuallyClassify =
        canAutoClassify &&
        hasUnverifiedAcceptedAnswers &&
        canRetryClassification(game?.classifiedAt);

      const classifying =
        canAutoClassify &&
        hasUnverifiedAcceptedAnswers &&
        !canManuallyClassify;

      const playerTeamMap = new Map<number, number | null>();
      if (game?.isTeamMode) {
        const gps = await ctx.db.query.gamePlayers.findMany({
          where: eq(gamePlayers.gameId, input.gameId),
        });
        for (const gp of gps) {
          playerTeamMap.set(gp.playerId, gp.teamId);
        }
      }

      const groups = new Map<
        string,
        {
          normalizedText: string;
          answers: typeof allAnswers;
          isCommon: boolean;
          teamId: number | null;
        }
      >();

      for (const answer of allAnswers) {
        const key = answer.normalizedText;
        if (!groups.has(key)) {
          groups.set(key, {
            normalizedText: key,
            answers: [],
            isCommon: false,
            teamId: game?.isTeamMode ? (playerTeamMap.get(answer.playerId) ?? null) : null,
          });
        }
        groups.get(key)!.answers.push(answer);
      }

      for (const group of groups.values()) {
        if (game?.isTeamMode) {
          const uniqueTeams = new Set(
            group.answers.map((a) => playerTeamMap.get(a.playerId)).filter((t) => t != null),
          );
          group.isCommon = uniqueTeams.size >= 2;
        } else {
          const uniquePlayers = new Set(group.answers.map((a) => a.playerId));
          group.isCommon = uniquePlayers.size >= 2;
        }
      }

      return {
        groups: Array.from(groups.values()).sort((a, b) =>
          a.normalizedText.localeCompare(b.normalizedText),
        ),
        classifying,
        canManuallyClassify,
      };
    }),

  retryAutoClassification: publicProcedure
    .input(
      z.object({
        sessionToken: z.string().min(1),
        gameId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const player = await getPlayerBySession(ctx.db, input.sessionToken);
      const game = await requireHost(ctx.db, input.gameId, player.id);

      if (
        game.status !== "reviewing" ||
        !game.autoClassificationEnabled ||
        !game.category ||
        !env.OPENROUTER_API_KEY
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Auto-classification is not available for this game",
        });
      }

      if (!canRetryClassification(game.classifiedAt)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Auto-classification was attempted recently. Please wait and try again.",
        });
      }

      await markClassificationAttempt(ctx.db, input.gameId);
      await classifyUnverifiedAnswers(ctx.db, input.gameId, game.category);

      notify(game.code);
      return { success: true };
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

      // Fallback: classify any unverified answers before scoring
      if (game.autoClassificationEnabled && game.category && env.OPENROUTER_API_KEY) {
        const verified = await ctx.db.query.answerVerifications.findMany({
          where: eq(answerVerifications.gameId, input.gameId),
        });
        const verifiedIds = new Set(verified.map((v) => v.answerId));

        const unclassified = await ctx.db.query.answers.findMany({
          where: and(
            eq(answers.gameId, input.gameId),
            eq(answers.status, "accepted"),
          ),
          orderBy: asc(answers.createdAt),
        });
        const toClassify = unclassified.filter((a) => !verifiedIds.has(a.id));

        if (toClassify.length > 0) {
          if (!canRetryClassification(game.classifiedAt)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Auto-classification was attempted recently. Please wait and try again.",
            });
          }

          await markClassificationAttempt(ctx.db, input.gameId);
          await classifyUnverifiedAnswers(ctx.db, input.gameId, game.category);
        }
      }

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

      if (game.isTeamMode) {
        const gps = await ctx.db.query.gamePlayers.findMany({
          where: and(
            eq(gamePlayers.gameId, input.gameId),
            eq(gamePlayers.isSpectator, false),
          ),
        });
        const playerTeamMap = new Map<number, number | null>();
        for (const gp of gps) {
          playerTeamMap.set(gp.playerId, gp.teamId);
        }

        const teamAnswers = new Map<number, Set<string>>();
        for (const a of acceptedAnswers) {
          const teamId = playerTeamMap.get(a.playerId);
          if (teamId == null) continue;
          if (!teamAnswers.has(teamId)) {
            teamAnswers.set(teamId, new Set());
          }
          teamAnswers.get(teamId)!.add(a.normalizedText);
        }

        for (const [teamId, uniqueAnswers] of teamAnswers) {
          const score = uniqueAnswers.size;
          const teamMembers = gps.filter((gp) => gp.teamId === teamId);
          for (const member of teamMembers) {
            await ctx.db
              .update(gamePlayers)
              .set({ score })
              .where(eq(gamePlayers.id, member.id));
          }
        }
      } else {
        const scoreMap = new Map<number, number>();
        for (const a of acceptedAnswers) {
          scoreMap.set(a.playerId, (scoreMap.get(a.playerId) ?? 0) + 1);
        }

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
      }

      await ctx.db
        .update(games)
        .set({ status: "finished" })
        .where(eq(games.id, input.gameId));

      notify(game.code);
      return { success: true };
    }),
});
