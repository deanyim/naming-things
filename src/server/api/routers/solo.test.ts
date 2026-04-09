import { describe, it, expect } from "vitest";
import { normalizeCategory } from "~/server/lib/categories/normalize";
import { normalizeAnswer } from "~/lib/normalize";

// Test category normalization for leaderboard bucketing
describe("solo leaderboard bucketing", () => {
  it("same categorySlug + timerSeconds = same bucket", () => {
    const a = normalizeCategory("fruits");
    const b = normalizeCategory("Fruits");
    const c = normalizeCategory("  fruits  ");

    expect(a.slug).toBe(b.slug);
    expect(b.slug).toBe(c.slug);
  });

  it("'types of fruit' and 'fruits' share a bucket slug", () => {
    const a = normalizeCategory("types of fruit");
    const b = normalizeCategory("fruits");
    expect(a.slug).toBe(b.slug);
  });

  it("different categories produce different slugs", () => {
    const a = normalizeCategory("fruits");
    const b = normalizeCategory("cheeses");
    expect(a.slug).not.toBe(b.slug);
  });

  it("multi-word categories produce hyphenated slugs", () => {
    const result = normalizeCategory("board games");
    expect(result.slug).toBe("board-game");
  });
});

// Test duplicate answer handling
describe("duplicate answer detection", () => {
  it("normalized text comparison catches case differences", () => {
    const a = normalizeAnswer("Apple");
    const b = normalizeAnswer("apple");
    expect(a.normalizedText).toBe(b.normalizedText);
  });

  it("normalized text comparison catches whitespace differences", () => {
    const a = normalizeAnswer("green apple");
    const b = normalizeAnswer("green  apple");
    expect(a.normalizedText).toBe(b.normalizedText);
  });

  it("normalized text catches article differences", () => {
    const a = normalizeAnswer("the apple");
    const b = normalizeAnswer("apple");
    expect(a.normalizedText).toBe(b.normalizedText);
  });
});

