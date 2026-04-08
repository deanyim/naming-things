const articlePattern = /^(a|an|the)\s+/;
const punctuationPattern = /[!"'`.,/\\:;?()[\]{}]+/g;
const separatorPattern = /[-_]+/g;

export type NormalizationResult = {
  originalText: string;
  trimmedText: string;
  normalizedText: string;
  canonicalText: string;
  appliedRules: string[];
};

function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ses") || token.endsWith("xes")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function normalizeAnswer(text: string): NormalizationResult {
  const appliedRules: string[] = [];
  const originalText = text;
  const trimmedText = text.trim();

  let normalizedText = trimmedText.toLowerCase();
  if (normalizedText !== trimmedText) {
    appliedRules.push("lowercase");
  }

  const collapsedWhitespace = normalizedText.replace(/\s+/g, " ");
  if (collapsedWhitespace !== normalizedText) {
    appliedRules.push("collapse_whitespace");
    normalizedText = collapsedWhitespace;
  }

  const strippedArticles = normalizedText.replace(articlePattern, "");
  if (strippedArticles !== normalizedText) {
    appliedRules.push("strip_article");
    normalizedText = strippedArticles;
  }

  const normalizedSeparators = normalizedText.replace(separatorPattern, " ");
  if (normalizedSeparators !== normalizedText) {
    appliedRules.push("normalize_separator");
    normalizedText = normalizedSeparators;
  }

  const normalizedPunctuation = normalizedText.replace(punctuationPattern, " ");
  if (normalizedPunctuation !== normalizedText) {
    appliedRules.push("normalize_punctuation");
    normalizedText = normalizedPunctuation.replace(/\s+/g, " ").trim();
  }

  let canonicalText = normalizedText;

  const singularized = canonicalText
    .split(" ")
    .filter(Boolean)
    .map((token) => singularizeToken(token))
    .join(" ");
  if (singularized !== canonicalText) {
    appliedRules.push("conservative_singularize");
    canonicalText = singularized;
  }

  return {
    originalText,
    trimmedText,
    normalizedText,
    canonicalText,
    appliedRules,
  };
}

export function normalizeAnswerText(text: string): NormalizationResult {
  return normalizeAnswer(text);
}
