import { z } from "zod";
import { env } from "~/env";
import { callOpenRouterJson, type JsonSchemaSpec } from "../openrouter/client";
import { buildCategoryFitPrompt } from "./prompts";
import type { CategoryEvidencePacket } from "./types";
import {
  buildDatasetLookupHint,
  judgeAnswerWithDataset,
  type DatasetLookupHint,
} from "./retrieval/matcher";

const categoryFitSchema = z.object({
  decisions: z.array(
    z.object({
      answerId: z.number(),
      reason: z.string().min(1),
      label: z.enum(["valid", "invalid", "ambiguous"]),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const categoryFitJsonSchema: JsonSchemaSpec = {
  name: "category_fit",
  schema: {
    type: "object",
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            answerId: { type: "number" },
            reason: { type: "string" },
            label: { type: "string", enum: ["valid", "invalid", "ambiguous"] },
            confidence: { type: "number" },
          },
          required: ["answerId", "reason", "label", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["decisions"],
    additionalProperties: false,
  },
};

export type CategoryFitResult = {
  answerId: number;
  label: "valid" | "invalid" | "ambiguous";
  confidence: number;
  reason: string;
};

const DEFAULT_CHUNK_SIZE = 25;

export type JudgeCategoryFitOptions = {
  model?: string;
  timeoutMs?: number;
  chunkSize?: number;
  retrieval?: {
    enabled: boolean;
    model?: string;
    forceRefresh?: boolean;
    maxResultsPerSearch?: number;
    maxTotalResults?: number;
    evidencePacket?: CategoryEvidencePacket | null;
  };
};

async function judgeChunk(
  items: { answerId: number; category: string; candidate_answer: string }[],
  options?: JudgeCategoryFitOptions,
  lookupHints?: Map<number, DatasetLookupHint>,
): Promise<CategoryFitResult[]> {
  const evidencePacket =
    options?.retrieval?.enabled === true
      ? options.retrieval.evidencePacket
      : null;
  const result = await callOpenRouterJson({
    model: options?.model,
    timeoutMs: options?.timeoutMs,
    maxOutputTokens: Math.max(512, items.length * 80),
    schema: categoryFitSchema,
    jsonSchema: categoryFitJsonSchema,
    messages: [
      {
        role: "user",
        content: buildCategoryFitPrompt(
          items,
          evidencePacket,
          lookupHints
            ? Object.fromEntries(
                items
                  .map((item) => [item.answerId, lookupHints.get(item.answerId)] as const)
                  .filter((entry): entry is [number, DatasetLookupHint] => !!entry[1]),
              )
            : undefined,
        ),
      },
    ],
  });

  const decisions = result.parsed.decisions;
  const requestedIds = new Set(items.map((item) => item.answerId));
  const returnedIds = new Set(decisions.map((decision) => decision.answerId));
  const missingIds = items
    .map((item) => item.answerId)
    .filter((answerId) => !returnedIds.has(answerId));
  const unexpectedIds = decisions
    .map((decision) => decision.answerId)
    .filter((answerId) => !requestedIds.has(answerId));

  if (missingIds.length > 0 || unexpectedIds.length > 0) {
    console.error("Category fit response did not match requested answers", {
      model: result.model,
      requestId: result.requestId,
      requestedCount: items.length,
      returnedCount: decisions.length,
      missingIds,
      unexpectedIds,
      rawText: result.rawText,
    });
  }

  return decisions;
}

function mockJudge(
  candidates: { answerId: number; text: string }[],
): CategoryFitResult[] {
  return candidates.map((c) => ({
    answerId: c.answerId,
    label: c.text.toLowerCase().includes("zzinvalid")
      ? ("invalid" as const)
      : ("valid" as const),
    confidence: 0.95,
    reason: "mock",
  }));
}

export async function judgeCategoryFit(
  category: string,
  candidates: { answerId: number; text: string }[],
  options?: JudgeCategoryFitOptions,
): Promise<CategoryFitResult[]> {
  if (candidates.length === 0) return [];
  if (env.OPENROUTER_MOCK) return mockJudge(candidates);

  const evidencePacket =
    options?.retrieval?.enabled === true
      ? options.retrieval.evidencePacket
      : null;
  const datasetResults = new Map<number, CategoryFitResult>();
  const lookupHints = new Map<number, DatasetLookupHint>();
  const needsLookup: { answerId: number; text: string }[] = [];

  if (evidencePacket?.status === "ready") {
    for (const candidate of candidates) {
      const judgment = judgeAnswerWithDataset(evidencePacket, candidate.text);
      if (judgment.status === "needs_lookup") {
        const hint = buildDatasetLookupHint(evidencePacket, candidate.text);
        if (hint) lookupHints.set(candidate.answerId, hint);
        needsLookup.push(candidate);
        continue;
      }

      datasetResults.set(candidate.answerId, {
        answerId: candidate.answerId,
        label:
          judgment.status === "valid"
            ? "valid"
            : judgment.status === "invalid"
              ? "invalid"
              : "ambiguous",
        confidence: judgment.confidence,
        reason: judgment.explanation,
      });
    }

    if (needsLookup.length === 0) {
      return candidates.map((candidate) => datasetResults.get(candidate.answerId)!);
    }
  }

  const candidatesForLlm = evidencePacket?.status === "ready" ? needsLookup : candidates;
  const items = candidatesForLlm.map((c) => ({
    answerId: c.answerId,
    category,
    candidate_answer: c.text,
  }));

  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;

  if (items.length <= chunkSize) {
    const llmResults = await judgeChunk(items, options, lookupHints);
    return candidates.map((candidate) => {
      const datasetResult = datasetResults.get(candidate.answerId);
      if (datasetResult) return datasetResult;
      return llmResults.find((result) => result.answerId === candidate.answerId)!;
    });
  }

  const chunks: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  const results = await Promise.all(
    chunks.map((chunk) => judgeChunk(chunk, options, lookupHints)),
  );

  const llmResults = results.flat();
  return candidates.map((candidate) => {
    const datasetResult = datasetResults.get(candidate.answerId);
    if (datasetResult) return datasetResult;
    return llmResults.find((result) => result.answerId === candidate.answerId)!;
  });
}
