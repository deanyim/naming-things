import { randomUUID } from "crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { env } from "~/env";
import { type db as dbType } from "~/server/db";
import {
  categoryEvidencePackets,
  categoryJudgeRuns,
} from "~/server/db/schema";
import { type CategoryClassifierOptions, classifyCategoryForRetrieval } from "./policy";
import {
  buildDataset,
  datasetEntriesToEvidenceFacts,
  datasetSourcesToEvidenceSources,
  type DatasetBuilderOptions,
} from "./builder";
import { resolveCategorySpec } from "./category-resolver";
import type {
  CategoryEvidencePacket,
  CategoryRetrievalDecision,
  EvidenceFact,
  EvidenceSource,
} from "../types";

type DB = typeof dbType;
type PacketRow = typeof categoryEvidencePackets.$inferSelect;

const DEFAULT_RETRIEVAL_MODEL = "wikipedia-mediawiki";

export type CategoryPacketCacheOptions = DatasetBuilderOptions &
  CategoryClassifierOptions & {
    enabled?: boolean;
    forceRefresh?: boolean;
    debug?: boolean;
  };

export type CategoryPacketLookup = {
  decision: CategoryRetrievalDecision;
  packet: CategoryEvidencePacket | null;
};

function iso(date: Date) {
  return date.toISOString();
}

