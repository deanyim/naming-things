import type {
  CanonicalEntry,
  CategorySpec,
  ExtractedRecord,
  ValidationResult,
} from "../types";
import { normalizeMatchText } from "./extractor";

const KNOWN_EXAMPLES: Record<string, string[]> = {
  "survivor-us-contestants": [
    "Richard Hatch",
    "Sandra Diaz-Twine",
    "Parvati Shallow",
    "Rob Mariano",
  ],
};

export function validateDataset(
  spec: CategorySpec,
  rawRecords: ExtractedRecord[],
  entries: CanonicalEntry[],
  duplicateCount: number,
  extractionWarnings: string[] = [],
): ValidationResult {
  const warnings = [...extractionWarnings];
  const emptyAnswerCount = rawRecords.filter(
    (record) => !record.rawAnswer.trim(),
  ).length;
  const suspiciousAnswers = entries.filter(
    (entry) => entry.canonical.length < 2 || entry.canonical.length > 120,
  );
  const knownExamples = KNOWN_EXAMPLES[spec.id] ?? [];
  const entryKeys = new Set(entries.flatMap((entry) => entry.matchKeys));
  const knownExamplesFound = knownExamples.filter((example) =>
    entryKeys.has(normalizeMatchText(example)),
  );
  const knownExamplesMissing = knownExamples.filter(
    (example) => !knownExamplesFound.includes(example),
  );

  if (rawRecords.length === 0) warnings.push("No raw records extracted.");
  if (entries.length === 0) warnings.push("No canonical records produced.");
  if (emptyAnswerCount > 0) {
    warnings.push(`${emptyAnswerCount} empty answers were extracted.`);
  }
  if (suspiciousAnswers.length > 0) {
    warnings.push(`${suspiciousAnswers.length} suspicious answer lengths found.`);
  }
  if (knownExamples.length > 0 && knownExamplesMissing.length > 0) {
    warnings.push(
      `Known examples missing: ${knownExamplesMissing.join(", ")}.`,
    );
  }

  return {
    ok: entries.length > 0 && rawRecords.length > 0,
    warnings,
    rawRecordCount: rawRecords.length,
    canonicalRecordCount: entries.length,
    duplicateCount,
    knownExamplesFound,
    knownExamplesMissing,
  };
}
