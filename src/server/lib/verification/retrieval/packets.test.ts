import { describe, expect, it } from "vitest";
import {
  formatCategoryEvidencePacketForJudge,
  mergeEvidenceFacts,
  normalizeEvidenceFacts,
  normalizeEvidenceSources,
} from "./packets";
import type { CategoryEvidencePacket, EvidenceFact, EvidenceSource } from "../types";

describe("packet normalization", () => {
  it("dedupes sources by URL and rewrites source ids", () => {
    const sources: EvidenceSource[] = [
      {
        id: "official",
        url: "https://example.com/cast",
        title: "Cast",
        sourceType: "official",
        publishedAt: null,
        retrievedAt: "2026-05-09",
        snippet: "A".repeat(600),
      },
      {
        id: "duplicate",
        url: "https://example.com/cast",
        title: "Duplicate",
        sourceType: "official",
        publishedAt: null,
        retrievedAt: "2026-05-09",
        snippet: "duplicate",
      },
    ];

    const normalized = normalizeEvidenceSources(sources);
    expect(normalized.sources).toHaveLength(1);
    expect(normalized.sources[0]!.id).toBe("s1");
    expect(normalized.sources[0]!.snippet).toHaveLength(500);
    expect(normalized.idMap.get("official")).toBe("s1");
    expect(normalized.idMap.get("duplicate")).toBe("s1");
    expect(normalized.idMap.get("https://example.com/cast")).toBe("s1");
  });

  it("dedupes facts and removes aliases equal to canonical answers", () => {
    const facts: EvidenceFact[] = [
      {
        canonicalAnswer: "Joe Hunter",
        aliases: ["Joe", "Joe Hunter"],
        sourceIds: ["https://example.com/cast"],
        notes: "",
        matchKeys: ["joe hunter", "joseph hunter"],
        metadata: {
          datasetConfidence: "low",
        },
        sourceEntries: [
          {
            rawAnswer: "Joe Hunter",
            canonicalCandidate: "Joe Hunter",
            entityType: "person",
            metadata: {},
            sourcePointer: {
              url: "https://example.com/cast",
              blockType: "table",
              blockId: "table-1",
              rowIndex: 0,
              columnName: "Name",
              rawValue: "Joe Hunter",
            },
            confidence: 0.9,
          },
        ],
        confidence: 0.9,
      },
      {
        canonicalAnswer: "joe hunter",
        aliases: ["Joseph"],
        sourceIds: ["https://example.com/cast"],
        notes: null,
      },
    ];
    const idMap = new Map([["https://example.com/cast", "s1"]]);

    expect(normalizeEvidenceFacts(facts, idMap)).toEqual([
      {
        canonicalAnswer: "Joe Hunter",
        aliases: ["Joe"],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["joe hunter", "joseph hunter"],
        metadata: {
          datasetConfidence: "low",
        },
        sourceEntries: [
          {
            rawAnswer: "Joe Hunter",
            canonicalCandidate: "Joe Hunter",
            entityType: "person",
            metadata: {},
            sourcePointer: {
              url: "https://example.com/cast",
              blockType: "table",
              blockId: "table-1",
              rowIndex: 0,
              columnName: "Name",
              rawValue: "Joe Hunter",
            },
            confidence: 0.9,
          },
        ],
        confidence: 0.9,
      },
    ]);
  });
});

describe("mergeEvidenceFacts", () => {
  it("merges selected facts and keeps alternate canonical names as aliases", () => {
    const facts: EvidenceFact[] = [
      {
        canonicalAnswer: 'Kathleen "Kathy" Vavrick-O\'Brien',
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["kathleen kathy vavrick o brien"],
        metadata: { datasetConfidence: "high" },
        confidence: 0.9,
      },
      {
        canonicalAnswer: "Kathy Vavrick-O'Brien",
        aliases: [],
        sourceIds: ["s2"],
        notes: "alternate source display",
        matchKeys: ["kathy vavrick o brien"],
        metadata: { source: "table-2" },
        confidence: 0.8,
      },
      {
        canonicalAnswer: "Parvati Shallow",
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
      },
    ];

    const result = mergeEvidenceFacts(facts, [0, 1], 0);

    expect(result.facts).toHaveLength(2);
    expect(result.facts[0]).toMatchObject({
      canonicalAnswer: 'Kathleen "Kathy" Vavrick-O\'Brien',
      aliases: ["Kathy Vavrick-O'Brien"],
      sourceIds: ["s1", "s2"],
      notes: "alternate source display",
      matchKeys: [
        "kathleen kathy vavrick o brien",
        "kathy vavrick o brien",
      ],
      confidence: 0.9,
    });
    expect(result.facts[0]?.metadata?.manualMerge).toEqual({
      mergedFrom: [
        'Kathleen "Kathy" Vavrick-O\'Brien',
        "Kathy Vavrick-O'Brien",
      ],
      primary: 'Kathleen "Kathy" Vavrick-O\'Brien',
    });
    expect(result.facts[1]?.canonicalAnswer).toBe("Parvati Shallow");
  });
});

describe("formatCategoryEvidencePacketForJudge", () => {
  it("omits facts and sources for failure-like packet statuses", () => {
    const packet: CategoryEvidencePacket = {
      id: "cep_test",
      category: "Survivor winners",
      normalizedCategory: "survivor winners",
      kind: "public_result",
      status: "retrieval_failed",
      createdAt: "2026-05-09T00:00:00.000Z",
      retrievedAt: "2026-05-09T00:00:00.000Z",
      expiresAt: null,
      model: "test",
      searchProvider: "openrouter:web_search",
      sources: [
        {
          id: "s1",
          url: "https://example.com",
          title: "Example",
          sourceType: "official",
          publishedAt: null,
          retrievedAt: "2026-05-09",
          snippet: "snippet",
        },
      ],
      facts: [
        {
          canonicalAnswer: "answer",
          aliases: [],
          sourceIds: ["s1"],
          notes: null,
        },
      ],
      queryLog: [],
      latencyMs: 5000,
      error: "timeout",
    };

    const formatted = JSON.parse(formatCategoryEvidencePacketForJudge(packet));
    expect(formatted.status).toBe("retrieval_failed");
    expect(formatted.sources).toBeUndefined();
    expect(formatted.facts).toEqual([]);
  });
});
