import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

const judgeMocks = vi.hoisted(() => ({
  judgeCategoryFit: vi.fn(),
}));

vi.mock("~/server/lib/verification/category-fit", () => ({
  judgeCategoryFit: judgeMocks.judgeCategoryFit,
}));

vi.mock("~/server/lib/verification/prompts", () => ({
  CATEGORY_FIT_PROMPT: "TEST_PROMPT_V1",
}));

vi.mock("~/env", async () => {
  const actual = await vi.importActual<typeof import("~/env")>("~/env");
  return {
    env: {
      ...actual.env,
      OPENROUTER_MODEL: "test/model-a",
    },
  };
});

import {
  computeCounts,
  computeJudgeVersion,
  rerunJudgingForRun,
  JudgeVersionAlreadyCurrentError,
  __classifyLocksForTest,
} from "./scoring";
import type { CategoryFitResult } from "~/server/lib/verification/category-fit";

describe("computeCounts", () => {
  it("counts all valid as score", () => {
    const results: CategoryFitResult[] = [
      { answerId: 1, label: "valid", confidence: 0.9, reason: "ok" },
      { answerId: 2, label: "valid", confidence: 0.8, reason: "ok" },
      { answerId: 3, label: "valid", confidence: 0.7, reason: "ok" },
    ];

    const counts = computeCounts(results);
    expect(counts.score).toBe(3);
    expect(counts.validCount).toBe(3);
    expect(counts.invalidCount).toBe(0);
    expect(counts.ambiguousCount).toBe(0);
  });

  it("does not count invalid toward score", () => {
    const results: CategoryFitResult[] = [
      { answerId: 1, label: "valid", confidence: 0.9, reason: "ok" },
      { answerId: 2, label: "invalid", confidence: 0.9, reason: "not a fruit" },
    ];

    const counts = computeCounts(results);
    expect(counts.score).toBe(1);
    expect(counts.validCount).toBe(1);
    expect(counts.invalidCount).toBe(1);
  });

  it("does not count ambiguous toward score", () => {
    const results: CategoryFitResult[] = [
      { answerId: 1, label: "valid", confidence: 0.9, reason: "ok" },
      { answerId: 2, label: "ambiguous", confidence: 0.5, reason: "unclear" },
    ];

    const counts = computeCounts(results);
    expect(counts.score).toBe(1);
    expect(counts.validCount).toBe(1);
    expect(counts.ambiguousCount).toBe(1);
  });

  it("handles all labels mixed", () => {
    const results: CategoryFitResult[] = [
      { answerId: 1, label: "valid", confidence: 0.9, reason: "ok" },
      { answerId: 2, label: "invalid", confidence: 0.9, reason: "no" },
      { answerId: 3, label: "ambiguous", confidence: 0.5, reason: "hmm" },
      { answerId: 4, label: "valid", confidence: 0.8, reason: "ok" },
      { answerId: 5, label: "invalid", confidence: 0.9, reason: "no" },
    ];

    const counts = computeCounts(results);
    expect(counts.score).toBe(2);
    expect(counts.validCount).toBe(2);
    expect(counts.invalidCount).toBe(2);
    expect(counts.ambiguousCount).toBe(1);
  });

  it("returns zero for empty results", () => {
    const counts = computeCounts([]);
    expect(counts.score).toBe(0);
    expect(counts.validCount).toBe(0);
    expect(counts.invalidCount).toBe(0);
    expect(counts.ambiguousCount).toBe(0);
  });

  it("returns zero score when all invalid or ambiguous", () => {
    const results: CategoryFitResult[] = [
      { answerId: 1, label: "invalid", confidence: 0.9, reason: "no" },
      { answerId: 2, label: "ambiguous", confidence: 0.5, reason: "hmm" },
      { answerId: 3, label: "invalid", confidence: 0.9, reason: "no" },
    ];

    const counts = computeCounts(results);
    expect(counts.score).toBe(0);
    expect(counts.validCount).toBe(0);
    expect(counts.invalidCount).toBe(2);
    expect(counts.ambiguousCount).toBe(1);
  });
});

describe("computeJudgeVersion", () => {
  it("returns a stable 8-char hex string", () => {
    const v1 = computeJudgeVersion();
    const v2 = computeJudgeVersion();
    expect(v1).toBe(v2);
    expect(v1).toMatch(/^[0-9a-f]{8}$/);
  });

  it("never equals the legacy value '1'", () => {
    expect(computeJudgeVersion()).not.toBe("1");
  });
});

// Minimal stateful fake of the parts of drizzle db that scoring.ts touches.
type FakeAnswer = {
  id: number;
  runId: number;
  text: string;
  normalizedText: string;
  label: "valid" | "invalid" | "ambiguous" | null;
  confidence: number | null;
  reason: string | null;
  isDuplicate: boolean;
};

