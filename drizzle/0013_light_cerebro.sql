ALTER TABLE "naming-things_solo_run" ADD COLUMN "slug" varchar(64);--> statement-breakpoint
UPDATE "naming-things_solo_run" SET "slug" = substr(md5(random()::text), 1, 8) WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "naming-things_solo_run" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "naming-things_solo_run" ADD CONSTRAINT "naming-things_solo_run_slug_unique" UNIQUE("slug");
