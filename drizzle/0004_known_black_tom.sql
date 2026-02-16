ALTER TABLE "naming-things_game" DROP CONSTRAINT "naming-things_game_code_unique";--> statement-breakpoint
DROP INDEX "code_idx";--> statement-breakpoint
CREATE INDEX "code_idx" ON "naming-things_game" USING btree ("code");--> statement-breakpoint
ALTER TABLE "naming-things_game" DROP COLUMN "rematchCode";