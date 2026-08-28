CREATE TABLE "pr_brief" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"state_key" text NOT NULL,
	"head_sha" text NOT NULL,
	"docs_meta_fingerprint" text NOT NULL,
	"docs_content_fingerprint" text NOT NULL,
	"index_sha" text NOT NULL,
	"json" jsonb NOT NULL,
	"intent_available" boolean NOT NULL,
	"blast_available" boolean NOT NULL,
	"dropped_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dropped_citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"attempts" integer,
	"cost_usd" double precision,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pr_brief" ADD CONSTRAINT "pr_brief_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD CONSTRAINT "pr_brief_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pr_brief_state_key_idx" ON "pr_brief" USING btree ("pr_id","agent_id","state_key");