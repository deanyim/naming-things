import { describe, it, expect } from "vitest";
import { computeCounts } from "./scoring";
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
