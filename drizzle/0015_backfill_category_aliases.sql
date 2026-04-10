-- Backfill category_aliases with canonical display names from earliest runs.
-- Only inserts for slugs that don't already have an alias entry.
INSERT INTO "naming-things_category_alias" ("alias", "alias_slug", "canonical_name", "canonical_slug", "created_at")
SELECT DISTINCT ON (r."category_slug")
  r."category_display_name" AS "alias",
  r."category_slug" AS "alias_slug",
  r."category_display_name" AS "canonical_name",
  r."category_slug" AS "canonical_slug",
  r."created_at"
FROM "naming-things_solo_run" r
WHERE r."status" = 'finished'
  AND r."category_slug" NOT IN (
    SELECT "alias_slug" FROM "naming-things_category_alias"
  )
ORDER BY r."category_slug", r."created_at" ASC;--> statement-breakpoint

-- Update existing runs to use the canonical display name from aliases
UPDATE "naming-things_solo_run" r
SET "category_display_name" = a."canonical_name"
FROM "naming-things_category_alias" a
WHERE r."category_slug" = a."alias_slug"
  AND r."category_display_name" != a."canonical_name";
