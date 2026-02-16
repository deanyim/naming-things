import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { type db as dbType } from "~/server/db";
import { players, games, gamePlayers } from "~/server/db/schema";

type DB = typeof dbType;

export async function getPlayerBySession(db: DB, sessionToken: string) {
  const player = await db.query.players.findFirst({
    where: eq(players.sessionToken, sessionToken),
  });
  if (!player) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Player not found for this session",
    });
  }
  return player;
}

export async function requireHost(db: DB, gameId: number, playerId: number) {
  const game = await db.query.games.findFirst({
    where: eq(games.id, gameId),
  });
  if (!game) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
  }
  if (game.hostPlayerId !== playerId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the host can perform this action",
    });
  }
  return game;
}
