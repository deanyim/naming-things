# Solo Judgment Cache Plan

## Goal

Make solo-mode answer judging more consistent across runs by reusing a prior
decision when the same normalized answer has already been judged for the same
category and compatible judging context.

The system should also support forced reruns in two modes:

- Use cache: reuse existing shared decisions and judge only cache misses.
- Bypass cache: fresh-judge every eligible answer and write the new decisions
  back into the shared cache.

## Current State

- Solo answers store their final judgment directly on `solo_run_answer`:
  `label`, `confidence`, and `reason`.
- A solo run stores its overall judging metadata on `solo_run`:
  `judgeModel`, `judgeVersion`, and `categoryEvidencePacketId`.
- Background classification, finish scoring, and reruns all route through
  `classifyAndPersist` in `src/server/lib/solo/scoring.ts`.
- Reruns snapshot the previous run state into `solo_run_judgment_history`
  before overwriting answer labels.
- There is no cross-run canonical decision for a normalized answer.

## Design

Add a shared solo judgment cache keyed by:

```text
categorySlug + normalizedText + judgmentContextKey
```

The cache stores the canonical judgment for that answer/category/context.

`judgmentContextKey` should be a deterministic hash of the fields that make a
decision comparable:

```text
judgeVersion
judgeModel
categoryEvidencePacketId or "none"
answerNormalizerVersion
cacheSchemaVersion
```

Using a single hash avoids nullable unique-index problems around
`categoryEvidencePacketId`.

## Schema

Add a table similar to:

```ts
export const soloCategoryAnswerJudgments = createTable(
  "solo_category_answer_judgment",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    categorySlug: d.varchar({ length: 256 }).notNull(),
    categoryDisplayName: d.varchar({ length: 256 }).notNull(),
    normalizedText: d.varchar({ length: 256 }).notNull(),
    label: categoryFitLabelEnum().notNull(),
    confidence: real(),
    reason: d.varchar({ length: 512 }),
    judgeModel: d.varchar({ length: 256 }),
    judgeVersion: d.varchar({ length: 256 }).notNull(),
    categoryEvidencePacketId: d
      .varchar({ length: 64 })
      .references(() => categoryEvidencePackets.id, { onDelete: "set null" }),
    judgmentContextKey: d.varchar({ length: 64 }).notNull(),
    sourceRunId: d.integer().references(() => soloRuns.id, {
      onDelete: "set null",
    }),
    sourceAnswerId: d.integer().references(() => soloRunAnswers.id, {
      onDelete: "set null",
    }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    uniqueIndex("solo_category_answer_judgment_unique_idx").on(
      t.categorySlug,
      t.normalizedText,
      t.judgmentContextKey,
    ),
    index("solo_category_answer_judgment_category_idx").on(t.categorySlug),
    index("solo_category_answer_judgment_answer_idx").on(t.normalizedText),
    index("solo_category_answer_judgment_packet_idx").on(
      t.categoryEvidencePacketId,
    ),
  ],
);
```

## Cache Modes

Define:

```ts
type SoloJudgmentCacheMode = "use" | "bypass";
```

Behavior:

- `use`: read cache first, apply hits, judge misses, write misses to cache.
- `bypass`: skip cache reads, judge all candidates, upsert results into cache.

Defaults:

- Normal scoring: `use`
- Background batch classification: `use`
- Non-forced rerun: `use`
- Forced rerun from debug UI: user chooses `use` or `bypass`

## Scoring Flow

Update `classifyAndPersist` to accept:

```ts
{
  category: string;
  categorySlug: string;
  candidates: Array<{
    answerId: number;
    text: string;
    normalizedText: string;
  }>;
  evidencePacket: CategoryEvidencePacket | null;
  cacheMode: SoloJudgmentCacheMode;
  sourceRunId: number;
}
```

Flow for `cacheMode: "use"`:

1. Compute the current `judgmentContextKey`.
2. Query cache rows for all candidate `normalizedText` values.
3. Apply cache hits to `solo_run_answer`.
4. Send only cache misses to `judgeCategoryFit`.
5. Persist new decisions to `solo_run_answer`.
6. Insert miss decisions into cache with `onConflictDoNothing`.
7. Re-read any conflicted cache rows and, if needed, prefer the stored
   canonical row so two concurrent runs converge on one decision.

Flow for `cacheMode: "bypass"`:

1. Compute the current `judgmentContextKey`.
2. Send every candidate to `judgeCategoryFit`.
3. Persist fresh decisions to `solo_run_answer`.
4. Upsert every result into cache with `onConflictDoUpdate`.

## Rerun Behavior

Extend rerun options:

```ts
type RerunJudgingOptions = {
  force?: boolean;
  cacheMode?: SoloJudgmentCacheMode;
};
```

