import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  DEFAULT_CHUNK_SIZE,
  loadCases,
  loadModelsConfig,
  estimateCostUsd,
  evalRoot,
  parseBatchResponse,
  runLocalBaseline,
  type EvalBatchMetrics,
  type EvalRunOutput,
  type EvalResultRow,
  type ModelConfig,
  type EvalTask,
} from "./eval-lib.ts";
import { buildCategoryFitPrompt } from "../src/server/lib/verification/prompts.ts";

type CliOptions = {
  tasks?: EvalTask[];
  models?: string[];
  chunkSizes?: number[];
};

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const tasks = args.includes("--tasks")
    ? parseList(args[args.indexOf("--tasks") + 1])
    : parseList(process.env.EVAL_TASKS);
  const models = args.includes("--models")
    ? parseList(args[args.indexOf("--models") + 1])
    : parseList(process.env.EVAL_MODELS);
  const chunkSizeStr = args.includes("--chunk-size")
    ? args[args.indexOf("--chunk-size") + 1]
    : process.env.EVAL_CHUNK_SIZE;
  const chunkSizes = parseList(chunkSizeStr)?.map(Number).filter((n) => n > 0);
  return {
    tasks: tasks as EvalTask[] | undefined,
    models,
    chunkSizes,
  };
}

async function callOpenRouter(model: string, prompt: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const startedAt = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/kateyu/naming-things",
      "X-Title": "naming-things eval harness",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const rawText = payload.choices?.[0]?.message?.content ?? "";
  return {
    rawText,
    latencyMs: Date.now() - startedAt,
    inputTokens: payload.usage?.prompt_tokens,
    outputTokens: payload.usage?.completion_tokens,
  };
}

async function evaluateModel(
  task: EvalTask,
  model: ModelConfig,
  cases: Awaited<ReturnType<typeof loadCases>>,
  taskDir: string,
  chunkSize: number,
): Promise<void> {
  const useRemote = model.provider === "openrouter" && !!process.env.OPENROUTER_API_KEY;

  // Local baseline: run per-case
  if (model.provider === "local") {
    const rows: EvalResultRow[] = cases.map((caseData) => {
      const output = runLocalBaseline(caseData);
      return {
        caseId: caseData.id,
        task,
        modelId: model.id,
        status: "ok" as const,
        expectedLabel: caseData.expected.label,
        actualLabel: output.label,
        parseOk: true,
        rawText: JSON.stringify(output),
      };
    });
    await writeResults(taskDir, {
      task,
      modelId: model.id,
      chunkSize,
      batches: [{ latencyMs: 0, estimatedCostUsd: estimateCostUsd(model, 0, 0) }],
      cases: rows,
    });
    return;
  }

  // No API key: skip all
  if (!useRemote) {
    const rows: EvalResultRow[] = cases.map((caseData) => ({
      caseId: caseData.id,
      task,
      modelId: model.id,
      status: "skipped" as const,
      expectedLabel: caseData.expected.label,
      actualLabel: null,
      parseOk: false,
      rawText: "",
      skipReason: "OPENROUTER_API_KEY is not set",
    }));
    await writeResults(taskDir, {
      task,
      modelId: model.id,
      chunkSize,
      batches: [{ latencyMs: 0 }],
      cases: rows,
    });
    return;
  }

  // Chunk cases and run chunks in parallel
  const chunks: typeof cases[] = [];
  for (let i = 0; i < cases.length; i += chunkSize) {
    chunks.push(cases.slice(i, i + chunkSize));
  }

  const chunkResults = await Promise.all(
    chunks.map((chunk) => evaluateChunk(chunk, task, model)),
  );

  const allRows: EvalResultRow[] = [];
  const allBatches: EvalBatchMetrics[] = [];
  for (const { rows, batch } of chunkResults) {
    allRows.push(...rows);
    allBatches.push(batch);
  }

  await writeResults(taskDir, {
    task,
    modelId: model.id,
    chunkSize,
    batches: allBatches,
    cases: allRows,
  });
}

async function evaluateChunk(
  chunk: Awaited<ReturnType<typeof loadCases>>,
  task: EvalTask,
  model: ModelConfig,
): Promise<{ rows: EvalResultRow[]; batch: EvalBatchMetrics }> {
  const items = chunk.map((c, i) => ({
    answerId: i,
    category: c.category,
    candidate_answer: String(c.input.candidate_answer ?? ""),
  }));
  const prompt = buildCategoryFitPrompt(items);
  try {
    const result = await callOpenRouter(model.model, prompt);
    const parsed = parseBatchResponse(result.rawText);
    const cost = estimateCostUsd(model, result.inputTokens, result.outputTokens);

    const rows: EvalResultRow[] = chunk.map((caseData, i) => {
      const output = parsed.get(i);
      return {
        caseId: caseData.id,
        task,
        modelId: model.id,
        status: "ok" as const,
        expectedLabel: caseData.expected.label,
        actualLabel: output?.label ?? null,
        parseOk: !!output,
        rawText: output ? JSON.stringify(output) : "",
        error: output ? undefined : "case ID not found in batch response",
      };
    });
    return {
      rows,
      batch: {
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: cost,
      },
    };
  } catch (error) {
    const rows: EvalResultRow[] = chunk.map((caseData) => ({
      caseId: caseData.id,
      task,
      modelId: model.id,
      status: "error" as const,
      expectedLabel: caseData.expected.label,
      actualLabel: null,
      parseOk: false,
      rawText: "",
      error: error instanceof Error ? error.message : String(error),
    }));
    return { rows, batch: { latencyMs: 0 } };
  }
}

async function writeResults(taskDir: string, result: EvalRunOutput) {
  const outFile = path.join(taskDir, `${result.modelId}.chunk-${result.chunkSize}.json`);
  await writeFile(outFile, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`wrote ${outFile} (${result.cases.length} cases, chunk=${result.chunkSize})`);
}

async function main() {
  const options = parseArgs();
  const chunkSizes = options.chunkSizes ?? [DEFAULT_CHUNK_SIZE];
  const models = await loadModelsConfig();
  const taskList = options.tasks ?? ["category_fit"];
  const selectedModels = models.filter((model) => {
    if (!model.enabled) return false;
    if (options.models && !options.models.includes(model.id)) return false;
    return true;
  });

  console.log(`chunk sizes: ${chunkSizes.join(", ")}`);
  await mkdir(path.join(evalRoot, "results"), { recursive: true });

  for (const task of taskList) {
    const cases = await loadCases(task);
    const taskDir = path.join(evalRoot, "results", task);
    await mkdir(taskDir, { recursive: true });

    // Run all models x chunk sizes in parallel
    await Promise.all(
      chunkSizes.flatMap((chunkSize) =>
        selectedModels.map((model) =>
          evaluateModel(task, model, cases, taskDir, chunkSize),
        ),
      ),
    );
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
