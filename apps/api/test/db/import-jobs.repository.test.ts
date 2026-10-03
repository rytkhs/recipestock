import { neonConfig } from "@neondatabase/serverless";
import { aiUsageMonthly, appUsers, createDb, importJobs, recipes } from "@recipestock/db";
import { PLAN_LIMITS } from "@recipestock/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createImportJobRepository,
  type ImportJobAiUsageLimits,
  type ImportJobRepository,
} from "../../src/import/jobs";

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

  const shortcutCredentialId = "dbtest_shortcut_credential";

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
      shortcutCredentialId,
      aiUsage: params.aiUsage ?? aiUsage,
      now,
    });

  it("ショートカットから作ったJobに、作ったときの連携キーを残す", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_shortcut_origin_user_${runId}`;

    await createShortcutJob({ id: `dbtest_shortcut_origin_job_${runId}`, userId });

    const [stored] = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(stored?.shortcutCredentialId).toBe(shortcutCredentialId);
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
      shortcutCredentialId: null,
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
    // 経路は作った側のものなので、合流したショートカットの連携キーで書き換えない。
    const [stored] = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(stored?.shortcutCredentialId).toBeNull();
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

  const sourceText = "鶏むね肉のレモン煮\n鶏むね肉 300g";

  const createTextJob = (params: {
    id: string;
    userId: string;
    sourceTextDigest?: string;
    sourceUrl?: string;
  }) =>
    repository.createTextJob({
      id: params.id,
      userId: params.userId,
      sourceText,
      sourceTextDigest: params.sourceTextDigest ?? "digest_lemon_chicken",
      sourceUrl: params.sourceUrl ?? null,
      aiUsage,
      now,
    });

  it("同じテキストの同時送信は一つのactive Jobへ収束する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_text_race_user_${runId}`;

    const results = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        createTextJob({ id: `dbtest_text_race_job_${index}_${runId}`, userId }),
      ),
    );

    expect(results.filter((result) => result.status === "created")).toHaveLength(1);
    expect(results.filter((result) => result.status === "existingActiveJob")).toHaveLength(1);

    const storedJobs = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(storedJobs).toHaveLength(1);
    expect(storedJobs[0]).toMatchObject({
      kind: "text",
      url: null,
      normalizedUrl: null,
      sourceText,
      sourceTextDigest: "digest_lemon_chicken",
    });
  });

  it("違うテキストはactive Jobがあっても別のJobにする", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_text_distinct_user_${runId}`;

    const first = await createTextJob({ id: `dbtest_text_distinct_first_${runId}`, userId });
    const second = await createTextJob({
      id: `dbtest_text_distinct_second_${runId}`,
      userId,
      sourceTextDigest: "digest_other_recipe",
    });

    expect(first.status).toBe("created");
    expect(second.status).toBe("created");
  });

  it("成功したテキストJobも原文を保持する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_text_succeeded_user_${runId}`;
    const jobId = `dbtest_text_succeeded_job_${runId}`;
    const recipeId = `dbtest_text_succeeded_recipe_${runId}`;
    const expiresBefore = new Date(now.getTime() - 60_000);
    const completingRepository = createImportJobRepository(db, { proPriceId: "price_dbtest" });
    const content = {
      title: "鶏むね肉のレモン煮",
      referenceImages: [],
      ingredientGroups: [{ ingredients: [{ name: "鶏むね肉", amount: "300g" }] }],
      steps: [],
    };

    await createTextJob({ id: jobId, userId });
    await repository.claimQueuedJob({ jobId, recipeId, expiresBefore, now });

    await expect(
      completingRepository.completeJobWithRecipe({
        jobId,
        expiresBefore,
        now,
        recipe: {
          id: recipeId,
          userId,
          title: content.title,
          content,
          originType: "text",
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
          searchText: "鶏むね肉のレモン煮 鶏むね肉",
          createdAt: now,
          updatedAt: now,
        },
      }),
    ).resolves.toEqual({ status: "succeeded" });

    const [storedJob] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    expect(storedJob).toMatchObject({ status: "succeeded", recipeId, sourceText });
  });

  it("既存Recipeを検出して成功へ戻す経路でも原文を保持する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_text_recovered_user_${runId}`;
    const jobId = `dbtest_text_recovered_job_${runId}`;
    const recipeId = `dbtest_text_recovered_recipe_${runId}`;
    const expiresBefore = new Date(now.getTime() - 60_000);

    await createTextJob({ id: jobId, userId });
    await repository.claimQueuedJob({ jobId, recipeId, expiresBefore, now });
    await repository.markJobSucceeded({ jobId, recipeId, now });

    await expect(repository.getJob(userId, jobId)).resolves.toMatchObject({
      status: "succeeded",
      recipeId,
      sourceText,
    });
  });

  it("閉じた失敗テキストJobも原文を保持する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_text_dismissed_user_${runId}`;
    const jobId = `dbtest_text_dismissed_job_${runId}`;

    await createTextJob({ id: jobId, userId });
    await repository.markJobFailed({
      jobId,
      errorCode: "extraction_failed",
      errorMessage: "Recipe could not be extracted from the text.",
      now,
    });

    await expect(repository.getJob(userId, jobId)).resolves.toMatchObject({ sourceText });
    await expect(repository.dismissJob({ userId, jobId, now })).resolves.toMatchObject({
      dismissedAt: now,
      sourceText,
    });
  });

  it("出典URLを持つテキストJobは、同じURLのURL取り込みを止めない", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_text_source_user_${runId}`;
    const sourceUrl = "https://www.instagram.com/p/dbtest/";

    const textJob = await createTextJob({
      id: `dbtest_text_source_job_${runId}`,
      userId,
      sourceUrl,
    });
    const urlJob = await repository.createUrlJob({
      id: `dbtest_text_source_url_job_${runId}`,
      userId,
      url: sourceUrl,
      normalizedUrl: sourceUrl,
      completionNotificationRequested: false,
      shortcutCredentialId: null,
      aiUsage,
      now,
    });

    expect(textJob).toMatchObject({
      status: "created",
      job: { url: sourceUrl, normalizedUrl: null },
    });
    expect(urlJob.status).toBe("created");
  });

  it("取り消したJobはRecipeを作らず、最近のJobにも出ず、同じURLをすぐ送り直せる", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_cancel_user_${runId}`;
    const jobId = `dbtest_cancel_job_${runId}`;
    const recipeId = `dbtest_cancel_recipe_${runId}`;
    const expiresBefore = new Date(now.getTime() - 60_000);
    const completingRepository = createImportJobRepository(db, { proPriceId: "price_dbtest" });

    await createShortcutJob({ id: jobId, userId });
    await repository.claimQueuedJob({ jobId, recipeId, expiresBefore, now });

    await expect(repository.cancelJob({ userId, jobId, now })).resolves.toMatchObject({
      status: "canceled",
      finishedAt: now,
      dismissedAt: now,
    });
    await expect(
      completingRepository.completeJobWithRecipe({
        jobId,
        expiresBefore,
        now,
        recipe: {
          id: recipeId,
          userId,
          title: "鶏むね肉のレモン煮",
          content: {
            title: "鶏むね肉のレモン煮",
            referenceImages: [],
            ingredientGroups: [],
            steps: [],
          },
          originType: "url",
          sourceUrl: "https://example.com/recipe",
          normalizedSourceUrl: "https://example.com/recipe",
          sourceName: "Example",
          searchText: "鶏むね肉のレモン煮",
          createdAt: now,
          updatedAt: now,
        },
      }),
    ).resolves.toEqual({ status: "inactive" });

    await expect(db.select().from(recipes).where(eq(recipes.userId, userId))).resolves.toEqual([]);
    await expect(repository.listRecentJobs(userId)).resolves.toEqual([]);
    await expect(
      createShortcutJob({ id: `dbtest_cancel_resubmit_job_${runId}`, userId }),
    ).resolves.toMatchObject({ status: "created" });
  });

  it("終わっていたJobは取り消しても変えずに返す", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_cancel_finished_user_${runId}`;
    const jobId = `dbtest_cancel_finished_job_${runId}`;

    await createShortcutJob({ id: jobId, userId });
    await repository.markJobFailed({
      jobId,
      errorCode: "fetch_failed",
      errorMessage: "Fetch failed.",
      now,
    });

    await expect(repository.cancelJob({ userId, jobId, now })).resolves.toMatchObject({
      status: "failed",
      errorCode: "fetch_failed",
      dismissedAt: null,
    });
    await expect(
      repository.cancelJob({ userId: `dbtest_cancel_other_user_${runId}`, jobId, now }),
    ).resolves.toBeNull();
  });

  it("成功したJobには作ったRecipeの題名を添え、表紙はロックされない新しい範囲のRecipeにだけ添える", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_recent_recipe_user_${runId}`;
    const coverImage = { objectKey: `recipes/${userId}/cover.jpg`, width: 1200, height: 800 };
    const insertRecipe = (id: string, createdAt: Date) =>
      db.insert(recipes).values({
        id,
        userId,
        title: id,
        content: { title: id, coverImage, referenceImages: [], ingredientGroups: [], steps: [] },
        searchText: id,
        createdAt,
        updatedAt: createdAt,
      });
    const succeedJob = async (jobId: string, recipeId: string) => {
      await createTextJob({ id: jobId, userId, sourceTextDigest: jobId });
      await repository.claimQueuedJob({
        jobId,
        recipeId,
        expiresBefore: new Date(now.getTime() - 60_000),
        now,
      });
      await repository.markJobSucceeded({ jobId, recipeId, now });
    };
    const oldRecipeId = `dbtest_recent_old_recipe_${runId}`;
    const newRecipeId = `dbtest_recent_new_recipe_${runId}`;

    await insertRecipe(oldRecipeId, new Date(now.getTime() - 60 * 60_000));
    for (let index = 0; index < PLAN_LIMITS.free.savedRecipes - 1; index += 1) {
      await insertRecipe(`dbtest_recent_newer_recipe_${index}_${runId}`, now);
    }
    await insertRecipe(newRecipeId, new Date(now.getTime() + 60_000));
    await succeedJob(`dbtest_recent_old_job_${runId}`, oldRecipeId);
    await succeedJob(`dbtest_recent_new_job_${runId}`, newRecipeId);
    await createTextJob({
      id: `dbtest_recent_running_job_${runId}`,
      userId,
      sourceTextDigest: `running_${runId}`,
    });

    const jobs = await repository.listRecentJobs(userId);

    expect(jobs.find((job) => job.recipeId === newRecipeId)?.recipe).toEqual({
      title: newRecipeId,
      coverImageObjectKey: coverImage.objectKey,
    });
    expect(jobs.find((job) => job.recipeId === oldRecipeId)?.recipe).toEqual({
      title: oldRecipeId,
      coverImageObjectKey: null,
    });
    expect(jobs.find((job) => job.status === "queued")?.recipe).toBeNull();
  });
});