type FakeRun = {
  id: number;
  status: "playing" | "finished" | "abandoned";
  categoryDisplayName: string;
  score: number;
  validCount: number;
  invalidCount: number;
  ambiguousCount: number;
  judgeModel: string | null;
  judgeVersion: string | null;
};

type FakeHistoryRow = {
  runId: number;
  judgeModel: string | null;
  judgeVersion: string | null;
  score: number;
  validCount: number;
  invalidCount: number;
  ambiguousCount: number;
  answersSnapshot: unknown;
};

function createFakeDb(initial: { run: FakeRun; answers: FakeAnswer[] }) {
  const state = {
    run: { ...initial.run },
    answers: initial.answers.map((a) => ({ ...a })),
    history: [] as FakeHistoryRow[],
  };

  // We don't interpret drizzle query symbols; each table's findFirst/findMany
  // just returns the (single) matching state slice.
  const db = {
    query: {
      soloRuns: {
        findFirst: vi.fn(async () => ({ ...state.run })),
      },
      soloRunAnswers: {
        findMany: vi.fn(async () => state.answers.map((a) => ({ ...a }))),
      },
    },
    insert: vi.fn((_table: unknown) => ({
      values: vi.fn(async (row: FakeHistoryRow) => {
        state.history.push(row);
      }),
    })),
    update: vi.fn((_table: unknown) => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          // Heuristic: patches with judgeVersion target soloRuns; patches
          // with `label` target soloRunAnswers (and the caller drives the
          // per-answer update via classifyAndPersist's Promise.all loop, so
          // each invocation targets one answer. We can't read the .where()
          // condition here, so we rely on classifyAndPersist being called
          // once per answer in sequence — see the mock in the test that
          // stamps each answer via a shared counter.
          if ("judgeVersion" in patch || "score" in patch) {
            Object.assign(state.run, patch);
          }
        }),
      })),
    })),
    __state: state,
  };

  return db;
}

