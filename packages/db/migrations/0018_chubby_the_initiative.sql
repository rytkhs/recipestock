ALTER TABLE "shortcut_credentials" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shortcut_credentials" ADD COLUMN "verified_at" timestamp with time zone;