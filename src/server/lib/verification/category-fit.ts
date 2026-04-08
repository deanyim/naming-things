import { z } from "zod";
import { env } from "~/env";
import { callOpenRouterJson } from "../openrouter/client";
import { buildCategoryFitPrompt } from "./prompts";

const categoryFitSchema = z.object({
  decisions: z.array(
    z.object({
      answerId: z.number(),
      label: z.enum(["valid", "invalid", "ambiguous"]),
      confidence: z.number().min(0).max(1),
      reason: z.string().min(1),
    }),
  ),
});

export type CategoryFitResult = {
  answerId: number;
  label: "valid" | "invalid" | "ambiguous";
  confidence: number;
  reason: string;
};

const DEFAULT_CHUNK_SIZE = 25;

async function judgeChunk(
  items: { answerId: number; category: string; candidate_answer: string }[],
  options?: { model?: string; timeoutMs?: number },
): Promise<CategoryFitResult[]> {
  const result = await callOpenRouterJson({
    model: options?.model,
    timeoutMs: options?.timeoutMs,
    maxOutputTokens: Math.max(512, items.length * 60),
    schema: categoryFitSchema,
    messages: [{ role: "user", content: buildCategoryFitPrompt(items) }],
  });

  return result.parsed.decisions;
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
  options?: { model?: string; timeoutMs?: number; chunkSize?: number },
): Promise<CategoryFitResult[]> {
  if (candidates.length === 0) return [];
  if (env.OPENROUTER_MOCK) return mockJudge(candidates);

  const items = candidates.map((c) => ({
    answerId: c.answerId,
    category,
    candidate_answer: c.text,
  }));

  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;

  if (items.length <= chunkSize) {
    return judgeChunk(items, options);
  }

  const chunks: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  const results = await Promise.all(
    chunks.map((chunk) => judgeChunk(chunk, options)),
  );

  return results.flat();
}
