ALTER TABLE "naming-things_solo_run" ALTER COLUMN "slug" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "naming-things_solo_run" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;