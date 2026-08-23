import { aiUsageMonthly, type DbClient, recipes } from "@recipestock/db";
import { PLAN_LIMITS, type Plan } from "@recipestock/shared";
import { and, count, eq } from "drizzle-orm";
import { type AppUserPlanSyncOptions, readAppUserPlanForDb } from "./billing";
import { getNextJstMonthResetAtForMonth } from "./usage";

export type AiUsageSummary = {
  month: string;
  used: number;
};

export type MeRepository = {
  getAppUserPlan(userId: string): Promise<Plan>;
  countRecipes(userId: string): Promise<number>;
  getAiUsage(userId: string, month: string): Promise<AiUsageSummary | null>;
};

export const createMeRepository = (
  db: DbClient,
  planSyncOptions: AppUserPlanSyncOptions = {},
): MeRepository => ({
  async getAppUserPlan(userId) {
    return readAppUserPlanForDb(db, userId, planSyncOptions);
  },
  async countRecipes(userId) {
    const [row] = await db
      .select({ value: count() })
      .from(recipes)
      .where(eq(recipes.userId, userId));
    return row?.value ?? 0;
  },
  async getAiUsage(userId, month) {
    const [row] = await db
      .select({
        month: aiUsageMonthly.month,
        used: aiUsageMonthly.count,
      })
      .from(aiUsageMonthly)
      .where(and(eq(aiUsageMonthly.userId, userId), eq(aiUsageMonthly.month, month)))
      .limit(1);

    return row ?? null;
  },
});

export const buildMeResponse = ({
  userId,
  email,
  plan,
  recipeCount,
  aiUsage,
  aiUsageLimit,
}: {
  userId: string;
  email: string;
  plan: Plan;
  recipeCount: number;
  aiUsage: AiUsageSummary;
  aiUsageLimit: number;
}) => {
  const planLimits = PLAN_LIMITS[plan];

  return {
    userId,
    email,
    plan,
    recipeCount,
    recipeLimit: planLimits.savedRecipes,
    isRecipeLimitReached:
      planLimits.savedRecipes === null ? false : recipeCount >= planLimits.savedRecipes,
    aiUsage: {
      month: aiUsage.month,
      used: aiUsage.used,
      limit: aiUsageLimit,
      resetAt: getNextJstMonthResetAtForMonth(aiUsage.month),
    },
  };
};
