import { describe, expect, it } from "vitest";
import { normalizeCategory } from "./normalize";

describe("normalizeCategory", () => {
  it("trims and lowercases", () => {
    const result = normalizeCategory("  Fruits  ");
    expect(result.displayName).toBe("fruits");
  });

  it("collapses whitespace", () => {
    const result = normalizeCategory("types  of   cheese");
    expect(result.displayName).toBe("cheese");
  });

  it("strips surrounding punctuation", () => {
    const result = normalizeCategory("...fruits!!!");
    expect(result.displayName).toBe("fruits");
  });

  it("normalizes & to 'and'", () => {
    const result = normalizeCategory("rock & roll bands");
    expect(result.displayName).toBe("rock and roll bands");
  });

  it("strips 'types of' prefix", () => {
    const result = normalizeCategory("types of cheese");
    expect(result.displayName).toBe("cheese");
  });

  it("strips 'kinds of' prefix", () => {
    const result = normalizeCategory("kinds of animals");
    expect(result.displayName).toBe("animals");
  });

  it("strips 'examples of' prefix", () => {
    const result = normalizeCategory("examples of sports");
    expect(result.displayName).toBe("sports");
  });

  it("strips 'list of' prefix", () => {
    const result = normalizeCategory("list of colors");
    expect(result.displayName).toBe("colors");
  });

  it("strips 'name some' prefix", () => {
    const result = normalizeCategory("name some vegetables");
    expect(result.displayName).toBe("vegetables");
  });

  it("produces consistent slugs for singular/plural", () => {
    const singular = normalizeCategory("fruit");
    const plural = normalizeCategory("fruits");
    expect(singular.slug).toBe(plural.slug);
  });

  it("handles 'ies' plural form", () => {
    const singular = normalizeCategory("country");
    const plural = normalizeCategory("countries");
    expect(singular.slug).toBe(plural.slug);
  });

  it("handles 'ves' plural form", () => {
    const singular = normalizeCategory("leaf");
    const plural = normalizeCategory("leaves");
    expect(singular.slug).toBe(plural.slug);
  });

  it("handles 'es' plural form for sh/ch/x/z", () => {
    const singular = normalizeCategory("dish");
    const plural = normalizeCategory("dishes");
    expect(singular.slug).toBe(plural.slug);
  });

  it("does not mangle words ending in ss", () => {
    const result = normalizeCategory("glass");
    expect(result.slug).toBe("glass");
  });

  it("does not mangle words ending in us", () => {
    const result = normalizeCategory("cactus");
    expect(result.slug).toBe("cactus");
  });

  it("does not mangle short words", () => {
    const result = normalizeCategory("gas");
    expect(result.slug).toBe("gas");
  });

  it("handles multi-word categories", () => {
    const result = normalizeCategory("board games");
    expect(result.displayName).toBe("board games");
    expect(result.slug).toBe("board-game");
  });

  it("strips prefix and normalizes together", () => {
    const result = normalizeCategory("Types of  FRUITS!!!");
    expect(result.displayName).toBe("fruits");
    expect(result.slug).toBe("fruit");
  });

  it("'types of fruit' and 'fruits' produce same slug", () => {
    const a = normalizeCategory("types of fruit");
    const b = normalizeCategory("fruits");
    expect(a.slug).toBe(b.slug);
  });

  it("returns empty string for empty input", () => {
    const result = normalizeCategory("   ");
    expect(result.displayName).toBe("");
    expect(result.slug).toBe("");
  });

  it("displayName may differ from slug due to singular normalization", () => {
    const result = normalizeCategory("fruits");
    expect(result.displayName).toBe("fruits");
    expect(result.slug).toBe("fruit");
    // Leaderboard lookups must use the slug, not the displayName
    expect(result.displayName).not.toBe(result.slug);
  });

  it("displayName equals slug when no singular normalization needed", () => {
    const result = normalizeCategory("fruit");
    expect(result.displayName).toBe("fruit");
    expect(result.slug).toBe("fruit");
  });

  it("slug with hyphens can be converted back to approximate display name", () => {
    const result = normalizeCategory("board games");
    expect(result.slug).toBe("board-game");
    // Replacing hyphens with spaces gives a reasonable fallback display name
    expect(result.slug.replace(/-/g, " ")).toBe("board game");
  });
});
