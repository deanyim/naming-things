# CLAUDE.md

## Database Migrations

After any change to `src/server/db/schema.ts`, always run:

```bash
npm run db:generate
```

This creates a migration file in `drizzle/` that must be committed. Migrations run automatically on Vercel during the build step (`drizzle-kit migrate`).
