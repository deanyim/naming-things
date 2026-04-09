import { describe, it, expect, vi, beforeEach } from "vitest";
import { judgeCategoryFit } from "./category-fit";

const mockCallOpenRouterJson = vi.fn();

vi.mock("../openrouter/client", () => ({
  callOpenRouterJson: (...args: unknown[]) => mockCallOpenRouterJson(...args),
}));

function makeCandidates(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    answerId: i + 1,
    text: `answer-${i + 1}`,
  }));
}

function mockDecisions(
  items: { answerId: number; category: string; candidate_answer: string }[],
) {
  return {
    parsed: {
      decisions: items.map((item) => ({
        answerId: item.answerId,
        label: "valid" as const,
        confidence: 0.9,
        reason: "test",
      })),
    },
  };
}

beforeEach(() => {
  mockCallOpenRouterJson.mockReset();
  mockCallOpenRouterJson.mockImplementation((input: { messages: { content: string }[] }) => {
    const content = input.messages[0]!.content;
    const itemsMatch = content.match(/Items:\n([\s\S]+)$/);
    const items = JSON.parse(itemsMatch![1]!) as {
      answerId: number;
      category: string;
      candidate_answer: string;
    }[];
    return Promise.resolve(mockDecisions(items));
  });
});

describe("judgeCategoryFit", () => {
  it("returns empty array for empty candidates", async () => {
    const result = await judgeCategoryFit("fruits", []);
    expect(result).toEqual([]);
    expect(mockCallOpenRouterJson).not.toHaveBeenCalled();
  });

  it("sends single request when candidates fit in one chunk", async () => {
    const candidates = makeCandidates(5);
    const result = await judgeCategoryFit("fruits", candidates);

    expect(mockCallOpenRouterJson).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(5);
    expect(result[0]!.answerId).toBe(1);
    expect(result[4]!.answerId).toBe(5);
  });

  it("splits into multiple chunks when exceeding chunk size", async () => {
    const candidates = makeCandidates(30);
    const result = await judgeCategoryFit("fruits", candidates, {
      chunkSize: 10,
    });

    expect(mockCallOpenRouterJson).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(30);
  });

  it("handles exact chunk size boundary", async () => {
    const candidates = makeCandidates(10);
    const result = await judgeCategoryFit("fruits", candidates, {
      chunkSize: 10,
    });

    // Exactly at chunk size — should not split
    expect(mockCallOpenRouterJson).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(10);
  });

  it("handles chunk size + 1", async () => {
    const candidates = makeCandidates(11);
    const result = await judgeCategoryFit("fruits", candidates, {
      chunkSize: 10,
    });

    expect(mockCallOpenRouterJson).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(11);
  });

  it("preserves answer order across chunks", async () => {
    const candidates = makeCandidates(60);
    const result = await judgeCategoryFit("fruits", candidates, {
      chunkSize: 25,
    });

    expect(mockCallOpenRouterJson).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(60);

    // Verify order is preserved
    for (let i = 0; i < 60; i++) {
      expect(result[i]!.answerId).toBe(i + 1);
    }
  });

  it("uses default chunk size of 25", async () => {
    const candidates = makeCandidates(50);
    const result = await judgeCategoryFit("fruits", candidates);

    expect(mockCallOpenRouterJson).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(50);
  });

  it("passes category to all chunks", async () => {
    const candidates = makeCandidates(30);
    await judgeCategoryFit("famous women", candidates, { chunkSize: 10 });

    for (const call of mockCallOpenRouterJson.mock.calls) {
      const content = (call as [{ messages: { content: string }[] }])[0]
        .messages[0]!.content;
      expect(content).toContain("famous women");
    }
  });

  it("runs chunks in parallel", async () => {
    const callOrder: number[] = [];
    const resolvers: (() => void)[] = [];

    mockCallOpenRouterJson.mockImplementation(
      (input: { messages: { content: string }[] }) => {
        const callIndex = callOrder.length;
        callOrder.push(callIndex);

        return new Promise((resolve) => {
          resolvers.push(() => {
            const content = input.messages[0]!.content;
            const itemsMatch = content.match(/Items:\n([\s\S]+)$/);
            const items = JSON.parse(itemsMatch![1]!) as {
              answerId: number;
              category: string;
              candidate_answer: string;
            }[];
            resolve(mockDecisions(items));
          });
        });
      },
    );

    const candidates = makeCandidates(30);
    const promise = judgeCategoryFit("fruits", candidates, { chunkSize: 10 });

    // Wait for all chunks to be dispatched
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));

    // All 3 chunks were called before any resolved — confirms parallel execution
    expect(callOrder).toEqual([0, 1, 2]);

    // Resolve all
    resolvers.forEach((r) => r());
    const result = await promise;
    expect(result).toHaveLength(30);
  });

  it("scales maxOutputTokens with chunk size", async () => {
    const candidates = makeCandidates(5);
    await judgeCategoryFit("fruits", candidates);

    const call = mockCallOpenRouterJson.mock.calls[0] as [
      { maxOutputTokens: number },
    ];
    // Math.max(512, 5 * 80) = 512
    expect(call[0].maxOutputTokens).toBe(512);

    mockCallOpenRouterJson.mockClear();

    const largeCandidates = makeCandidates(20);
    await judgeCategoryFit("fruits", largeCandidates);

    const largeCall = mockCallOpenRouterJson.mock.calls[0] as [
      { maxOutputTokens: number },
    ];
    // Math.max(512, 20 * 80) = 1600
    expect(largeCall[0].maxOutputTokens).toBe(1600);
  });
});
