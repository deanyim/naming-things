ALTER TABLE "naming-things_game" ADD COLUMN "slug" varchar(8);--> statement-breakpoint
UPDATE "naming-things_game" SET "slug" = substr(md5(random()::text), 1, 8) WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "naming-things_game" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD CONSTRAINT "naming-things_game_slug_unique" UNIQUE("slug");
