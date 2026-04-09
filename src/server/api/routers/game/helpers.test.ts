import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canRetryClassification,
  CLASSIFICATION_RETRY_AFTER_MS,
} from "./helpers";

describe("canRetryClassification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows retry when no prior attempt exists", () => {
    expect(canRetryClassification(null)).toBe(true);
    expect(canRetryClassification(undefined)).toBe(true);
  });

  it("blocks retry when the last attempt is still within the cooldown", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    expect(
      canRetryClassification(
        new Date(1_000_000 - CLASSIFICATION_RETRY_AFTER_MS + 1),
      ),
    ).toBe(false);
  });

  it("allows retry exactly at the cooldown boundary", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    expect(
      canRetryClassification(
        new Date(1_000_000 - CLASSIFICATION_RETRY_AFTER_MS),
      ),
    ).toBe(true);
  });

  it("allows retry when the last attempt is older than the cooldown", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    expect(
      canRetryClassification(
        new Date(1_000_000 - CLASSIFICATION_RETRY_AFTER_MS - 1),
      ),
    ).toBe(true);
  });
});
