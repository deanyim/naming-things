import { sql, relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTableCreator,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";


export const createTable = pgTableCreator((name) => `naming-things_${name}`);

// Legacy (will be removed)
export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("name_idx").on(t.name)],
);

// Enums
export const gameStatusEnum = pgEnum("game_status", [
  "lobby",
  "playing",
  "reviewing",
  "finished",
]);

export const answerStatusEnum = pgEnum("answer_status", [
  "accepted",
  "disputed",
  "rejected",
]);

export const gameModeEnum = pgEnum("game_mode", ["classic", "turns"]);

// Players
export const players = createTable(
  "player",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    sessionToken: d.varchar({ length: 256 }).notNull().unique(),
    displayName: d.varchar({ length: 100 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [uniqueIndex("session_token_idx").on(t.sessionToken)],
);

export const playersRelations = relations(players, ({ many }) => ({
  gamePlayers: many(gamePlayers),
  answers: many(answers),
  disputeVotes: many(disputeVotes),
}));

// Games
export const games = createTable(
  "game",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    code: d.varchar({ length: 6 }).notNull(),
    hostPlayerId: d.integer().notNull(),
    status: gameStatusEnum().default("lobby").notNull(),
    category: d.varchar({ length: 256 }),
    mode: gameModeEnum().default("classic").notNull(),
    timerSeconds: d.integer().default(60).notNull(),
    turnTimerSeconds: d.integer().default(5).notNull(),
    currentTurnPlayerId: d.integer(),
    currentTurnDeadline: d.timestamp({ withTimezone: true }),
    isPaused: d.boolean().default(false).notNull(),
    pausedAt: d.timestamp({ withTimezone: true }),
    pausedTimeRemainingMs: d.integer(),
    startedAt: d.timestamp({ withTimezone: true }),
    endedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("code_idx").on(t.code)],
);

export const gamesRelations = relations(games, ({ one, many }) => ({
  host: one(players, {
    fields: [games.hostPlayerId],
    references: [players.id],
  }),
  gamePlayers: many(gamePlayers),
  answers: many(answers),
}));

// Game Players (join table)
export const gamePlayers = createTable(
  "game_player",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    gameId: d.integer().notNull(),
    playerId: d.integer().notNull(),
    score: d.integer().default(0).notNull(),
    isSpectator: d.boolean().default(false).notNull(),
    isEliminated: d.boolean().default(false).notNull(),
    eliminatedAt: d.timestamp({ withTimezone: true }),
    joinedAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    uniqueIndex("game_player_idx").on(t.gameId, t.playerId),
    index("game_player_game_idx").on(t.gameId),
  ],
);

export const gamePlayersRelations = relations(gamePlayers, ({ one }) => ({
  game: one(games, {
    fields: [gamePlayers.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [gamePlayers.playerId],
    references: [players.id],
  }),
}));

// Answers
export const answers = createTable(
  "answer",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    gameId: d.integer().notNull(),
    playerId: d.integer().notNull(),
    text: d.varchar({ length: 256 }).notNull(),
    normalizedText: d.varchar({ length: 256 }).notNull(),
    status: answerStatusEnum().default("accepted").notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("answer_game_idx").on(t.gameId),
    index("answer_player_idx").on(t.gameId, t.playerId),
  ],
);

export const answersRelations = relations(answers, ({ one, many }) => ({
  game: one(games, {
    fields: [answers.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [answers.playerId],
    references: [players.id],
  }),
  disputeVotes: many(disputeVotes),
}));

// Dispute Votes
export const disputeVotes = createTable(
  "dispute_vote",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    answerId: d.integer().notNull(),
    voterPlayerId: d.integer().notNull(),
    accept: d.boolean().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    uniqueIndex("dispute_vote_unique_idx").on(t.answerId, t.voterPlayerId),
    index("dispute_vote_answer_idx").on(t.answerId),
  ],
);

export const disputeVotesRelations = relations(disputeVotes, ({ one }) => ({
  answer: one(answers, {
    fields: [disputeVotes.answerId],
    references: [answers.id],
  }),
  voter: one(players, {
    fields: [disputeVotes.voterPlayerId],
    references: [players.id],
  }),
}));
