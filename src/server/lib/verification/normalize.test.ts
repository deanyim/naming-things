import { describe, it, expect } from "vitest";
import { normalizeAnswer } from "./normalize";

describe("normalizeAnswer", () => {
  it("returns original and trimmed text", () => {
    const result = normalizeAnswer("  Hello  ");
    expect(result.originalText).toBe("  Hello  ");
    expect(result.trimmedText).toBe("Hello");
  });

  it("lowercases text", () => {
    const result = normalizeAnswer("BANANA");
    expect(result.normalizedText).toBe("banana");
    expect(result.appliedRules).toContain("lowercase");
  });

  it("does not flag lowercase rule when already lowercase", () => {
    const result = normalizeAnswer("banana");
    expect(result.appliedRules).not.toContain("lowercase");
  });

  it("collapses multiple whitespace", () => {
    const result = normalizeAnswer("ice   cream");
    expect(result.normalizedText).toBe("ice cream");
    expect(result.appliedRules).toContain("collapse_whitespace");
  });

  it("strips leading articles: a, an, the", () => {
    expect(normalizeAnswer("a banana").normalizedText).toBe("banana");
    expect(normalizeAnswer("an apple").normalizedText).toBe("apple");
    expect(normalizeAnswer("the cat").normalizedText).toBe("cat");
    expect(normalizeAnswer("a banana").appliedRules).toContain("strip_article");
  });

  it("does not strip articles mid-word", () => {
    expect(normalizeAnswer("theater").normalizedText).toBe("theater");
    expect(normalizeAnswer("theater").appliedRules).not.toContain(
      "strip_article",
    );
  });

  it("normalizes hyphens and underscores to spaces", () => {
    const result = normalizeAnswer("ice-cream");
    expect(result.normalizedText).toBe("ice cream");
    expect(result.appliedRules).toContain("normalize_separator");

    const result2 = normalizeAnswer("ping_pong");
    expect(result2.normalizedText).toBe("ping pong");
  });

  it("strips punctuation", () => {
    const result = normalizeAnswer("hello!");
    expect(result.normalizedText).toBe("hello");
    expect(result.appliedRules).toContain("normalize_punctuation");
  });

  it("handles parentheses and brackets", () => {
    const result = normalizeAnswer("cat (domestic)");
    expect(result.normalizedText).toBe("cat domestic");
  });

  it("conservative singularize: basic plural -s", () => {
    const result = normalizeAnswer("bananas");
    expect(result.canonicalText).toBe("banana");
    expect(result.appliedRules).toContain("conservative_singularize");
  });

  it("conservative singularize: -ies to -y", () => {
    expect(normalizeAnswer("berries").canonicalText).toBe("berry");
    expect(normalizeAnswer("countries").canonicalText).toBe("country");
  });

  it("conservative singularize: -ses and -xes", () => {
    expect(normalizeAnswer("buses").canonicalText).toBe("bus");
    expect(normalizeAnswer("foxes").canonicalText).toBe("fox");
  });

  it("does not singularize words ending in -ss", () => {
    expect(normalizeAnswer("chess").canonicalText).toBe("chess");
    expect(normalizeAnswer("bass").canonicalText).toBe("bass");
  });

  it("does not singularize short words (<=3 chars)", () => {
    expect(normalizeAnswer("gas").canonicalText).toBe("gas");
    expect(normalizeAnswer("bus").canonicalText).toBe("bus");
  });

  it("applies multiple rules together", () => {
    const result = normalizeAnswer("  The Ice-Creams!  ");
    expect(result.canonicalText).toBe("ice cream");
    expect(result.appliedRules).toContain("lowercase");
    expect(result.appliedRules).toContain("strip_article");
    expect(result.appliedRules).toContain("normalize_separator");
    expect(result.appliedRules).toContain("normalize_punctuation");
    expect(result.appliedRules).toContain("conservative_singularize");
  });

  it("returns empty applied rules when nothing changes", () => {
    const result = normalizeAnswer("cat");
    expect(result.appliedRules).toEqual([]);
    expect(result.normalizedText).toBe("cat");
    expect(result.canonicalText).toBe("cat");
  });

  it("handles empty string", () => {
    const result = normalizeAnswer("");
    expect(result.normalizedText).toBe("");
    expect(result.canonicalText).toBe("");
  });

  it("normalizes equivalent answers to the same canonical form", () => {
    const variants = [
      "Ice Cream",
      "ice cream",
      "ice-cream",
      "Ice-Cream",
      "  ice   cream  ",
      "The Ice Cream",
    ];
    const canonicals = variants.map((v) => normalizeAnswer(v).canonicalText);
    expect(new Set(canonicals).size).toBe(1);
    expect(canonicals[0]).toBe("ice cream");
  });
});