Rules:

- If `force` is false and the run is current, keep the existing
  `JudgeVersionAlreadyCurrentError` behavior.
- If `force` is true and `cacheMode` is `use`, snapshot the run, then reapply
  cached decisions where possible and judge misses.
- If `force` is true and `cacheMode` is `bypass`, snapshot the run, fresh-judge
  every non-duplicate answer, and update the shared cache.

This gives "force" two explicit meanings:

- Force with cache: repair/re-score using the shared canonical decisions.
- Force without cache: distrust shared decisions and establish new ones.

## API And UI

Update `solo.rerunJudging` input:

```ts
z.object({
  slug: z.string().min(1),
  force: z.boolean().default(true),
  cacheMode: z.enum(["use", "bypass"]).default("use"),
})
```

Update the solo debug page to expose two actions:

- Force rerun using cache
- Force rerun without cache

Copy should make the difference clear:

- Using cache is cheaper and makes the run match the shared canonical state.
- Bypassing cache spends judge calls and replaces the shared canonical state
  for these answers.

## Backfill

Backfill the new table from existing solo data:

Use rows from:

- `solo_run_answer`
- joined to `solo_run`

Include only:

- `solo_run.status = 'finished'`
- `solo_run_answer.isDuplicate = false`
- `solo_run_answer.label is not null`
- `solo_run.judgeVersion is not null`

Populate:

- `categorySlug` from `solo_run.categorySlug`
- `categoryDisplayName` from `solo_run.categoryDisplayName`
- `normalizedText` from `solo_run_answer.normalizedText`
- `label`, `confidence`, `reason` from `solo_run_answer`
- `judgeModel`, `judgeVersion`, `categoryEvidencePacketId` from `solo_run`
- `sourceRunId` from `solo_run.id`
- `sourceAnswerId` from `solo_run_answer.id`
- `judgmentContextKey` from the same context-key helper used at runtime

Conflict policy:

- Pick the latest finished run per key as the initial canonical cache row.
- Record or report conflicts where older rows disagree with the selected row.
- Do not backfill from `solo_run_judgment_history`; keep that table as audit
  history, not active source of truth.

Optional follow-up:

- Add an admin report for conflicting historical judgments by
  `categorySlug + normalizedText`.

## Historical Updates

Do not automatically update every historical run in the first implementation.

Initial behavior:

- New runs use the shared cache.
- Rerun runs get updated when explicitly rerun.
- Forced bypass reruns update the shared cache for future runs.

Possible later admin operation:

- Apply cached decisions to all matching historical solo answers.
- Recompute affected run scores.
- Snapshot previous run state before changing anything.

This is useful if leaderboard consistency becomes important, but it is a
larger product decision because it can change existing public scores.

## Test Plan

Unit tests:

- Cache hit applies a decision without calling `judgeCategoryFit`.
- Cache miss calls `judgeCategoryFit` and writes through to cache.
- Mixed hit/miss batch judges only misses.
- Bypass mode calls `judgeCategoryFit` for every candidate.
- Bypass mode overwrites existing cache rows.
- Concurrent first-writer behavior converges on a single canonical row.
- Forced rerun with cache snapshots old state and reuses cache hits.
- Forced rerun without cache snapshots old state and overwrites cache.
- Backfill chooses the latest row for duplicate keys.
- Backfill reports conflicting labels for the same key.

Integration/regression tests:

- Finishing a solo run still stores labels on `solo_run_answer`.
- Leaderboard scoring is unchanged for equivalent labels.
- Background classification still respects the per-run lock.
- Rerun still records `solo_run_judgment_history`.
- Runs with stale or missing evidence packets still behave safely.

## Rollout Steps

1. Add schema and migration for `solo_category_answer_judgment`.
2. Add context-key helper and cache helper functions.
3. Update `classifyAndPersist` and its callers to pass `categorySlug`,
   `normalizedText`, `sourceRunId`, and `cacheMode`.
4. Update rerun options and debug UI.
5. Add tests for cache use and bypass behavior.
6. Add backfill script or migration-safe admin command.
7. Run backfill in staging and inspect conflict report.
8. Deploy with cache reads enabled.
9. Monitor judge call volume, cache hit rate, and conflict frequency.

## Open Decisions

- Whether `judgeModel` should be included in `judgmentContextKey` separately
  from `judgeVersion`. Current `judgeVersion` already hashes the prompt and
  model, but including both makes the key more transparent.
- Whether evidence-packet freshness should force a new context key or whether
  stale packet reuse should be allowed during reruns.
- Whether cache rows should be editable by an admin UI.
- Whether future multiplayer auto-classification should reuse the same cache
  table or get a separate shared judgment abstraction.
