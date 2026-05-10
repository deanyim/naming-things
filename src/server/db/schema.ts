import { sql, relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTableCreator,
  real,
  uniqueIndex,
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
export const categoryFitLabelEnum = pgEnum("category_fit_label", [
  "valid",
  "invalid",
  "ambiguous",
]);

export type DbEvidenceSource = {
  id: string;
  url: string;
  title: string;
  sourceType:
    | "official"
    | "primary"
    | "structured_database"
    | "reputable_secondary"
    | "community"
    | "unknown";
  publishedAt: string | null;
  retrievedAt: string;
  snippet: string;
  retrievedAtIso?: string;
  contentHash?: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
};

export type DbEvidenceFact = {
  canonicalAnswer: string;
  aliases: string[];
  sourceIds: string[];
  notes: string | null;
  matchKeys?: string[];
  metadata?: Record<string, unknown>;
  sourceEntries?: unknown[];
  confidence?: number;
};

export const categoryEvidencePackets = createTable(
  "category_evidence_packet",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    category: d.varchar({ length: 256 }).notNull(),
    normalizedCategory: d.varchar({ length: 256 }).notNull(),
    kind: d.varchar({ length: 64 }).notNull(),
    status: d.varchar({ length: 64 }).notNull(),
    retrievedAt: d.timestamp({ withTimezone: true }).notNull(),
    expiresAt: d.timestamp({ withTimezone: true }),
    model: d.varchar({ length: 256 }).notNull(),
    searchProvider: d.varchar({ length: 64 }).notNull(),
    sources: d.jsonb().$type<DbEvidenceSource[]>().notNull(),
    facts: d.jsonb().$type<DbEvidenceFact[]>().notNull(),
    queryLog: d.jsonb().$type<string[]>().notNull(),
    latencyMs: d.integer(),
    error: d.varchar({ length: 2048 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("category_evidence_packet_category_idx").on(t.normalizedCategory),
    index("category_evidence_packet_created_idx").on(t.createdAt),
  ],
);

export const categoryEvidencePacketSlugAssignments = createTable(
  "category_evidence_packet_slug_assignment",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    categorySlug: d.varchar({ length: 256 }).notNull(),
    categoryEvidencePacketId: d
      .varchar({ length: 64 })
      .notNull()
      .references(() => categoryEvidencePackets.id, { onDelete: "cascade" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    uniqueIndex("category_evidence_packet_slug_assignment_slug_idx").on(
      t.categorySlug,
    ),
    index("category_evidence_packet_slug_assignment_packet_idx").on(
      t.categoryEvidencePacketId,
    ),
  ],
);

export const categoryJudgeRuns = createTable(
  "category_judge_run",
  (d) => ({
    id: d.varchar({ length: 64 }).primaryKey(),
    gameRoundId: d.varchar({ length: 128 }).notNull(),
    categoryEvidencePacketId: d
      .varchar({ length: 64 })
      .references(() => categoryEvidencePackets.id, { onDelete: "set null" }),
    judgedAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("category_judge_run_round_idx").on(t.gameRoundId),
    index("category_judge_run_packet_idx").on(t.categoryEvidencePacketId),
  ],
);

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
    slug: d.varchar({ length: 8 }).notNull().unique(),
    hostPlayerId: d.integer().notNull(),
    status: gameStatusEnum().default("lobby").notNull(),
    category: d.varchar({ length: 256 }),
    mode: gameModeEnum().default("classic").notNull(),
    timerSeconds: d.integer().default(60).notNull(),
    turnTimerSeconds: d.integer().default(5).notNull(),
    currentTurnPlayerId: d.integer(),
    currentTurnDeadline: d.timestamp({ withTimezone: true }),
    isTeamMode: d.boolean().default(false).notNull(),
    numTeams: d.integer().default(2).notNull(),
    autoClassificationEnabled: d.boolean().default(false).notNull(),
    classifiedAt: d.timestamp({ withTimezone: true }),
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
    teamId: d.integer(),
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
  verification: one(answerVerifications, {
    fields: [answers.id],
    references: [answerVerifications.answerId],
  }),
}));

export const answerVerifications = createTable(
  "answer_verification",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    answerId: d.integer().notNull(),
    gameId: d.integer().notNull(),
    label: categoryFitLabelEnum().notNull(),
    confidence: d.integer(),
    reason: d.varchar({ length: 512 }),
    categoryEvidencePacketId: d
      .varchar({ length: 64 })
      .references(() => categoryEvidencePackets.id, { onDelete: "set null" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    uniqueIndex("answer_verification_answer_idx").on(t.answerId),
    index("answer_verification_game_idx").on(t.gameId),
    index("answer_verification_evidence_packet_idx").on(
      t.categoryEvidencePacketId,
    ),
  ],
);

export const answerVerificationsRelations = relations(
  answerVerifications,
  ({ one }) => ({
    answer: one(answers, {
      fields: [answerVerifications.answerId],
      references: [answers.id],
    }),
    game: one(games, {
      fields: [answerVerifications.gameId],
      references: [games.id],
    }),
  }),
);

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

// Solo Mode

export const soloRunStatusEnum = pgEnum("solo_run_status", [
  "playing",
  "finished",
  "abandoned",
]);

export const soloRuns = createTable(
  "solo_run",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    slug: d.varchar({ length: 64 }).notNull().unique(),
    playerId: d.integer().notNull(),
    inputCategory: d.varchar({ length: 256 }).notNull(),
    categoryDisplayName: d.varchar({ length: 256 }).notNull(),
    categorySlug: d.varchar({ length: 256 }).notNull(),
    timerSeconds: d.integer().notNull(),
    attempt: d.integer().default(1).notNull(),
    status: soloRunStatusEnum().default("playing").notNull(),
    startedAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    endedAt: d.timestamp({ withTimezone: true }),
    durationMs: d.integer(),
    score: d.integer().default(0).notNull(),
    validCount: d.integer().default(0).notNull(),
    invalidCount: d.integer().default(0).notNull(),
    ambiguousCount: d.integer().default(0).notNull(),
    judgeModel: d.varchar({ length: 256 }),
    judgeVersion: d.varchar({ length: 256 }),
    categoryEvidencePacketId: d
      .varchar({ length: 64 })
      .references(() => categoryEvidencePackets.id, { onDelete: "set null" }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("solo_run_leaderboard_idx").on(
      t.categorySlug,
      t.timerSeconds,
    ),
    index("solo_run_player_bucket_idx").on(
      t.playerId,
      t.categorySlug,
      t.timerSeconds,
    ),
  ],
);

export const soloRunsRelations = relations(soloRuns, ({ one, many }) => ({
  player: one(players, {
    fields: [soloRuns.playerId],
    references: [players.id],
  }),
  answers: many(soloRunAnswers),
}));

export const soloRunAnswers = createTable(
  "solo_run_answer",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    runId: d.integer().notNull(),
    playerId: d.integer().notNull(),
    text: d.varchar({ length: 256 }).notNull(),
    normalizedText: d.varchar({ length: 256 }).notNull(),
    label: categoryFitLabelEnum(),
    confidence: real(),
    reason: d.varchar({ length: 512 }),
    isDuplicate: d.boolean().default(false).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [
    index("solo_answer_run_normalized_idx").on(t.runId, t.normalizedText),
  ],
);

export const soloRunAnswersRelations = relations(
  soloRunAnswers,
  ({ one }) => ({
    run: one(soloRuns, {
      fields: [soloRunAnswers.runId],
      references: [soloRuns.id],
    }),
    player: one(players, {
      fields: [soloRunAnswers.playerId],
      references: [players.id],
    }),
  }),
);

export const categoryAliases = createTable(
  "category_alias",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    alias: d.varchar({ length: 256 }).notNull(),
    aliasSlug: d.varchar({ length: 256 }).notNull(),
    canonicalName: d.varchar({ length: 256 }).notNull(),
    canonicalSlug: d.varchar({ length: 256 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [index("category_alias_slug_idx").on(t.aliasSlug)],
);

export type SoloRunJudgmentSnapshotAnswer = {
  answerId: number;
  text: string;
  label: "valid" | "invalid" | "ambiguous" | null;
  confidence: number | null;
  reason: string | null;
};

export const soloRunJudgmentHistory = createTable(
  "solo_run_judgment_history",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    runId: d
      .integer()
      .notNull()
      .references(() => soloRuns.id, { onDelete: "cascade" }),
    judgeModel: d.varchar({ length: 256 }),
    judgeVersion: d.varchar({ length: 256 }),
    categoryEvidencePacketId: d
      .varchar({ length: 64 })
      .references(() => categoryEvidencePackets.id, { onDelete: "set null" }),
    score: d.integer().notNull(),
    validCount: d.integer().notNull(),
    invalidCount: d.integer().notNull(),
    ambiguousCount: d.integer().notNull(),
    answersSnapshot: d
      .jsonb()
      .$type<SoloRunJudgmentSnapshotAnswer[]>()
      .notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  }),
  (t) => [index("solo_run_judgment_history_run_idx").on(t.runId)],
);

export const soloRunJudgmentHistoryRelations = relations(
  soloRunJudgmentHistory,
  ({ one }) => ({
    run: one(soloRuns, {
      fields: [soloRunJudgmentHistory.runId],
      references: [soloRuns.id],
    }),
  }),
);
