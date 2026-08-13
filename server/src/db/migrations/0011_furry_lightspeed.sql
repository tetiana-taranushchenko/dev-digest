ALTER TABLE "conventions" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_ref" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "rejected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "conventions_ws_repo_idx" ON "conventions" USING btree ("workspace_id","repo_id");