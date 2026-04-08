import { z } from "zod";
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

export async function judgeCategoryFit(
  category: string,
  candidates: { answerId: number; text: string }[],
  options?: { model?: string; timeoutMs?: number },
): Promise<CategoryFitResult[]> {
  if (candidates.length === 0) return [];

  const items = candidates.map((c) => ({
    answerId: c.answerId,
    category,
    candidate_answer: c.text,
  }));

  const result = await callOpenRouterJson({
    model: options?.model,
    timeoutMs: options?.timeoutMs,
    maxOutputTokens: Math.max(512, candidates.length * 60),
    schema: categoryFitSchema,
    messages: [{ role: "user", content: buildCategoryFitPrompt(items) }],
  });

  return result.parsed.decisions;
}
