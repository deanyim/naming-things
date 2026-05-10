import type {
  Alias,
  CanonicalEntry,
  CategorySpec,
  ExtractedRecord,
} from "../types";
import { cleanExtractedValue, normalizeMatchText } from "./extractor";

const MANUAL_ALIASES: Record<string, string[]> = {
  "rob mariano": ["Boston Rob"],
  "jon dalton": ["Johnny Fairplay", "Jonny Fairplay"],
  "john dalton": ["Johnny Fairplay", "Jonny Fairplay"],
};

function makeAlias(
  value: string,
  source: Alias["source"],
  confidence: number,
): Alias {
  return {
    value,
    normalized: normalizeMatchText(value),
    source,
    confidence,
  };
}

function mergeMetadata(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  return { ...left, ...right };
}

function dedupeKey(spec: CategorySpec, record: ExtractedRecord) {
  if (spec.unit !== "entity") {
    return `${normalizeMatchText(record.canonicalCandidate)}:${record.sourcePointer.blockId}:${record.sourcePointer.rowIndex ?? ""}`;
  }

  const entityIds = record.metadata.entityIds as
    | { wikipediaPath?: string }
    | undefined;
  if (entityIds?.wikipediaPath) {
    return `wiki:${entityIds.wikipediaPath.toLowerCase()}`;
  }

  const sourceLink = typeof record.metadata.sourceLink === "string"
    ? record.metadata.sourceLink
    : null;
  if (sourceLink) return `link:${sourceLink.toLowerCase()}`;

  return normalizeMatchText(record.canonicalCandidate);
}

export function canonicalizeRecords(
  spec: CategorySpec,
  records: ExtractedRecord[],
) {
  const entriesByKey = new Map<string, CanonicalEntry>();
  let duplicateCount = 0;

  for (const record of records) {
    const canonical = cleanExtractedValue(record.canonicalCandidate);
    const normalizedCanonical = normalizeMatchText(canonical);
    if (!canonical || !normalizedCanonical) continue;

    const key = dedupeKey(spec, record);
    const existing = entriesByKey.get(key);
    if (existing) {
      duplicateCount++;
      existing.sourceEntries.push(record);
      existing.metadata = mergeMetadata(existing.metadata, record.metadata);
      existing.confidence = Math.max(existing.confidence, record.confidence);
      continue;
    }

    const aliases = [makeAlias(canonical, "canonical", 1)];
    for (const manualAlias of MANUAL_ALIASES[normalizedCanonical] ?? []) {
      aliases.push(makeAlias(manualAlias, "manual", 0.95));
    }

    entriesByKey.set(key, {
      canonical,
      entityType: spec.entityType,
      matchKeys: Array.from(new Set([normalizedCanonical])),
      aliases: aliases.filter((alias) => alias.normalized),
      metadata: record.metadata,
      sourceEntries: [record],
      confidence: record.confidence,
    });
  }

  return {
    entries: Array.from(entriesByKey.values()),
    duplicateCount,
  };
}

