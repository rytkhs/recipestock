UPDATE "recipes"
SET "source_type" = 'other'
WHERE "source_type" IS NULL;
--> statement-breakpoint
ALTER TABLE "recipes" ALTER COLUMN "source_type" SET NOT NULL;
