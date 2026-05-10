# Eval Harness

Offline eval framework for category fit verification. All test cases are batched into a single prompt per model, and all models run in parallel.

## Tasks

- `category_fit` — labels: `valid`, `invalid`, `ambiguous`
- `retrieval_packet_judging` — labels: `valid`, `invalid`, `ambiguous`; uses mocked category evidence packets

## Files

- `cases/*.jsonl` seed examples
- `prompts/*.md` task prompts (batched format)
- `config/models.json` model definitions and cost metadata
- `results/` generated outputs

## Commands

Run evals:

```bash
npm run eval:run
```

Score the latest results:

```bash
npm run eval:score
```

Run both:

```bash
npm run eval
```

### Options

Pass options directly to the run script:

```bash
node --experimental-strip-types scripts/run-evals.ts --chunk-size 10,26,52 --models mistral-small-3.2,claude-haiku-4.5
```

- `--chunk-size` — comma-separated list of chunk sizes to test (default: 25). Cases are split into chunks of this size and sent in parallel per model.
- `--models` — comma-separated list of model IDs to run (default: all enabled)
- `--tasks` — comma-separated list of tasks to run (default: all)

Environment variables `EVAL_CHUNK_SIZE`, `EVAL_MODELS`, and `EVAL_TASKS` work as alternatives.

## Data Shape

Each JSONL case has:

- `id`
- `task`
- `difficulty`
- `category`
- `input`
- `expected`
- optional `notes`

Each generated result file contains one JSON object per model/task/chunk-size run:

```json
{
  "task": "category_fit",
  "modelId": "mistral-small-3.2",
  "chunkSize": 25,
  "batches": [
    {
      "latencyMs": 7564,
      "inputTokens": 1200,
      "outputTokens": 900,
      "estimatedCostUsd": 0.000591
    }
  ],
  "cases": [
    {
      "caseId": "fit_001",
      "task": "category_fit",
      "modelId": "mistral-small-3.2",
      "status": "ok",
      "expectedLabel": "valid",
      "actualLabel": "valid",
      "parseOk": true,
      "rawText": "{\"label\":\"valid\",\"confidence\":0.99,\"reason\":\"An apple is a fruit.\"}"
    }
  ]
}
```

Batch metrics live under `batches` (one entry per chunk); per-case entries do not repeat token or cost fields. Result files are named `{modelId}.chunk-{chunkSize}.json`.

## Chunk Size

Cases are split into chunks and sent as parallel API calls. Smaller chunks reduce latency (parallel wall-clock time) but increase total cost slightly due to repeated prompt overhead.

Recommended chunk size: **25**. Mistral Small 3.2 hits peak accuracy (96.2%) at this size.

The local baseline is intentionally conservative. It should be useful for regressions and prompt comparisons, not as a final verifier.
