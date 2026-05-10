import { z } from "zod";

export const openRouterMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export type OpenRouterMessage = z.infer<typeof openRouterMessageSchema>;

export const openRouterJsonResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
      server_tool_use: z
        .object({
          web_search_requests: z.number().int().nonnegative().optional(),
        })
        .passthrough()
        .optional(),
    })
    .optional(),
});

export type OpenRouterJsonResponse = z.infer<typeof openRouterJsonResponseSchema>;

export type RetrievalCategoryKind =
  | "official_roster"
  | "canonical_media_metadata"
  | "public_result"
  | "public_schedule"
  | "release_version"
  | "government_or_legal"
  | "public_company_fact"
  | "business_listing"
  | "private_trait"
  | "rumor"
  | "subjective_preference"
  | "low_indexability_biographical_detail"
  | "sensitive_personal_attribute"
  | "unknown";

export type RetrievalEligibleCategoryKind = Extract<
  RetrievalCategoryKind,
  "official_roster" | "canonical_media_metadata" | "public_result"
>;

export type CanonicalEntityType =
  | "person"
  | "place"
  | "song"
  | "movie"
  | "team"
  | "country"
  | "other";

export type CategorySpec = {
  id: string;
  rawCategory: string;
  normalizedCategory: string;
  buildable: boolean;
  notBuildableReason?: string;
  entityType: CanonicalEntityType;
  unit: "entity" | "appearance" | "event";
  knownSourceUrls?: string[];
  freshness: "static" | "seasonal" | "daily" | "unknown";
};

export type CategoryEvidenceStatus =
  | "ready"
  | "insufficient_evidence"
  | "not_retrieval_eligible"
  | "retrieval_failed";

export type CategoryRetrievalDecision = {
  category: string;
  normalizedCategory: string;
  kind: RetrievalCategoryKind;
  eligible: boolean;
  reason: string;
};

export type EvidenceSource = {
  id: string;
  url: string;
  title: string;
  sourceType:
    | "official"
    | "primary"
    | "structured_database"
    | "reputable_secondary"
    | "community"
    | "unknown";
  publishedAt: string | null;
  retrievedAt: string;
  snippet: string;
  retrievedAtIso?: string;
  contentHash?: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
};

export type SourceSnapshot = {
  url: string;
  retrievedAt: string;
  contentHash: string;
  contentType: string;
  rawContent?: string;
  normalizedContent?: string;
  metadata?: Record<string, unknown>;
};

export type ExtractedRecord = {
  rawAnswer: string;
  canonicalCandidate: string;
  entityType: string;
  metadata: Record<string, unknown>;
  sourcePointer: {
    url: string;
    blockType: "table" | "list" | "text" | "api";
    blockId: string;
    rowIndex?: number;
    columnName?: string;
    rawValue?: string;
  };
  confidence: number;
};

export type Alias = {
  value: string;
  normalized: string;
  source: "canonical" | "source" | "redirect" | "generated" | "manual";
  confidence: number;
  ambiguous?: boolean;
};

export type CanonicalEntry = {
  canonical: string;
  entityType: string;
  matchKeys: string[];
  aliases: Alias[];
  metadata: Record<string, unknown>;
  sourceEntries: ExtractedRecord[];
  confidence: number;
};

export type ValidationResult = {
  ok: boolean;
  warnings: string[];
  rawRecordCount: number;
  canonicalRecordCount: number;
  duplicateCount: number;
  knownExamplesFound: string[];
  knownExamplesMissing: string[];
};

export type CanonicalDataset = {
  id: string;
  categorySpec: CategorySpec;
  version: string;
  builtAt: string;
  staleAfter?: string;
  sources: SourceSnapshot[];
  entries: CanonicalEntry[];
  validation: ValidationResult;
  confidence: "high" | "medium" | "low";
};

export type EvidenceFact = {
  canonicalAnswer: string;
  aliases: string[];
  sourceIds: string[];
  notes: string | null;
  matchKeys?: string[];
  metadata?: Record<string, unknown>;
  sourceEntries?: ExtractedRecord[];
  confidence?: number;
};

export type CategoryEvidencePacket = {
  id: string;
  category: string;
  normalizedCategory: string;
  kind: RetrievalEligibleCategoryKind | "canonical_dataset";
  status: CategoryEvidenceStatus;
  createdAt: string;
  retrievedAt: string;
  expiresAt: string | null;
  model: string;
  searchProvider: "wikipedia:mediawiki" | "openrouter:web_search";
  sources: EvidenceSource[];
  facts: EvidenceFact[];
  queryLog: string[];
  latencyMs: number | null;
  error: string | null;
};

export type CategoryJudgeRun = {
  id: string;
  gameRoundId: string;
  categoryEvidencePacketId: string | null;
  judgedAt: string;
};
