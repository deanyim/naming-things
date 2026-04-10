import { describe, it, expect } from "vitest";
import { computeCumulativeSeries } from "./answer-rate-chart";

const START = new Date("2026-01-01T00:00:00Z");

function at(offsetSeconds: number) {
  return new Date(START.getTime() + offsetSeconds * 1000);
}

describe("computeCumulativeSeries", () => {
  it("returns zero-filled series when there are no answers", () => {
    const series = computeCumulativeSeries([], START, 10);
    expect(series).toHaveLength(11); // 0..10 inclusive
    expect(series.every((p) => p.count === 0)).toBe(true);
  });

  it("counts non-duplicate answers only", () => {
    const answers = [
      { createdAt: at(1), isDuplicate: false },
      { createdAt: at(2), isDuplicate: true },
      { createdAt: at(3), isDuplicate: false },
    ];
    const series = computeCumulativeSeries(answers, START, 10);
    expect(series[10]!.count).toBe(2);
  });

  it("produces cumulative counts per second", () => {
    const answers = [
      { createdAt: at(0), isDuplicate: false },
      { createdAt: at(2), isDuplicate: false },
      { createdAt: at(5), isDuplicate: false },
    ];
    const series = computeCumulativeSeries(answers, START, 10);
    expect(series[0]!.count).toBe(1);
    expect(series[1]!.count).toBe(1);
    expect(series[2]!.count).toBe(2);
    expect(series[4]!.count).toBe(2);
    expect(series[5]!.count).toBe(3);
    expect(series[10]!.count).toBe(3);
  });

  it("clamps negative elapsed times to zero", () => {
    const answers = [
      { createdAt: new Date(START.getTime() - 1000), isDuplicate: false },
    ];
    const series = computeCumulativeSeries(answers, START, 5);
    expect(series[0]!.count).toBe(1);
  });

  it("handles answers after the timer ends", () => {
    const answers = [
      { createdAt: at(1), isDuplicate: false },
      { createdAt: at(15), isDuplicate: false }, // beyond 10s timer
    ];
    const series = computeCumulativeSeries(answers, START, 10);
    // Only the in-range answer is counted in the series
    expect(series[10]!.count).toBe(1);
  });

  it("accepts ISO string dates", () => {
    const answers = [
      { createdAt: at(3).toISOString(), isDuplicate: false },
    ];
    const series = computeCumulativeSeries(answers, START.toISOString(), 10);
    expect(series[3]!.count).toBe(1);
  });

  it("returns duration + 1 entries", () => {
    const series = computeCumulativeSeries([], START, 60);
    expect(series).toHaveLength(61);
    expect(series[0]!.second).toBe(0);
    expect(series[60]!.second).toBe(60);
  });

  it("validOnly counts only answers labeled 'valid'", () => {
    const answers = [
      { createdAt: at(1), isDuplicate: false, label: "valid" },
      { createdAt: at(2), isDuplicate: false, label: "invalid" },
      { createdAt: at(3), isDuplicate: false, label: "ambiguous" },
      { createdAt: at(4), isDuplicate: false, label: "valid" },
    ];
    const all = computeCumulativeSeries(answers, START, 10, false);
    const validOnly = computeCumulativeSeries(answers, START, 10, true);
    expect(all[10]!.count).toBe(4);
    expect(validOnly[10]!.count).toBe(2);
  });

  it("validOnly excludes answers with null labels (pre-scoring)", () => {
    const answers = [
      { createdAt: at(1), isDuplicate: false, label: null },
      { createdAt: at(2), isDuplicate: false, label: "valid" },
    ];
    const validOnly = computeCumulativeSeries(answers, START, 10, true);
    expect(validOnly[10]!.count).toBe(1);
  });
});
