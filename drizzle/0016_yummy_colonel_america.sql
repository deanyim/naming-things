CREATE TABLE "naming-things_category_evidence_packet" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"category" varchar(256) NOT NULL,
	"normalizedCategory" varchar(256) NOT NULL,
	"kind" varchar(64) NOT NULL,
	"status" varchar(64) NOT NULL,
	"retrievedAt" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone,
	"model" varchar(256) NOT NULL,
	"searchProvider" varchar(64) NOT NULL,
	"sources" jsonb NOT NULL,
	"facts" jsonb NOT NULL,
	"queryLog" jsonb NOT NULL,
	"error" varchar(2048),
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "naming-things_category_judge_run" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"gameRoundId" varchar(128) NOT NULL,
	"categoryEvidencePacketId" varchar(64),
	"judgedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "naming-things_answer_verification" ADD COLUMN "categoryEvidencePacketId" varchar(64);--> statement-breakpoint
ALTER TABLE "naming-things_solo_run_judgment_history" ADD COLUMN "categoryEvidencePacketId" varchar(64);--> statement-breakpoint
ALTER TABLE "naming-things_solo_run" ADD COLUMN "categoryEvidencePacketId" varchar(64);--> statement-breakpoint
ALTER TABLE "naming-things_category_judge_run" ADD CONSTRAINT "naming-things_category_judge_run_categoryEvidencePacketId_naming-things_category_evidence_packet_id_fk" FOREIGN KEY ("categoryEvidencePacketId") REFERENCES "public"."naming-things_category_evidence_packet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_evidence_packet_category_idx" ON "naming-things_category_evidence_packet" USING btree ("normalizedCategory");--> statement-breakpoint
CREATE INDEX "category_evidence_packet_created_idx" ON "naming-things_category_evidence_packet" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "category_judge_run_round_idx" ON "naming-things_category_judge_run" USING btree ("gameRoundId");--> statement-breakpoint
CREATE INDEX "category_judge_run_packet_idx" ON "naming-things_category_judge_run" USING btree ("categoryEvidencePacketId");--> statement-breakpoint
ALTER TABLE "naming-things_answer_verification" ADD CONSTRAINT "naming-things_answer_verification_categoryEvidencePacketId_naming-things_category_evidence_packet_id_fk" FOREIGN KEY ("categoryEvidencePacketId") REFERENCES "public"."naming-things_category_evidence_packet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naming-things_solo_run_judgment_history" ADD CONSTRAINT "naming-things_solo_run_judgment_history_categoryEvidencePacketId_naming-things_category_evidence_packet_id_fk" FOREIGN KEY ("categoryEvidencePacketId") REFERENCES "public"."naming-things_category_evidence_packet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naming-things_solo_run" ADD CONSTRAINT "naming-things_solo_run_categoryEvidencePacketId_naming-things_category_evidence_packet_id_fk" FOREIGN KEY ("categoryEvidencePacketId") REFERENCES "public"."naming-things_category_evidence_packet"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_verification_evidence_packet_idx" ON "naming-things_answer_verification" USING btree ("categoryEvidencePacketId");