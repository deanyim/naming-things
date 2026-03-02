ALTER TABLE "naming-things_game_player" ADD COLUMN "teamId" integer;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD COLUMN "isTeamMode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "naming-things_game" ADD COLUMN "numTeams" integer DEFAULT 2 NOT NULL;