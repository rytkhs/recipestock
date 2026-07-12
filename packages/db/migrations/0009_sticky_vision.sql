DROP INDEX "import_jobs_user_active_idx";--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "saved_recipe_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_user_normalized_url_active_idx" ON "import_jobs" USING btree ("user_id","normalized_url") WHERE "import_jobs"."status" in ('queued', 'running') and "import_jobs"."normalized_url" is not null;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_saved_recipe_count_nonnegative" CHECK ("app_users"."saved_recipe_count" >= 0);