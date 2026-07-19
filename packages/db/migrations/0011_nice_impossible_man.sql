CREATE TABLE "shortcut_import_requests" (
	"user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"import_job_id" text NOT NULL,
	"response_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "created_via" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "completion_notification_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "completion_notification_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "shortcut_import_requests_user_request_id_uidx" ON "shortcut_import_requests" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "shortcut_import_requests_user_id_created_at_idx" ON "shortcut_import_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "shortcut_import_requests_import_job_id_idx" ON "shortcut_import_requests" USING btree ("import_job_id");