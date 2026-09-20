ALTER TABLE "tags" ADD COLUMN "position" integer;--> statement-breakpoint
UPDATE "tags" AS t
SET "position" = ordered."position"
FROM (
	SELECT tag."id",
		(row_number() OVER (
			PARTITION BY tag."user_id"
			ORDER BY coalesce(counts."recipe_count", 0) DESC, tag."created_at", tag."id"
		) - 1)::int AS "position"
	FROM "tags" tag
	LEFT JOIN (
		SELECT "tag_id", count(*) AS "recipe_count" FROM "recipe_tags" GROUP BY "tag_id"
	) counts ON counts."tag_id" = tag."id"
) AS ordered
WHERE t."id" = ordered."id";--> statement-breakpoint
ALTER TABLE "tags" ALTER COLUMN "position" SET NOT NULL;
