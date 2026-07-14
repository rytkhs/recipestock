CREATE TABLE "shortcut_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_suffix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
DROP TABLE "ios_share_channels" CASCADE;--> statement-breakpoint
DROP TABLE "ios_share_handoffs" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "shortcut_credentials_token_hash_uidx" ON "shortcut_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "shortcut_credentials_user_id_created_at_idx" ON "shortcut_credentials" USING btree ("user_id","created_at");