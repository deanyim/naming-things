export const CATEGORY_FIT_PROMPT = [
  "You are judging whether each answer fits its requested category in a party game.",
  "Return a JSON object with a decisions array.",
  "Each decision needs, in order: answerId, reason (one sentence), label, confidence (0-1).",
  "Write the reason FIRST so you think through the answer before committing to a label.",
  "The label MUST be consistent with the reason — if your reason confirms the answer fits the category, the label must be 'valid'.",
  "Use these labels exactly: valid, invalid, ambiguous.",
  "Prefer ambiguous when the category is subjective or policy-dependent.",
  "For categories that name people (e.g. 'famous women', 'NFL players', 'cartoon characters'), be forgiving of minor misspellings and accept close phonetic variants as valid.",
].join("\n");

export function buildCategoryFitPrompt(
  items: { answerId: number; category: string; candidate_answer: string }[],
) {
  return [CATEGORY_FIT_PROMPT, "", "Items:", JSON.stringify(items, null, 2)].join(
    "\n",
  );
}
