import { describe, it, expect } from "vitest";
import { stripMarkdownFences, extractJsonText } from "./client";

describe("stripMarkdownFences", () => {
  it("returns plain text unchanged", () => {
    expect(stripMarkdownFences('{"key": "value"}')).toBe('{"key": "value"}');
  });

  it("strips ```json fences", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
  });

  it("strips bare ``` fences", () => {
    const input = '```\n{"key": "value"}\n```';
    expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
  });

  it("strips fences with language tag", () => {
    const input = '```JSON\n{"a": 1}\n```';
    expect(stripMarkdownFences(input)).toBe('{"a": 1}');
  });

  it("handles single-line fenced content", () => {
    const input = '```json{"a": 1}```';
    expect(stripMarkdownFences(input)).toBe('{"a": 1}');
  });

  it("trims surrounding whitespace", () => {
    const input = '  \n```json\n{"a": 1}\n```\n  ';
    expect(stripMarkdownFences(input)).toBe('{"a": 1}');
  });

  it("preserves content with no fences but leading whitespace", () => {
    expect(stripMarkdownFences("  hello  ")).toBe("hello");
  });
});

describe("extractJsonText", () => {
  it("returns valid JSON as-is", () => {
    const json = '{"decisions": []}';
    expect(extractJsonText(json)).toBe(json);
  });

  it("extracts JSON from markdown fences", () => {
    const input = '```json\n{"decisions": []}\n```';
    expect(extractJsonText(input)).toBe('{"decisions": []}');
  });

  it("extracts JSON object from surrounding text", () => {
    const input = 'Here is the result: {"a": 1} hope this helps';
    expect(extractJsonText(input)).toBe('{"a": 1}');
  });

  it("extracts outermost braces when JSON is malformed prefix", () => {
    const input = 'some text {"a": 1, "b": {"c": 2}} trailing';
    expect(extractJsonText(input)).toBe('{"a": 1, "b": {"c": 2}}');
  });

  it("returns original text when no braces found", () => {
    const input = "no json here";
    expect(extractJsonText(input)).toBe("no json here");
  });

  it("handles nested objects", () => {
    const input = '{"outer": {"inner": true}}';
    expect(extractJsonText(input)).toBe('{"outer": {"inner": true}}');
  });

  it("handles fences + surrounding text", () => {
    const input = '```\nSure! {"a": 1}\n```';
    const result = extractJsonText(input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });
});
