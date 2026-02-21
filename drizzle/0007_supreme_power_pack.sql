ALTER TABLE "naming-things_game" ADD COLUMN "isPaused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD COLUMN "pausedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD COLUMN "pausedTimeRemainingMs" integer;