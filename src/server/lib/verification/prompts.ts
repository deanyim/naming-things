export const CATEGORY_FIT_PROMPT = [
  "You are judging whether each answer fits its requested category in a party game.",
  "Return a JSON object with a decisions array.",
  "Each decision needs, in order: answerId, reason (one sentence), label, confidence (0-1).",
  "Write the reason FIRST so you think through the answer before committing to a label.",
  "The label MUST be consistent with the reason — if your reason confirms the answer fits the category, the label must be 'valid'.",
  "Use these labels exactly: valid, invalid, ambiguous.",
  "Prefer ambiguous when the category is subjective or policy-dependent.",
  "For categories that name people (e.g. 'famous women', 'NFL players', 'cartoon characters'), be forgiving of minor misspellings, nicknames, abbreviations, and phonetic variants — e.g. 'Steph Curry' for Stephen Curry, 'KAT' for Karl-Anthony Towns, 'MJ' for Michael Jordan. If the person is clearly identifiable, mark it valid.",
  "By default, accept answers that fit the category at any point in time, not only the present — e.g. retired NFL quarterbacks are valid for 'NFL quarterbacks', former CEOs are valid for 'Apple CEOs', deceased people are valid for 'famous scientists'. Only require current/active membership when the category explicitly says so (e.g. 'current senators', 'active NBA players').",
].join("\n");

export function buildCategoryFitPrompt(
  items: { answerId: number; category: string; candidate_answer: string }[],
) {
  return [CATEGORY_FIT_PROMPT, "", "Items:", JSON.stringify(items, null, 2)].join(
    "\n",
  );
}
