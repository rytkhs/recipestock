DROP INDEX "ai_usage_monthly_user_id_month_idx";--> statement-breakpoint
ALTER TABLE "ai_usage_monthly" DROP CONSTRAINT "ai_usage_monthly_pkey";--> statement-breakpoint
ALTER TABLE "ai_usage_monthly" ADD CONSTRAINT "ai_usage_monthly_user_id_month_pk" PRIMARY KEY("user_id","month");--> statement-breakpoint
ALTER TABLE "ai_usage_monthly" DROP COLUMN "id";
