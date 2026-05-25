import { aiUsageMonthly, appUsers, type DbClient, recipes } from "@recipestock/db";
import { PLAN_LIMITS, type Plan } from "@recipestock/shared";
import { and, count, eq } from "drizzle-orm";

export type AppUserSummary = {
  userId: string;
  plan: Plan;
};

export type AiUsageSummary = {
  month: string;
  count: number;
};

export type MeRepository = {
  getOrCreateAppUser(userId: string): Promise<AppUserSummary>;
  countRecipes(userId: string): Promise<number>;
  getAiUsage(userId: string, month: string): Promise<AiUsageSummary | null>;
};

export const createMeRepository = (db: DbClient): MeRepository => ({
  async getOrCreateAppUser(userId) {
    await db.insert(appUsers).values({ userId }).onConflictDoNothing();

    const [appUser] = await db.select().from(appUsers).where(eq(appUsers.userId, userId)).limit(1);

    if (!appUser) {
      throw new Error(`App user was not created for ${userId}`);
    }

    return {
      userId: appUser.userId,
      plan: appUser.plan,
    };
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
        count: aiUsageMonthly.count,
      })
      .from(aiUsageMonthly)
      .where(and(eq(aiUsageMonthly.userId, userId), eq(aiUsageMonthly.month, month)))
      .limit(1);

    return row ?? null;
  },
});

export const getCurrentJstMonth = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  if (!year || !month) {
    throw new Error("Failed to format current JST month.");
  }

  return `${year}-${month}`;
};

export const buildMeResponse = ({
  userId,
  plan,
  recipeCount,
  aiUsage,
}: {
  userId: string;
  plan: Plan;
  recipeCount: number;
  aiUsage: AiUsageSummary;
}) => {
  const planLimits = PLAN_LIMITS[plan];
  const remaining = Math.max(planLimits.monthlyAiImports - aiUsage.count, 0);

  return {
    userId,
    plan,
    recipeCount,
    recipeLimit: planLimits.savedRecipes,
    isRecipeLimitReached:
      planLimits.savedRecipes === null ? false : recipeCount >= planLimits.savedRecipes,
    aiUsage: {
      month: aiUsage.month,
      count: aiUsage.count,
      limit: planLimits.monthlyAiImports,
      remaining,
    },
  };
};