function makePacketId() {
  return `cep_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function makeJudgeRunId() {
  return `cjr_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function toPacket(row: PacketRow): CategoryEvidencePacket {
  return {
    id: row.id,
    category: row.category,
    normalizedCategory: row.normalizedCategory,
    kind: row.kind as CategoryEvidencePacket["kind"],
    status: row.status as CategoryEvidencePacket["status"],
    createdAt: iso(row.createdAt),
    retrievedAt: iso(row.retrievedAt),
    expiresAt: row.expiresAt ? iso(row.expiresAt) : null,
    model: row.model,
    searchProvider: row.searchProvider as CategoryEvidencePacket["searchProvider"],
    sources: row.sources as EvidenceSource[],
    facts: row.facts as EvidenceFact[],
    queryLog: row.queryLog,
    latencyMs: row.latencyMs,
    error: row.error,
  };
}

export function normalizeEvidenceSources(sources: EvidenceSource[]) {
  const urlIds = new Map<string, string>();
  const idMap = new Map<string, string>();
  const normalized: EvidenceSource[] = [];

  for (const source of sources) {
    const urlKey = source.url.trim();
    if (!urlKey) continue;

    const existingId = urlIds.get(urlKey);
    if (existingId) {
      idMap.set(source.id, existingId);
      idMap.set(urlKey, existingId);
      continue;
    }

    const nextId = `s${normalized.length + 1}`;
    urlIds.set(urlKey, nextId);
    idMap.set(source.id, nextId);
    idMap.set(urlKey, nextId);
    normalized.push({
      ...source,
      id: nextId,
      url: urlKey,
      title: source.title.trim() || urlKey,
      snippet: source.snippet.trim().slice(0, 500),
    });
  }

  return { sources: normalized, idMap };
}

export function normalizeEvidenceFacts(
  facts: EvidenceFact[],
  sourceIdMap = new Map<string, string>(),
) {
  const seen = new Set<string>();
  const normalized: EvidenceFact[] = [];

  for (const fact of facts) {
    const canonicalAnswer = fact.canonicalAnswer.trim();
    const key = canonicalAnswer.toLowerCase();
    if (!canonicalAnswer || seen.has(key)) continue;

    seen.add(key);
    const aliases = Array.from(
      new Set(
        (fact.aliases ?? [])
          .map((alias) => alias.trim())
          .filter(
            (alias) =>
              alias &&
              alias.toLowerCase() !== canonicalAnswer.toLowerCase(),
          ),
      ),
    );

    const sourceIds = Array.from(
      new Set(
        fact.sourceIds
          .map((id) => sourceIdMap.get(id) ?? id)
          .filter((id) => id.trim()),
      ),
    );

    normalized.push({
      ...fact,
      canonicalAnswer,
      aliases,
      sourceIds,
      notes: fact.notes?.trim() || null,
    });
  }

  return normalized;
}

export function formatCategoryEvidencePacketForJudge(
  packet: CategoryEvidencePacket,
) {
  const payload = {
    status: packet.status,
    category: packet.normalizedCategory,
    kind: packet.kind,
    facts:
      packet.status === "ready"
        ? packet.facts.map((f) => ({
            canonicalAnswer: f.canonicalAnswer,
            aliases: f.aliases ?? [],
            matchKeys: f.matchKeys ?? [],
            confidence: f.confidence ?? null,
          }))
        : [],
  };

  return JSON.stringify(payload);
}

export async function getLatestCategoryEvidencePacket(
  db: DB,
  normalizedCategory: string,
  options: { includeStale?: boolean; now?: Date } = {},
) {
  if (typeof db.select !== "function") return null;

  const now = options.now ?? new Date();
  const rows = await db
    .select()
    .from(categoryEvidencePackets)
    .where(
      options.includeStale
        ? eq(categoryEvidencePackets.normalizedCategory, normalizedCategory)
        : and(
            eq(categoryEvidencePackets.normalizedCategory, normalizedCategory),
            gt(categoryEvidencePackets.expiresAt, now),
          ),
    )
    .orderBy(desc(categoryEvidencePackets.createdAt))
    .limit(1);

  return rows[0] ? toPacket(rows[0]) : null;
}

export async function createCategoryEvidencePacket(
  db: DB,
  categoryOrDecision: string | CategoryRetrievalDecision,
  options: CategoryPacketCacheOptions = {},
) {
  const category =
    typeof categoryOrDecision === "string"
      ? categoryOrDecision
      : categoryOrDecision.category;
  const spec = resolveCategorySpec(category);
  if (!spec.buildable) {
    return null;
  }

  const now = new Date();
  let expiresAt: Date | null = null;
  const model = options.model ?? DEFAULT_RETRIEVAL_MODEL;

  let status: CategoryEvidencePacket["status"] = "retrieval_failed";
  let sources: EvidenceSource[] = [];
  let facts: EvidenceFact[] = [];
  let queryLog: string[] = [];
  let latencyMs: number | null = null;
  let error: string | null = null;
  let actualModel = model;

  try {
    const startedAt = Date.now();
    const dataset = await buildDataset(spec, {
      ...options,
      model,
    });
    expiresAt = dataset.staleAfter ? new Date(dataset.staleAfter) : null;
    const normalizedSources = normalizeEvidenceSources(
      datasetSourcesToEvidenceSources(dataset),
    );
    sources = normalizedSources.sources;
    facts = normalizeEvidenceFacts(
      datasetEntriesToEvidenceFacts(dataset),
      normalizedSources.idMap,
    );
    queryLog = [
      ...dataset.sources.map((source) => `fetch:${source.url}`),
      ...dataset.validation.warnings.map((warning) => `warning:${warning}`),
    ];
    latencyMs = Date.now() - startedAt;
    error =
      dataset.validation.warnings.length > 0
        ? dataset.validation.warnings.join(" | ").slice(0, 2048)
        : null;
    actualModel = model;
    status = sources.length > 0 && facts.length > 0 ? "ready" : "insufficient_evidence";
  } catch (err) {
    status = "retrieval_failed";
    error = err instanceof Error ? err.message : "Unknown retrieval error";
  }

  const id = makePacketId();
  const [inserted] = await db
    .insert(categoryEvidencePackets)
    .values({
      id,
      category: spec.rawCategory,
      normalizedCategory: spec.normalizedCategory,
      kind: "canonical_dataset",
      status,
      retrievedAt: now,
      expiresAt,
      model: actualModel,
      searchProvider: "wikipedia:mediawiki",
      sources,
      facts,
      queryLog,
      latencyMs,
      error,
    })
    .returning();

  return inserted ? toPacket(inserted) : null;
}

export async function getOrCreateCategoryEvidencePacket(
  db: DB,
  category: string,
  options: CategoryPacketCacheOptions = {},
): Promise<CategoryPacketLookup> {
  const enabled = options.enabled ?? env.RETRIEVAL_ENABLED;
  const decision = await classifyCategoryForRetrieval(category, options);

  if (!enabled || !decision.eligible) {
    return { decision, packet: null };
  }

  if (!options.forceRefresh) {
    const existing = await getLatestCategoryEvidencePacket(
      db,
      decision.normalizedCategory,
    );
    if (
      existing &&
      (existing.status === "ready" ||
        existing.status === "insufficient_evidence")
    ) {
      return { decision, packet: existing };
    }
  }

  const packet = await createCategoryEvidencePacket(db, decision, options);
  return { decision, packet };
}

export async function getExistingCategoryEvidencePacket(
  db: DB,
  category: string,
  options: { includeStale?: boolean; now?: Date } = {},
) {
  const spec = resolveCategorySpec(category);
  return getLatestCategoryEvidencePacket(db, spec.normalizedCategory, options);
}

export async function recordCategoryJudgeRun(
  db: DB,
  gameRoundId: string,
  categoryEvidencePacketId: string | null,
) {
  const id = makeJudgeRunId();
  const judgedAt = new Date();

  await db
    .insert(categoryJudgeRuns)
    .values({
      id,
      gameRoundId,
      categoryEvidencePacketId,
      judgedAt,
    });

  return {
    id,
    gameRoundId,
    categoryEvidencePacketId,
    judgedAt: iso(judgedAt),
  };
}
