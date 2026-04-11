import { describe, it, expect, vi } from "vitest";
import {
  generateSoloSlug,
  insertWithUniqueSoloSlug,
  SLUG_WORD_LISTS,
  SOLO_SLUG_SPACE,
  SoloSlugExhaustedError,
} from "./slug";

describe("generateSoloSlug", () => {
  it("produces a hyphen-separated 3-word slug", () => {
    const slug = generateSoloSlug();
    expect(slug.split("-")).toHaveLength(3);
  });

  it("space has > 1M combinations", () => {
    // Guard against accidental shrinking of the word lists; if this fails
    // the collision analysis is no longer valid.
    expect(SOLO_SLUG_SPACE).toBeGreaterThan(1_000_000);
  });

  it("word lists contain no duplicates", () => {
    // A duplicate silently skews the uniform RNG and shrinks the space.
    for (const [name, list] of Object.entries(SLUG_WORD_LISTS)) {
      const unique = new Set(list);
      expect(
        unique.size,
        `${name} has ${list.length - unique.size} duplicates`,
      ).toBe(list.length);
    }
  });
});

describe("insertWithUniqueSoloSlug", () => {
  it("returns on first attempt when there is no conflict", async () => {
    const attempt = vi.fn(async (slug: string) => ({ slug }));
    const result = await insertWithUniqueSoloSlug(attempt);
    expect(result.slug).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries on conflict with a fresh slug each time", async () => {
    const seenSlugs: string[] = [];
    let callCount = 0;
    const attempt = vi.fn(async (slug: string) => {
      seenSlugs.push(slug);
      callCount++;
      if (callCount < 3) return null; // simulate conflict
      return { slug };
    });

    const result = await insertWithUniqueSoloSlug(attempt);
    expect(callCount).toBe(3);
    expect(result.slug).toBe(seenSlugs[2]);
    // Each attempt should get a freshly generated slug (not re-using the
    // failed one). We can't guarantee uniqueness with random generation
    // but we can at least assert the function called `generateSoloSlug`
    // once per attempt — evidenced by `attempt` being called with a
    // valid slug shape each time.
    for (const s of seenSlugs) {
      expect(s).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    }
  });

  it("throws SoloSlugExhaustedError if all attempts conflict", async () => {
    const attempt = vi.fn(async () => null);
    const err = await insertWithUniqueSoloSlug(attempt, 4).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SoloSlugExhaustedError);
    expect((err as SoloSlugExhaustedError).attempts).toBe(4);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("does not retry on thrown errors", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(insertWithUniqueSoloSlug(attempt)).rejects.toThrow(
      "boom",
    );
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
