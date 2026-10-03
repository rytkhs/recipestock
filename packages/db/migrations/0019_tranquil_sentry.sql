ALTER TABLE "import_jobs" ADD COLUMN "shortcut_credential_id" text;--> statement-breakpoint
ALTER TABLE "shortcut_credentials" ADD COLUMN "first_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shortcut_credentials" ADD COLUMN "last_used_at" timestamp with time zone;