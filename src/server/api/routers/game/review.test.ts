import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reviewMocks = vi.hoisted(() => ({
  notify: vi.fn(),
  classifyUnverifiedAnswers: vi.fn(),
  markClassificationAttempt: vi.fn(),
}));

vi.mock("~/env", async () => {
  const actual = await vi.importActual<typeof import("~/env")>("~/env");

  return {
    env: {
      ...actual.env,
      OPENROUTER_API_KEY: "test-openrouter-key",
      OPENROUTER_MODEL: "test-model",
    },
  };
});

vi.mock("~/server/ws/notify", () => ({
  notify: reviewMocks.notify,
}));

vi.mock("./helpers", async () => {
  const actual = await vi.importActual<typeof import("./helpers")>("./helpers");

  return {
    ...actual,
    classifyUnverifiedAnswers: reviewMocks.classifyUnverifiedAnswers,
    markClassificationAttempt: reviewMocks.markClassificationAttempt,
  };
});

import { createMockDb, createTestCaller } from "~/server/api/test/trpc";
import { CLASSIFICATION_RETRY_AFTER_MS } from "./helpers";

describe("reviewRouter", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    reviewMocks.notify.mockReset();
    reviewMocks.classifyUnverifiedAnswers.mockReset();
    reviewMocks.markClassificationAttempt.mockReset();
  });

  it("reports classifying while the cooldown is still active", async () => {
    const db = createMockDb();
    db.query.players.findFirst.mockResolvedValue({ id: 1 });
    db.query.games.findFirst.mockResolvedValue({
      id: 7,
      status: "reviewing",
      autoClassificationEnabled: true,
      category: "fruit",
      classifiedAt: new Date(1_000_000 - CLASSIFICATION_RETRY_AFTER_MS + 1),
      isTeamMode: false,
    });
    db.query.answers.findMany.mockResolvedValue([
      {
        id: 11,
        gameId: 7,
        playerId: 1,
        text: "apple",
        normalizedText: "apple",
        status: "accepted",
        player: { id: 1, displayName: "Kate" },
        disputeVotes: [],
        verification: null,
      },
    ]);

    const caller = createTestCaller(db);
    const result = await caller.game.getAllAnswers({
      sessionToken: "session-1",
      gameId: 7,
    });

    expect(result.classifying).toBe(true);
    expect(result.canManuallyClassify).toBe(false);
    expect(result.groups).toHaveLength(1);
  });

  it("exposes manual retry once the cooldown has elapsed", async () => {
    const db = createMockDb();
    db.query.players.findFirst.mockResolvedValue({ id: 1 });
    db.query.games.findFirst.mockResolvedValue({
      id: 7,
      status: "reviewing",
      autoClassificationEnabled: true,
      category: "fruit",
      classifiedAt: new Date(1_000_000 - CLASSIFICATION_RETRY_AFTER_MS),
      isTeamMode: false,
    });
    db.query.answers.findMany.mockResolvedValue([
      {
        id: 11,
        gameId: 7,
        playerId: 1,
        text: "apple",
        normalizedText: "apple",
        status: "accepted",
        player: { id: 1, displayName: "Kate" },
        disputeVotes: [],
        verification: null,
      },
    ]);

    const caller = createTestCaller(db);
    const result = await caller.game.getAllAnswers({
      sessionToken: "session-1",
      gameId: 7,
    });

    expect(result.classifying).toBe(false);
    expect(result.canManuallyClassify).toBe(true);
  });

  it("lets the host manually retry classification after the cooldown", async () => {
    const db = createMockDb();
    db.query.players.findFirst.mockResolvedValue({ id: 1 });
    db.query.games.findFirst.mockResolvedValue({
      id: 7,
      code: "ABC123",
      hostPlayerId: 1,
      status: "reviewing",
      autoClassificationEnabled: true,
      category: "fruit",
      classifiedAt: new Date(1_000_000 - CLASSIFICATION_RETRY_AFTER_MS),
    });

    const caller = createTestCaller(db);
    const result = await caller.game.retryAutoClassification({
      sessionToken: "session-1",
      gameId: 7,
    });

    expect(result).toEqual({ success: true });
    expect(reviewMocks.markClassificationAttempt).toHaveBeenCalledWith(db, 7);
    expect(reviewMocks.classifyUnverifiedAnswers).toHaveBeenCalledWith(db, 7, "fruit");
    expect(reviewMocks.notify).toHaveBeenCalledWith("ABC123");
  });

  it("rejects manual retry while the cooldown is still active", async () => {
    const db = createMockDb();
    db.query.players.findFirst.mockResolvedValue({ id: 1 });
    db.query.games.findFirst.mockResolvedValue({
      id: 7,
      code: "ABC123",
      hostPlayerId: 1,
      status: "reviewing",
      autoClassificationEnabled: true,
      category: "fruit",
      classifiedAt: new Date(1_000_000 - CLASSIFICATION_RETRY_AFTER_MS + 1),
    });

    const caller = createTestCaller(db);

    await expect(
      caller.game.retryAutoClassification({
        sessionToken: "session-1",
        gameId: 7,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Auto-classification was attempted recently. Please wait and try again.",
    });

    expect(reviewMocks.markClassificationAttempt).not.toHaveBeenCalled();
    expect(reviewMocks.classifyUnverifiedAnswers).not.toHaveBeenCalled();
    expect(reviewMocks.notify).not.toHaveBeenCalled();
  });
});
