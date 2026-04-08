import path from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import {
  evalRoot,
  type EvalBatchMetrics,
  type EvalRunOutput,
  type EvalResultRow,
  type EvalTask,
} from "./eval-lib.ts";

type Aggregated = {
  modelId: string;
  task: EvalTask;
  chunkSize: number;
  cases: number;
  correct: number;
  parseOk: number;
  skipped: number;
  ambiguous: number;
  falseAccept: number;
  falseReject: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  estimatedCostUsd: number;
};

async function main() {
  const resultsRoot = path.join(evalRoot, "results");
  await ensureDir(resultsRoot);
  const runs = await loadRuns(resultsRoot);

  if (runs.length === 0) {
    console.log("No result files found. Run `npm run eval:run` first.");
    return;
  }

  const grouped = new Map<string, { rows: EvalResultRow[]; batches: EvalBatchMetrics[] }>();
  for (const run of runs) {
    const key = `${run.task}:${run.modelId}:${run.chunkSize}`;
    const entry = grouped.get(key) ?? { rows: [], batches: [] };
    entry.rows.push(...run.cases);
    entry.batches.push(...run.batches);
    grouped.set(key, entry);
  }

  const summary: Aggregated[] = [];
  for (const [key, { rows, batches }] of grouped) {
    const [task, modelId, chunkSizeStr] = key.split(":") as [EvalTask, string, string];
    summary.push(scoreGroup(task, modelId, Number(chunkSizeStr), rows, batches));
  }

  summary.sort((a, b) => {
    if (a.task !== b.task) return a.task.localeCompare(b.task);
    if (a.chunkSize !== b.chunkSize) return a.chunkSize - b.chunkSize;
    return a.modelId.localeCompare(b.modelId);
  });

  const leaderboardJson = path.join(resultsRoot, "leaderboard.json");
  const leaderboardMd = path.join(resultsRoot, "leaderboard.md");
  await writeFile(leaderboardJson, JSON.stringify(summary, null, 2) + "\n", "utf8");
  await writeFile(leaderboardMd, renderMarkdown(summary), "utf8");

  console.log(renderMarkdown(summary));
  console.log(`wrote ${leaderboardJson}`);
  console.log(`wrote ${leaderboardMd}`);
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function loadRuns(root: string): Promise<EvalRunOutput[]> {
  const runs: EvalRunOutput[] = [];
  const tasks = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const taskDir of tasks) {
    if (!taskDir.isDirectory()) continue;
    const taskPath = path.join(root, taskDir.name);
    const files = await readdir(taskPath, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const filePath = path.join(taskPath, file.name);
      const content = await readFile(filePath, "utf8");
      runs.push(JSON.parse(content) as EvalRunOutput);
    }
  }

  return runs;
}

function scoreGroup(
  task: EvalTask,
  modelId: string,
  chunkSize: number,
  rows: EvalResultRow[],
  batches: EvalBatchMetrics[],
): Aggregated {
  const usable = rows.filter((row) => row.status !== "skipped");
  const cases = usable.length;
  const correct = usable.filter((row) => row.actualLabel === row.expectedLabel).length;
  const parseOk = usable.filter((row) => row.parseOk).length;
  const ambiguous = usable.filter((row) => row.actualLabel === "ambiguous" || row.actualLabel === "needs_human").length;
  const falseAccept = usable.filter((row) => {
    if (!row.actualLabel) return false;
    return row.expectedLabel !== "duplicate" && row.expectedLabel !== "valid" && row.expectedLabel !== "accept" && row.actualLabel === "duplicate";
  }).length;
  const falseReject = usable.filter((row) => {
    if (!row.actualLabel) return false;
    return row.expectedLabel !== "invalid" && row.expectedLabel !== "reject" && row.actualLabel === "invalid";
  }).length;
  const latencies = batches.map((batch) => batch.latencyMs).sort((a, b) => a - b);
  const totalLatencyMs = latencies.reduce((sum, n) => sum + n, 0);
  // For chunked runs, wall-clock time is the max chunk latency (they run in parallel)
  const wallClockMs = latencies.length === 0 ? 0 : Math.max(...latencies);
  const estimatedCostUsd = batches.reduce((sum, batch) => sum + (batch.estimatedCostUsd ?? 0), 0);

  return {
    modelId,
    task,
    chunkSize,
    cases,
    correct,
    parseOk,
    skipped: rows.length - usable.length,
    ambiguous,
    falseAccept,
    falseReject,
    avgLatencyMs: wallClockMs,
    p95LatencyMs: percentile(latencies, 0.95),
    estimatedCostUsd,
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const idx = Math.min(values.length - 1, Math.floor(values.length * p));
  return values[idx] ?? 0;
}

function renderMarkdown(rows: Aggregated[]) {
  const header = [
    "| task | model | chunk | cases | accuracy | parse ok | ambiguous | false reject | wall clock ms | est cost usd |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const body = rows.map((row) => {
    const accuracy = row.cases === 0 ? 0 : row.correct / row.cases;
    const parseOkRate = row.cases === 0 ? 0 : row.parseOk / row.cases;
    return `| ${row.task} | ${row.modelId} | ${row.chunkSize} | ${row.cases} | ${accuracy.toFixed(3)} | ${parseOkRate.toFixed(3)} | ${row.ambiguous} | ${row.falseReject} | ${row.avgLatencyMs.toFixed(0)} | ${row.estimatedCostUsd.toFixed(6)} |`;
  });
  return [...header, ...body].join("\n") + "\n";
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
