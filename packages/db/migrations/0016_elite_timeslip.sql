DROP INDEX "recipes_user_id_updated_at_idx";--> statement-breakpoint
CREATE INDEX "recipes_user_id_created_at_idx" ON "recipes" USING btree ("user_id","created_at");