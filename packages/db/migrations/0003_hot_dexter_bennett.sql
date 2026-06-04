CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"url" text,
	"normalized_url" text,
	"recipe_id" text,
	"error_code" text,
	"error_message" text,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "import_jobs_user_id_updated_at_idx" ON "import_jobs" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_user_active_idx" ON "import_jobs" USING btree ("user_id") WHERE "import_jobs"."status" in ('queued', 'running');