describe("rerunJudgingForRun", () => {
  beforeEach(() => {
    __classifyLocksForTest.clear();
    judgeMocks.judgeCategoryFit.mockReset();
  });

  afterEach(() => {
    __classifyLocksForTest.clear();
  });

  it("throws JudgeVersionAlreadyCurrentError when version matches", async () => {
    const current = computeJudgeVersion();
    const db = createFakeDb({
      run: {
        id: 42,
        status: "finished",
        categoryDisplayName: "fruits",
        score: 2,
        validCount: 2,
        invalidCount: 0,
        ambiguousCount: 0,
        judgeModel: "test/model-a",
        judgeVersion: current,
      },
      answers: [],
    });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rerunJudgingForRun(db as any, 42),
    ).rejects.toBeInstanceOf(JudgeVersionAlreadyCurrentError);

    // Did not insert a history row and did not mutate run state.
    expect(db.__state.history).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("throws when the run is not finished", async () => {
    const db = createFakeDb({
      run: {
        id: 1,
        status: "playing",
        categoryDisplayName: "fruits",
        score: 0,
        validCount: 0,
        invalidCount: 0,
        ambiguousCount: 0,
        judgeModel: null,
        judgeVersion: null,
      },
      answers: [],
    });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rerunJudgingForRun(db as any, 1),
    ).rejects.toThrow(/not finished/);
  });

  it("snapshots the previous state and overwrites with new labels", async () => {
    const db = createFakeDb({
      run: {
        id: 10,
        status: "finished",
        categoryDisplayName: "fruits",
        score: 1,
        validCount: 1,
        invalidCount: 1,
        ambiguousCount: 0,
        judgeModel: "test/model-legacy",
        judgeVersion: "legacy-hash",
      },
      answers: [
        {
          id: 100,
          runId: 10,
          text: "apple",
          normalizedText: "apple",
          label: "valid",
          confidence: 0.9,
          reason: "obvious fruit",
          isDuplicate: false,
        },
        {
          id: 101,
          runId: 10,
          text: "brick",
          normalizedText: "brick",
          label: "invalid",
          confidence: 0.95,
          reason: "not a fruit",
          isDuplicate: false,
        },
        {
          id: 102,
          runId: 10,
          text: "dup-apple",
          normalizedText: "apple",
          label: null,
          confidence: null,
          reason: null,
          isDuplicate: true,
        },
      ],
    });

    // The new judging marks both non-duplicate answers as valid.
    judgeMocks.judgeCategoryFit.mockImplementation(
      async (
        _category: string,
        candidates: { answerId: number; text: string }[],
      ) => {
        // Mutate fake state so the post-judge findMany reflects the update.
        // This simulates classifyAndPersist's per-answer db.update loop.
        for (const c of candidates) {
          const row = db.__state.answers.find((a) => a.id === c.answerId);
          if (row) {
            row.label = "valid";
            row.confidence = 0.88;
            row.reason = "rerun-said-valid";
          }
        }
        return candidates.map((c) => ({
          answerId: c.answerId,
          label: "valid" as const,
          confidence: 0.88,
          reason: "rerun-said-valid",
        }));
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await rerunJudgingForRun(db as any, 10);

    // Snapshot captured the OLD (pre-rerun) state, only non-duplicates.
    expect(db.__state.history).toHaveLength(1);
    const snap = db.__state.history[0]!;
    expect(snap.runId).toBe(10);
    expect(snap.judgeVersion).toBe("legacy-hash");
    expect(snap.judgeModel).toBe("test/model-legacy");
    expect(snap.score).toBe(1);
    expect(snap.validCount).toBe(1);
    expect(snap.invalidCount).toBe(1);
    const snapshotAnswers = snap.answersSnapshot as Array<{
      answerId: number;
      label: string | null;
    }>;
    expect(snapshotAnswers).toHaveLength(2); // duplicate excluded
    expect(snapshotAnswers.find((a) => a.answerId === 100)?.label).toBe(
      "valid",
    );
    expect(snapshotAnswers.find((a) => a.answerId === 101)?.label).toBe(
      "invalid",
    );

    // The judge was called with exactly the non-duplicate candidates.
    expect(judgeMocks.judgeCategoryFit).toHaveBeenCalledTimes(1);
    const [, candidates] = judgeMocks.judgeCategoryFit.mock.calls[0]!;
    expect(
      (candidates as { answerId: number }[]).map((c) => c.answerId).sort(),
    ).toEqual([100, 101]);

    // Run state was updated to the fresh counts + current version.
    expect(db.__state.run.score).toBe(2);
    expect(db.__state.run.validCount).toBe(2);
    expect(db.__state.run.invalidCount).toBe(0);
    expect(db.__state.run.judgeVersion).toBe(computeJudgeVersion());
    expect(db.__state.run.judgeModel).toBe("test/model-a");

    // Lock was released after completion.
    expect(__classifyLocksForTest.has(10)).toBe(false);
  });

  it("rejects if the version became current while awaiting the lock", async () => {
    const db = createFakeDb({
      run: {
        id: 30,
        status: "finished",
        categoryDisplayName: "fruits",
        score: 0,
        validCount: 0,
        invalidCount: 0,
        ambiguousCount: 0,
        judgeModel: "test/model-legacy",
        judgeVersion: "legacy-hash",
      },
      answers: [],
    });

    // Simulate another rerun finishing while we wait on its lock:
    // when `pending` resolves, the run's judgeVersion is now current.
    const pending = new Promise<void>((resolve) => {
      setTimeout(() => {
        db.__state.run.judgeVersion = computeJudgeVersion();
        resolve();
      }, 10);
    });
    __classifyLocksForTest.set(30, pending);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rerunJudgingForRun(db as any, 30),
    ).rejects.toBeInstanceOf(JudgeVersionAlreadyCurrentError);

    // Judge was never called because the post-lock check bailed out.
    expect(judgeMocks.judgeCategoryFit).not.toHaveBeenCalled();
    // No history row inserted.
    expect(db.__state.history).toHaveLength(0);
  });

  it("awaits an in-flight classifyLocks entry before rerunning", async () => {
    const db = createFakeDb({
      run: {
        id: 20,
        status: "finished",
        categoryDisplayName: "fruits",
        score: 0,
        validCount: 0,
        invalidCount: 0,
        ambiguousCount: 0,
        judgeModel: "test/model-legacy",
        judgeVersion: "legacy-hash",
      },
      answers: [
        {
          id: 200,
          runId: 20,
          text: "apple",
          normalizedText: "apple",
          label: null,
          confidence: null,
          reason: null,
          isDuplicate: false,
        },
      ],
    });

    let released = false;
    const pending = new Promise<void>((resolve) => {
      setTimeout(() => {
        released = true;
        resolve();
      }, 20);
    });
    __classifyLocksForTest.set(20, pending);

    judgeMocks.judgeCategoryFit.mockImplementation(
      async (
        _c: string,
        candidates: { answerId: number; text: string }[],
      ) => {
        // When the rerun's judge is invoked, the pending lock must have
        // already resolved.
        expect(released).toBe(true);
        for (const c of candidates) {
          const row = db.__state.answers.find((a) => a.id === c.answerId);
          if (row) {
            row.label = "valid";
            row.confidence = 1;
            row.reason = "ok";
          }
        }
        return candidates.map((c) => ({
          answerId: c.answerId,
          label: "valid" as const,
          confidence: 1,
          reason: "ok",
        }));
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await rerunJudgingForRun(db as any, 20);

    expect(released).toBe(true);
    expect(db.__state.run.judgeVersion).toBe(computeJudgeVersion());
  });
});
