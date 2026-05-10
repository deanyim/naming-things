import { randomUUID } from "crypto";
import type {
  CanonicalDataset,
  CategorySpec,
  EvidenceFact,
  EvidenceSource,
  ExtractedRecord,
  SourceSnapshot,
} from "../types";
import { canonicalizeRecords } from "./canonicalizer";
import {
  extractRecordsFromSource,
  type ExtractionOptions,
} from "./extractor";
import { FetchSourceFetcher, type SourceFetcher } from "./source-fetcher";
import { validateDataset } from "./validator";
import { discoverWikipediaSources } from "./wikipedia-source-discovery";

export type DatasetBuilderOptions = {
  fetcher?: SourceFetcher;
  sourceUrl?: string;
  sourceUrls?: string[];
  discoveredSourceUrl?: string;
  model?: string;
  timeoutMs?: number;
} & ExtractionOptions;

function staleAfterFor(spec: CategorySpec, builtAt: Date) {
  const days =
    spec.freshness === "static"
      ? 365
      : spec.freshness === "daily"
        ? 1
        : 30;
  return new Date(builtAt.getTime() + days * 24 * 60 * 60 * 1000);
}

function datasetId(spec: CategorySpec) {
  return `cds_${spec.id}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function resolveSourceUrls(
  spec: CategorySpec,
  options: DatasetBuilderOptions,
) {
  if (options.sourceUrls?.length) return options.sourceUrls;
  if (options.sourceUrl) return [options.sourceUrl];
  if (options.discoveredSourceUrl) return [options.discoveredSourceUrl];
  if (spec.knownSourceUrls?.length) return spec.knownSourceUrls;
  if (spec.buildable) {
    const discovery = await discoverWikipediaSources(spec, {
      maxCandidatesToEvaluate: 5,
    });
    return discovery.sources.map((source) => source.url).slice(0, 1);
  }
  return [];
}

export async function buildDataset(
  spec: CategorySpec,
  options: DatasetBuilderOptions = {},
): Promise<CanonicalDataset> {
  const fetcher = options.fetcher ?? new FetchSourceFetcher();
  const sourceUrls = await resolveSourceUrls(spec, options);
  const snapshots: SourceSnapshot[] = [];
  const rawRecords: ExtractedRecord[] = [];
  const warnings: string[] = [];

  if (sourceUrls.length === 0) {
    warnings.push("No source URL available for dataset build.");
  }

  for (const url of sourceUrls.slice(0, 5)) {
    try {
      const snapshot = await fetcher.fetch(url);
      snapshots.push(snapshot);
      const extracted = extractRecordsFromSource(spec, snapshot, {
        includeBlockIds: options.includeBlockIds,
        excludeBlockIds: options.excludeBlockIds,
      });
      rawRecords.push(...extracted.records);
      warnings.push(...extracted.warnings);
    } catch (err) {
      warnings.push(
        `Failed to fetch source ${url}: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    }
  }

  const { entries, duplicateCount } = canonicalizeRecords(spec, rawRecords);
  const validation = validateDataset(
    spec,
    rawRecords,
    entries,
    duplicateCount,
    warnings,
  );
  const confidence =
    validation.ok && validation.knownExamplesMissing.length === 0
      ? "high"
      : validation.ok
        ? "medium"
        : "low";
  const builtAt = new Date();

  return {
    id: datasetId(spec),
    categorySpec: spec,
    version: "dataset-v1",
    builtAt: builtAt.toISOString(),
    staleAfter: staleAfterFor(spec, builtAt).toISOString(),
    sources: snapshots,
    entries,
    validation,
    confidence,
  };
}

export function datasetSourcesToEvidenceSources(
  dataset: CanonicalDataset,
): EvidenceSource[] {
  const metadataTitle = (metadata: Record<string, unknown> | undefined) =>
    typeof metadata?.title === "string" ? metadata.title : null;

  return dataset.sources.map((source, index) => ({
    id: `s${index + 1}`,
    url: source.url,
    title: metadataTitle(source.metadata) ?? source.url,
    sourceType: "structured_database",
    publishedAt: null,
    retrievedAt: source.retrievedAt,
    snippet: `${source.contentType}; sha256=${source.contentHash.slice(0, 16)}`,
    retrievedAtIso: source.retrievedAt,
    contentHash: source.contentHash,
    contentType: source.contentType,
    metadata: source.metadata,
  }));
}

export function datasetEntriesToEvidenceFacts(
  dataset: CanonicalDataset,
): EvidenceFact[] {
  return dataset.entries.map((entry) => ({
    canonicalAnswer: entry.canonical,
    aliases: entry.aliases
      .filter((alias) => alias.source !== "canonical")
      .map((alias) => alias.value),
    sourceIds: Array.from(
      new Set(
        entry.sourceEntries.map((sourceEntry) => sourceEntry.sourcePointer.url),
      ),
    ),
    notes: null,
    matchKeys: entry.matchKeys,
    metadata: {
      datasetId: dataset.id,
      datasetVersion: dataset.version,
      datasetConfidence: dataset.confidence,
      categorySpec: dataset.categorySpec,
      canonicalEntry: entry,
    },
    sourceEntries: entry.sourceEntries,
    confidence: entry.confidence,
  }));
}
