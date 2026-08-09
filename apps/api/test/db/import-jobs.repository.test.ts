import { neonConfig } from "@neondatabase/serverless";
import { aiUsageMonthly, appUsers, createDb, importJobs } from "@recipestock/db";
import { PLAN_LIMITS } from "@recipestock/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createImportJobRepository,
  type ImportJobAiUsageLimits,
  type ImportJobRepository,
} from "../../src/import-jobs";

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
  getRandom: vi.fn(),
}));

const now = new Date("2026-07-14T00:00:00.000Z");

describe("Import Job repository with Neon Postgres", () => {
  let repository: ImportJobRepository;
  let db: ReturnType<typeof createDb>;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests.");
    }

    const connectionUrl = new URL(databaseUrl);
    neonConfig.fetchEndpoint = `http://${connectionUrl.hostname}:${connectionUrl.port}/sql`;
    neonConfig.poolQueryViaFetch = true;
    neonConfig.useSecureWebSocket = false;
    db = createDb(databaseUrl);
    repository = createImportJobRepository(db);
  });

  const aiUsage = { month: "2026-07", freeLimit: 10, proLimit: 300 };

  const createShortcutJob = (params: {
    id: string;
    userId: string;
    normalizedUrl?: string;
    aiUsage?: ImportJobAiUsageLimits;
  }) =>
    repository.createUrlJob({
      id: params.id,
      userId: params.userId,
      url: params.normalizedUrl ?? "https://example.com/recipe",
      normalizedUrl: params.normalizedUrl ?? "https://example.com/recipe",
      completionNotificationRequested: true,
      aiUsage: params.aiUsage ?? aiUsage,
      now,
    });

  it("同一URLの同時送信は一つのactive Jobへ収束する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_url_race_user_${runId}`;

    const results = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        createShortcutJob({
          id: `dbtest_url_race_job_${index}_${runId}`,
          userId,
        }),
      ),
    );

    expect(results.filter((result) => result.status === "created")).toHaveLength(1);
    expect(results.filter((result) => result.status === "existingActiveJob")).toHaveLength(1);
    const jobs = results.flatMap((result) => ("job" in result ? [result.job] : []));
    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);

    const storedJobs = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(storedJobs).toHaveLength(1);
    expect(storedJobs[0]?.id).toBe(jobs[0]?.id);
  });

  it("通知なしのJobを通知ありで再利用すると通知要求だけを有効にする", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_notification_user_${runId}`;
    const normalizedUrl = "https://example.com/notification";

    const webResult = await repository.createUrlJob({
      id: `dbtest_notification_web_${runId}`,
      userId,
      url: normalizedUrl,
      normalizedUrl,
      completionNotificationRequested: false,
      aiUsage,
      now,
    });
    expect(webResult.status).toBe("created");

    const shortcutResult = await createShortcutJob({
      id: `dbtest_notification_shortcut_${runId}`,
      userId,
      normalizedUrl,
    });

    expect(shortcutResult.status).toBe("existingActiveJob");
    expect(shortcutResult).toMatchObject({
      job: {
        id: `dbtest_notification_web_${runId}`,
        completionNotificationRequested: true,
      },
    });
  });

  it("Recipe上限時はImport Jobを残さない", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_limit_user_${runId}`;
    await db.insert(appUsers).values({
      userId,
      savedRecipeCount: PLAN_LIMITS.free.savedRecipes,
    });

    await expect(
      createShortcutJob({
        id: `dbtest_limit_job_${runId}`,
        userId,
      }),
    ).resolves.toEqual({ status: "recipeLimitExceeded" });

    const jobs = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(jobs).toHaveLength(0);
  });

  /**
   * 上限に達しているユーザーが共有した瞬間に理由を返すため、判定はキュー処理中ではなく
   * ここで行う。プランごとに返すnoticeが違うので、拒否結果はplanを運ぶ。
   */
  it.each([
    { plan: "free" as const, used: 10 },
    { plan: "pro" as const, used: 300 },
  ])("AI月次上限に達した$planのImport Jobは残さない", async ({ plan, used }) => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_ai_limit_${plan}_user_${runId}`;
    await db.insert(appUsers).values({ userId, plan });
    await db.insert(aiUsageMonthly).values({ userId, month: aiUsage.month, count: used });

    await expect(
      createShortcutJob({
        id: `dbtest_ai_limit_${plan}_job_${runId}`,
        userId,
      }),
    ).resolves.toEqual({ status: "aiUsageLimitExceeded", plan });

    const jobs = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(jobs).toHaveLength(0);
  });

  it("AI月次上限に達していなければImport Jobを作成する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_ai_under_limit_user_${runId}`;
    await db.insert(appUsers).values({ userId });
    await db.insert(aiUsageMonthly).values({
      userId,
      month: aiUsage.month,
      count: aiUsage.freeLimit - 1,
    });

    const result = await createShortcutJob({
      id: `dbtest_ai_under_limit_job_${runId}`,
      userId,
    });

    expect(result.status).toBe("created");
  });

  /**
   * 当月の利用回数だけを見る。前月の記録が残っていても、月初のリセット後は投稿できる。
   */
  it("前月の利用回数は当月の判定に影響しない", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_ai_prev_month_user_${runId}`;
    await db.insert(appUsers).values({ userId });
    await db.insert(aiUsageMonthly).values({
      userId,
      month: "2026-06",
      count: aiUsage.freeLimit,
    });

    const result = await createShortcutJob({
      id: `dbtest_ai_prev_month_job_${runId}`,
      userId,
    });

    expect(result.status).toBe("created");
  });

  /**
   * 上限0はプランごとにAIを無効化する設定値であり、記録がなくても上限到達として扱う。
   */
  it("上限0のプランは利用記録がなくても拒否する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_ai_zero_limit_user_${runId}`;
    await db.insert(appUsers).values({ userId });

    await expect(
      createShortcutJob({
        id: `dbtest_ai_zero_limit_job_${runId}`,
        userId,
        aiUsage: { ...aiUsage, freeLimit: 0 },
      }),
    ).resolves.toEqual({ status: "aiUsageLimitExceeded", plan: "free" });
  });
});
