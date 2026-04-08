# CLAUDE.md

## Tests

Write lots of tests. Before you say that you've completed any task, ensure that:
- The tests pass
- The typechecks pass
- The linter passes

## Running E2E Tests (Playwright)

E2E tests require a production build and a running server. The build must include mock env vars so the OpenRouter mock mode is active:

```bash
# 1. Build with mock env
OPENROUTER_API_KEY=mock-key OPENROUTER_MOCK=1 npm run build

# 2. Run pending DB migrations (if schema changed)
npx drizzle-kit migrate

# 3. Start the server
OPENROUTER_API_KEY=mock-key OPENROUTER_MOCK=1 NODE_ENV=production PORT=3001 npx tsx server.ts

# 4. Run tests (in a separate terminal)
npx playwright test
```

Common pitfalls:
- **Stale build**: If you change server code (e.g. `game.ts`, `category-fit.ts`), you must rebuild. The production server serves compiled code from `.next/`, not live source.
- **Stale chunks**: If you see `ChunkLoadError` in the browser, kill the server, run `rm -rf .next`, rebuild, and restart.
- **Missing migrations**: If a query fails with an unknown column, run `npx drizzle-kit migrate` before starting the server.
- **Port conflicts**: Kill any existing process on 3001 with `lsof -ti:3001 | xargs kill -9` before starting.
- **Mock mode**: `OPENROUTER_MOCK=1` makes `judgeCategoryFit` return deterministic results without calling OpenRouter. Answers containing "zzinvalid" are marked invalid; everything else is valid.

## Database Migrations

After any change to `src/server/db/schema.ts`, always run:

```bash
npm run db:generate
```

This creates a migration file in `drizzle/` that must be committed. Migrations run automatically on Vercel during the build step (`drizzle-kit migrate`).
