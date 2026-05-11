import { vi } from "vitest";
import { createCaller } from "~/server/api/root";

function createUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  return { set, where };
}

function createInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  return { values, onConflictDoUpdate };
}

export function createMockDb() {
  const db = {
    query: {
      players: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      games: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      gamePlayers: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      answers: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      answerVerifications: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      disputeVotes: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      soloRuns: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      soloRunAnswers: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    update: vi.fn(() => createUpdateChain()),
    insert: vi.fn(() => createInsertChain()),
    delete: vi.fn(() => createUpdateChain()),
    transaction: vi.fn(async (callback: (tx: typeof db) => unknown) => callback(db)),
  };

  return db;
}

export function createTestCaller(db = createMockDb()) {
  return createCaller({
    db: db as never,
    headers: new Headers(),
  });
}
