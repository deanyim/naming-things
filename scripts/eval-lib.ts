import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type EvalTask =
  | "category_fit"
  | "retrieval_policy"
  | "retrieval_category_classifier"
  | "retrieval_packet_judging"
  | "retrieval_live_smoke";

export type EvalCase = {
  id: string;
  task: EvalTask;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  input: Record<string, unknown>;
  expected: { label: string };
  notes?: string;
};

export type ModelConfig = {
  id: string;
  provider: "local" | "openrouter";
  model: string;
  enabled: boolean;
  inputCostUsdPerM?: number;
  outputCostUsdPerM?: number;
};

export type EvalOutput = {
  label: string;
  confidence?: number;
  reason?: string;
};

export type EvalResultRow = {
  caseId: string;
  task: EvalTask;
  modelId: string;
  status: "ok" | "skipped" | "error";
  expectedLabel: string;
  actualLabel: string | null;
  parseOk: boolean;
  rawText: string;
  skipReason?: string;
  error?: string;
};

export type EvalBatchMetrics = {
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
};

export const DEFAULT_CHUNK_SIZE = 25;

export type EvalRunOutput = {
  task: EvalTask;
  modelId: string;
  chunkSize: number;
  batches: EvalBatchMetrics[];
  cases: EvalResultRow[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, "..");
export const evalRoot = path.join(repoRoot, "evals");

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function writeJsonl(filePath: string, rows: unknown[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(filePath, body, "utf8");
}

export async function loadCases(task: EvalTask): Promise<EvalCase[]> {
  return readJsonl<EvalCase>(path.join(evalRoot, "cases", `${task}.jsonl`));
}

export async function loadModelsConfig(): Promise<ModelConfig[]> {
  const raw = await readFile(path.join(evalRoot, "config", "models.json"), "utf8");
  return JSON.parse(raw) as ModelConfig[];
}

export function normalizeText(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[-_]+/g, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isJunk(text: string) {
  const normalized = normalizeText(text);
  return (
    !normalized ||
    normalized === "n a" ||
    normalized === "na" ||
    /^[\W_]+$/.test(text) ||
    /^x+$/.test(normalized) ||
    normalized.length < 2
  );
}

const RETRIEVAL_ELIGIBLE_KINDS = new Set([
  "official_roster",
  "canonical_media_metadata",
  "public_result",
]);

function classifyRetrievalCategory(category: string) {
  const text = ` ${normalizeText(category)} `;

  if (/\b(latest|current|newest)\b.*\b(version|versions|release|releases)\b/.test(text)) {
    return "release_version";
  }
  if (/\b(schedule|fixture|fixtures|upcoming|tour dates?|calendar)\b/.test(text)) {
    return "public_schedule";
  }
  if (/\b(law|laws|legal|regulation|regulations|statute|court|tax code)\b/.test(text)) {
    return "government_or_legal";
  }
  if (/\b(ceo|cfo|cto|stock price|market cap|revenue|earnings|employees)\b/.test(text)) {
    return "public_company_fact";
  }
  if (/\b(restaurants?|bars?|coffee shops?|businesses?|stores?|near me|open now|address|phone)\b/.test(text)) {
    return "business_listing";
  }
  if (/\b(rumou?rs?|alleged|gossip|dating|secretly)\b/.test(text)) {
    return "rumor";
  }
  if (/\b(best|favorite|favourite|worst|coolest|prettiest|most fun)\b/.test(text)) {
    return "subjective_preference";
  }
  if (/\b(age|religion|ethnicity|race|health|medical|disability|sexual orientation|political affiliation)\b/.test(text)) {
    return "sensitive_personal_attribute";
  }
  if (/\b(left handed|right handed|height|hometown|middle name|siblings?|spouse|married|birthday)\b/.test(text)) {
    return "low_indexability_biographical_detail";
  }
  if (/\b(winners?|losers?|results?|scores?|champions?|final standings|eliminated|elimination|won|winner)\b/.test(text)) {
    return "public_result";
  }
  if (/\b(episodes?|season|seasons|movies?|films?|directed by|written by|starring|cast of|credits?|release dates?)\b/.test(text)) {
    return "canonical_media_metadata";
  }
  if (/\b(roster|squad|lineup|cast list|contestants?|players?|senators?|representatives?|board members?|cabinet members?)\b/.test(text)) {
    return "official_roster";
  }
  return "unknown";
}

function runRetrievalPacketBaseline(caseData: EvalCase): EvalOutput {
  const candidate = normalizeText(String(caseData.input.candidate_answer ?? ""));
  const packet = caseData.input.evidencePacket as
    | {
        status?: string;
        facts?: Array<{ canonicalAnswer?: string; aliases?: string[] }>;
      }
    | undefined;

  if (!packet || packet.status !== "ready") {
    return {
      label: "ambiguous",
      confidence: 0.4,
      reason: "packet is missing or not ready",
    };
  }

  for (const fact of packet.facts ?? []) {
    const names = [fact.canonicalAnswer, ...(fact.aliases ?? [])]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeText);
    if (names.includes(candidate)) {
      return {
        label: "valid",
        confidence: 0.95,
        reason: "candidate appears in the mocked evidence packet",
      };
    }
  }

  return {
    label: "invalid",
    confidence: 0.75,
    reason: "ready packet does not contain the candidate",
  };
}

export function runLocalBaseline(caseData: EvalCase): EvalOutput {
  if (caseData.task === "retrieval_policy") {
    const kind = String(caseData.input.kind ?? classifyRetrievalCategory(caseData.category));
    const eligible = RETRIEVAL_ELIGIBLE_KINDS.has(kind);
    return {
      label: eligible ? "eligible" : "ineligible",
      confidence: 1,
      reason: eligible ? "kind is allowlisted" : "kind is excluded",
    };
  }

  if (caseData.task === "retrieval_category_classifier") {
    const kind = classifyRetrievalCategory(caseData.category);
    return {
      label: kind,
      confidence: 0.8,
      reason: "local heuristic category classifier",
    };
  }

  if (caseData.task === "retrieval_packet_judging") {
    return runRetrievalPacketBaseline(caseData);
  }

  if (caseData.task === "retrieval_live_smoke") {
    return {
      label: "skipped",
      confidence: 0,
      reason: "live retrieval smoke cases are disabled in the local baseline",
    };
  }

  const { input } = caseData;
  const candidate = String(input.candidate_answer ?? "");
  const category = normalizeText(caseData.category);
  const candidateNorm = normalizeText(candidate);

  if (isJunk(candidate)) {
    return { label: "invalid", confidence: 0.95, reason: "candidate is empty or junk" };
  }

  if (candidateNorm === category || candidateNorm.includes(category)) {
    return { label: "valid", confidence: 0.8, reason: "candidate matches category text" };
  }

  if (candidateNorm.includes("unknown") || candidateNorm.includes("none")) {
    return { label: "invalid", confidence: 0.9, reason: "candidate is a placeholder" };
  }

  return { label: "ambiguous", confidence: 0.35, reason: "baseline does not have enough category knowledge" };
}

export function estimateCostUsd(model: ModelConfig, inputTokens?: number, outputTokens?: number) {
  if (!inputTokens || !outputTokens) return undefined;
  const inputCost = (inputTokens / 1_000_000) * (model.inputCostUsdPerM ?? 0);
  const outputCost = (outputTokens / 1_000_000) * (model.outputCostUsdPerM ?? 0);
  return inputCost + outputCost;
}

/** Parse a { decisions: [{ answerId, label, ... }] } response, keyed by answerId */
export function parseBatchResponse(rawText: string): Map<number, EvalOutput> {
  const results = new Map<number, EvalOutput>();
  const trimmed = rawText.trim().replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(trimmed) as {
      decisions?: { answerId?: number; label?: string; confidence?: number; reason?: string }[];
    };
    const decisions = parsed?.decisions;
    if (Array.isArray(decisions)) {
      for (const item of decisions) {
        if (typeof item.answerId === "number" && typeof item.label === "string") {
          results.set(item.answerId, {
            label: item.label,
            confidence: typeof item.confidence === "number" ? item.confidence : undefined,
            reason: typeof item.reason === "string" ? item.reason : undefined,
          });
        }
      }
    }
  } catch {
    // Try extracting JSON from markdown fences or surrounding text
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return parseBatchResponse(trimmed.slice(start, end + 1));
    }
  }

  return results;
}
