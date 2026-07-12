CREATE TABLE "ios_share_channels" (
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
CREATE TABLE "ios_share_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"delivered_target" text,
	"delivered_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ios_share_channels_token_hash_uidx" ON "ios_share_channels" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ios_share_channels_user_id_created_at_idx" ON "ios_share_channels" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ios_share_handoffs_user_id_created_at_idx" ON "ios_share_handoffs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ios_share_handoffs_channel_id_created_at_idx" ON "ios_share_handoffs" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ios_share_handoffs_channel_pending_uidx" ON "ios_share_handoffs" USING btree ("channel_id") WHERE "ios_share_handoffs"."delivered_at" is null and "ios_share_handoffs"."superseded_at" is null;