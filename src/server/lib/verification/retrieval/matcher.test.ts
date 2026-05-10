import { describe, expect, it } from "vitest";
import { buildDatasetLookupHint, judgeAnswerWithDataset } from "./matcher";
import type { CategoryEvidencePacket } from "../types";
import { mergeEvidenceFacts } from "./packets";

function packet(): CategoryEvidencePacket {
  return {
    id: "cep_test",
    category: "Survivor contestants",
    normalizedCategory: "survivor contestants",
    kind: "canonical_dataset",
    status: "ready",
    createdAt: "2026-05-09T00:00:00.000Z",
    retrievedAt: "2026-05-09T00:00:00.000Z",
    expiresAt: null,
    model: "test",
    searchProvider: "openrouter:web_search",
    sources: [],
    facts: [
      {
        canonicalAnswer: 'Robert "Rob" Mariano',
        aliases: ["Boston Rob"],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ['robert rob mariano'],
        metadata: { datasetConfidence: "high" },
      },
      {
        canonicalAnswer: "Parvati Shallow",
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["parvati shallow"],
        metadata: { datasetConfidence: "high" },
      },
    ],
    queryLog: [],
    latencyMs: 1,
    error: null,
  };
}

describe("judgeAnswerWithDataset", () => {
  it("matches canonical and alias answers", () => {
    expect(judgeAnswerWithDataset(packet(), "Rob Mariano")).toMatchObject({
      status: "valid",
      canonical: 'Robert "Rob" Mariano',
    });
    expect(judgeAnswerWithDataset(packet(), "Boston Rob")).toMatchObject({
      status: "valid",
      canonical: 'Robert "Rob" Mariano',
    });
  });

  it("allows conservative fuzzy matches", () => {
    expect(judgeAnswerWithDataset(packet(), "Parvati Shalow")).toMatchObject({
      status: "valid",
      canonical: "Parvati Shallow",
    });
  });

  it("rejects unmatched answers only for high-confidence datasets", () => {
    expect(judgeAnswerWithDataset(packet(), "Dan Gheesling")).toMatchObject({
      status: "invalid",
    });
  });

  it("returns needs_lookup when weak candidates should go to the LLM shortlist", () => {
    expect(judgeAnswerWithDataset(packet(), "parvti")).toMatchObject({
      status: "needs_lookup",
    });
    expect(buildDatasetLookupHint(packet(), "parvti")).toMatchObject({
      candidates: [{ canonical: "Parvati Shallow" }],
    });
  });

  it("accepts unique token-prefix answers", () => {
    expect(judgeAnswerWithDataset(packet(), "parvati")).toMatchObject({
      status: "valid",
      canonical: "Parvati Shallow",
    });
  });

  it("marks prefix matches ambiguous when multiple entries fit", () => {
    const ambiguousPacket = packet();
    ambiguousPacket.facts.push({
      canonicalAnswer: "Parvati Something",
      aliases: [],
      sourceIds: ["s1"],
      notes: null,
      matchKeys: ["parvati something"],
      metadata: { datasetConfidence: "high" },
    });

    expect(judgeAnswerWithDataset(ambiguousPacket, "parvati")).toMatchObject({
      status: "ambiguous",
    });
  });

  it("prefers exact nickname tokens over broader prefix matches", () => {
    const nicknamePacket = packet();
    nicknamePacket.facts = [
      {
        canonicalAnswer: "Deena Bennett",
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["deena bennett"],
        metadata: { datasetConfidence: "high" },
      },
      {
        canonicalAnswer: 'Dianelys "Dee" Valladares',
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["dianelys dee valladares"],
        metadata: { datasetConfidence: "high" },
      },
    ];

    expect(judgeAnswerWithDataset(nicknamePacket, "dee")).toMatchObject({
      status: "valid",
      canonical: 'Dianelys "Dee" Valladares',
    });
  });

  it("does not accept generic single-token prefixes", () => {
    const prefixPacket = packet();
    prefixPacket.facts = [
      {
        canonicalAnswer: "Deena Bennett",
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["deena bennett"],
        metadata: { datasetConfidence: "high" },
      },
    ];

    expect(judgeAnswerWithDataset(prefixPacket, "deen")).toMatchObject({
      status: "invalid",
    });
    expect(buildDatasetLookupHint(prefixPacket, "deen")).toBeNull();
  });

  it("still accepts multi-token prefix abbreviations", () => {
    const prefixPacket = packet();
    prefixPacket.facts = [
      {
        canonicalAnswer: "Sophie B. Hawkins",
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["sophie b hawkins"],
        metadata: { datasetConfidence: "high" },
      },
    ];

    expect(judgeAnswerWithDataset(prefixPacket, "sophi b")).toMatchObject({
      status: "valid",
      canonical: "Sophie B. Hawkins",
    });
  });

  it("accepts answers after duplicate facts are manually merged", () => {
    const mergePacket = packet();
    mergePacket.facts = [
      {
        canonicalAnswer: 'Kathleen "Kathy" Vavrick-O\'Brien',
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["kathy vavrick o brien"],
        metadata: { datasetConfidence: "high" },
      },
      {
        canonicalAnswer: "Kathy Vavrick-O'Brien",
        aliases: [],
        sourceIds: ["s1"],
        notes: null,
        matchKeys: ["kathy vavrick o brien"],
        metadata: { datasetConfidence: "high" },
      },
    ];

    expect(judgeAnswerWithDataset(mergePacket, "kathy vavrick o'brien"))
      .toMatchObject({
        status: "ambiguous",
      });

    mergePacket.facts = mergeEvidenceFacts(mergePacket.facts, [0, 1], 0).facts;

    expect(judgeAnswerWithDataset(mergePacket, "kathy vavrick o'brien"))
      .toMatchObject({
        status: "valid",
        canonical: 'Kathleen "Kathy" Vavrick-O\'Brien',
      });
  });
});