// Test leaderboard ranking logic
describe("leaderboard ranking order", () => {
  type LeaderboardEntry = {
    playerId: number;
    score: number;
    durationMs: number;
    createdAt: Date;
  };

  function rankEntries(entries: LeaderboardEntry[]) {
    return entries.sort((a, b) => {
      // score desc
      if (b.score !== a.score) return b.score - a.score;
      // durationMs asc
      if (a.durationMs !== b.durationMs) return a.durationMs - b.durationMs;
      // createdAt asc
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  function bestPerPlayer(entries: LeaderboardEntry[]) {
    const sorted = rankEntries(entries);
    const seen = new Set<number>();
    return sorted.filter((e) => {
      if (seen.has(e.playerId)) return false;
      seen.add(e.playerId);
      return true;
    });
  }

  it("higher score ranks first", () => {
    const entries: LeaderboardEntry[] = [
      { playerId: 1, score: 5, durationMs: 60000, createdAt: new Date("2024-01-01") },
      { playerId: 2, score: 10, durationMs: 60000, createdAt: new Date("2024-01-01") },
    ];

    const ranked = rankEntries(entries);
    expect(ranked[0]!.playerId).toBe(2);
    expect(ranked[1]!.playerId).toBe(1);
  });

  it("same score: shorter duration ranks first", () => {
    const entries: LeaderboardEntry[] = [
      { playerId: 1, score: 10, durationMs: 60000, createdAt: new Date("2024-01-01") },
      { playerId: 2, score: 10, durationMs: 45000, createdAt: new Date("2024-01-01") },
    ];

    const ranked = rankEntries(entries);
    expect(ranked[0]!.playerId).toBe(2);
  });

  it("same score and duration: earlier createdAt ranks first", () => {
    const entries: LeaderboardEntry[] = [
      { playerId: 1, score: 10, durationMs: 60000, createdAt: new Date("2024-01-02") },
      { playerId: 2, score: 10, durationMs: 60000, createdAt: new Date("2024-01-01") },
    ];

    const ranked = rankEntries(entries);
    expect(ranked[0]!.playerId).toBe(2);
  });

  it("best per player keeps only highest-ranked run", () => {
    const entries: LeaderboardEntry[] = [
      { playerId: 1, score: 5, durationMs: 60000, createdAt: new Date("2024-01-01") },
      { playerId: 1, score: 10, durationMs: 60000, createdAt: new Date("2024-01-02") },
      { playerId: 2, score: 7, durationMs: 60000, createdAt: new Date("2024-01-01") },
    ];

    const best = bestPerPlayer(entries);
    expect(best).toHaveLength(2);
    expect(best[0]!.playerId).toBe(1);
    expect(best[0]!.score).toBe(10);
    expect(best[1]!.playerId).toBe(2);
  });

  it("multiple players with multiple runs", () => {
    const entries: LeaderboardEntry[] = [
      { playerId: 1, score: 5, durationMs: 30000, createdAt: new Date("2024-01-01") },
      { playerId: 1, score: 8, durationMs: 60000, createdAt: new Date("2024-01-02") },
      { playerId: 2, score: 8, durationMs: 50000, createdAt: new Date("2024-01-01") },
      { playerId: 2, score: 8, durationMs: 45000, createdAt: new Date("2024-01-03") },
      { playerId: 3, score: 12, durationMs: 60000, createdAt: new Date("2024-01-01") },
    ];

    const best = bestPerPlayer(entries);
    expect(best).toHaveLength(3);
    // Player 3 first (score 12)
    expect(best[0]!.playerId).toBe(3);
    // Player 2 second (score 8, best duration 45s)
    expect(best[1]!.playerId).toBe(2);
    expect(best[1]!.durationMs).toBe(45000);
    // Player 1 third (score 8, duration 60s)
    expect(best[2]!.playerId).toBe(1);
    expect(best[2]!.score).toBe(8);
  });
});

// Test overview bucketing merges by slug, not displayName
describe("leaderboard overview bucketing", () => {
  type OverviewEntry = {
    categorySlug: string;
    categoryDisplayName: string;
    timerSeconds: number;
  };

  function groupBuckets(entries: OverviewEntry[]) {
    const map = new Map<string, { categorySlug: string; categoryDisplayName: string; timerSeconds: number; runCount: number }>();
    for (const e of entries) {
      const key = `${e.categorySlug}::${e.timerSeconds}`;
      const existing = map.get(key);
      if (existing) {
        existing.runCount++;
        // max() picks the lexicographically last displayName
        if (e.categoryDisplayName > existing.categoryDisplayName) {
          existing.categoryDisplayName = e.categoryDisplayName;
        }
      } else {
        map.set(key, {
          categorySlug: e.categorySlug,
          categoryDisplayName: e.categoryDisplayName,
          timerSeconds: e.timerSeconds,
          runCount: 1,
        });
      }
    }
    return Array.from(map.values());
  }

  it("merges 'color' and 'colors' into one bucket", () => {
    const entries: OverviewEntry[] = [
      { categorySlug: "color", categoryDisplayName: "color", timerSeconds: 60 },
      { categorySlug: "color", categoryDisplayName: "color", timerSeconds: 60 },
      { categorySlug: "color", categoryDisplayName: "colors", timerSeconds: 60 },
      { categorySlug: "color", categoryDisplayName: "colors", timerSeconds: 60 },
      { categorySlug: "color", categoryDisplayName: "colors", timerSeconds: 60 },
    ];

    const buckets = groupBuckets(entries);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.runCount).toBe(5);
    expect(buckets[0]!.categorySlug).toBe("color");
  });

  it("different timer values stay separate", () => {
    const entries: OverviewEntry[] = [
      { categorySlug: "color", categoryDisplayName: "colors", timerSeconds: 60 },
      { categorySlug: "color", categoryDisplayName: "colors", timerSeconds: 10 },
    ];

    const buckets = groupBuckets(entries);
    expect(buckets).toHaveLength(2);
  });

  it("different slugs stay separate", () => {
    const entries: OverviewEntry[] = [
      { categorySlug: "color", categoryDisplayName: "colors", timerSeconds: 60 },
      { categorySlug: "fruit", categoryDisplayName: "fruits", timerSeconds: 60 },
    ];

    const buckets = groupBuckets(entries);
    expect(buckets).toHaveLength(2);
  });
});

// Test alias resolution
describe("alias-based category merge", () => {
  it("normalizeCategory produces same slug for singular/plural", () => {
    const fruit = normalizeCategory("fruit");
    const fruits = normalizeCategory("fruits");
    expect(fruit.slug).toBe(fruits.slug);
  });

  it("normalizeCategory strips prefix before slugifying", () => {
    const typesOfFruit = normalizeCategory("types of fruit");
    const fruit = normalizeCategory("fruit");
    expect(typesOfFruit.slug).toBe(fruit.slug);
  });

  it("'types of cheese' and 'cheeses' converge", () => {
    const a = normalizeCategory("types of cheese");
    const b = normalizeCategory("cheeses");
    expect(a.slug).toBe(b.slug);
  });

  it("'kinds of cheese' and 'cheese' converge", () => {
    const a = normalizeCategory("kinds of cheese");
    const b = normalizeCategory("cheese");
    expect(a.slug).toBe(b.slug);
  });
});
