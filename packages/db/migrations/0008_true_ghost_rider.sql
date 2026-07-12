WITH ranked_pending AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "user_id"
			ORDER BY "created_at" DESC, "id" DESC
		) AS "row_number"
	FROM "ios_share_handoffs"
	WHERE "delivered_at" IS NULL
	  AND "superseded_at" IS NULL
)
UPDATE "ios_share_handoffs" AS handoff
SET
	"superseded_at" = CURRENT_TIMESTAMP,
	"updated_at" = CURRENT_TIMESTAMP
FROM ranked_pending
WHERE handoff."id" = ranked_pending."id"
  AND ranked_pending."row_number" > 1;--> statement-breakpoint
DROP INDEX "ios_share_handoffs_channel_pending_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "ios_share_handoffs_user_pending_uidx" ON "ios_share_handoffs" USING btree ("user_id") WHERE "ios_share_handoffs"."delivered_at" is null and "ios_share_handoffs"."superseded_at" is null;
