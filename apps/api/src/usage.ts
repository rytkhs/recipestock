import { aiUsageMonthly, appUsers, type DbClient } from "@recipestock/db";
import { PLAN_LIMITS, type Plan } from "@recipestock/shared";
import { and, eq, sql } from "drizzle-orm";
import { type Bindings } from "./env";

export type AiUsageSummary = {
  month: string;
  used: number;
};

export type ConsumeAiUsageResult =
  | {
      status: "consumed";
      usage: AiUsageSummary;
    }
  | {
      status: "limitExceeded";
    };

export type UsageRepository = {
  getOrCreateAppUser(userId: string): Promise<{ userId: string; plan: Plan }>;
  getAiUsage(userId: string, month: string): Promise<AiUsageSummary | null>;
  consumeAiUsage(params: {
    userId: string;
    month: string;
    limit: number;
    usageId: string;
  }): Promise<ConsumeAiUsageResult>;
};

export const consumeAiUsage = async ({
  userId,
  env,
  repository,
  now = new Date(),
  createUsageId = createAiUsageId,
}: {
  userId: string;
  env: Partial<Bindings>;
  repository: UsageRepository;
  now?: Date;
  createUsageId?: () => string;
}): Promise<ConsumeAiUsageResult> => {
  const appUser = await repository.getOrCreateAppUser(userId);
  const month = getCurrentJstMonth(now);
  const limit = resolveAiMonthlyLimit(appUser.plan, env);

  if (limit === 0) {
    return { status: "limitExceeded" };
  }

  return repository.consumeAiUsage({
    userId,
    month,
    limit,
    usageId: createUsageId(),
  });
};

const crockfordBase32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const createAiUsageId = (now = Date.now()) => {
  let time = now;
  let encodedTime = "";

  for (let i = 0; i < 10; i += 1) {
    encodedTime = crockfordBase32[time % 32] + encodedTime;
    time = Math.floor(time / 32);
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const encodedRandom = Array.from(bytes, (byte) => crockfordBase32[byte & 31]).join("");

  return `${encodedTime}${encodedRandom}`;
};

export const createUsageRepository = (db: DbClient): UsageRepository => ({
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
  async consumeAiUsage({ userId, month, limit, usageId }) {
    const result = await db.execute<{ month: string; used: number }>(sql`
      insert into ai_usage_monthly (
        id,
        user_id,
        month,
        count,
        created_at,
        updated_at
      )
      values (${usageId}, ${userId}, ${month}, 1, now(), now())
      on conflict (user_id, month)
      do update set
        count = ai_usage_monthly.count + 1,
        updated_at = now()
      where ai_usage_monthly.count < ${limit}
      returning month, count as "used"
    `);

    const row = result.rows[0];

    if (!row) {
      return { status: "limitExceeded" };
    }

    return {
      status: "consumed",
      usage: row,
    };
  },
});

export const getCurrentJstMonth = (date = new Date()) => {
  const parts = getJstYearMonth(date);
  return `${parts.year}-${parts.month}`;
};

export const getNextJstMonthResetAt = (date = new Date()) => {
  const { year, month } = getJstYearMonth(date);
  return getNextJstMonthResetAtForMonth(`${year}-${month}`);
};

export const getNextJstMonthResetAtForMonth = (jstMonth: string) => {
  const [year, month] = jstMonth.split("-");
  if (!year || !month) {
    throw new Error(`Invalid JST month: ${jstMonth}`);
  }

  const nextMonthIndex = Number(month);
  const nextMonthYear = nextMonthIndex === 12 ? Number(year) + 1 : Number(year);
  const nextMonth = nextMonthIndex === 12 ? 1 : nextMonthIndex + 1;

  return new Date(Date.UTC(nextMonthYear, nextMonth - 1, 1, -9)).toISOString();
};

export const resolveAiMonthlyLimit = (plan: Plan, env: Partial<Bindings>) => {
  const rawLimit = plan === "free" ? env.FREE_AI_MONTHLY_LIMIT : env.PRO_AI_MONTHLY_LIMIT;

  if (rawLimit === undefined || rawLimit === "") {
    return PLAN_LIMITS[plan].monthlyAiImports;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`${plan} AI monthly limit must be a nonnegative integer.`);
  }

  return limit;
};

export const buildAiUsageResponse = ({
  month,
  used,
  limit,
  resetAt,
}: AiUsageSummary & {
  limit: number;
  resetAt: string;
}) => ({
  month,
  used,
  limit,
  resetAt,
});

const getJstYearMonth = (date: Date) => {
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

  return { year, month };
};
