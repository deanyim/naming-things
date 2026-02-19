CREATE TYPE "public"."game_mode" AS ENUM('classic', 'turns');--> statement-breakpoint
ALTER TABLE "naming-things_game_player" ADD COLUMN "isEliminated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD COLUMN "mode" "game_mode" DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD COLUMN "turnTimerSeconds" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD COLUMN "currentTurnPlayerId" integer;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD COLUMN "currentTurnDeadline" timestamp with time zone;