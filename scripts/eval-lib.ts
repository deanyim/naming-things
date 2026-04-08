import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type EvalTask = "category_fit";

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

export function runLocalBaseline(caseData: EvalCase): EvalOutput {
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
