import { describe, expect, it } from "vitest";
import { type Bindings } from "./env";
import { type RecipeImageService } from "./images";
import {
  getImportJobExpiresBefore,
  type ImportJobRecord,
  type ImportJobRepository,
  processImportJob,
  resolveImportJobTimeoutMs,
} from "./import-jobs";
import { type RecipeImportAIProvider, RecipeImportError } from "./import-url";
import { type RecipeRepository } from "./recipes";
import { type UsageRepository } from "./usage";

const htmlPage = `<!doctype html>
<html>
  <head>
    <title>Tomato pasta</title>
    <meta property="og:site_name" content="Example Kitchen">
  </head>
  <body>
    <main>
      <h1>Tomato pasta</h1>
      <p>トマト缶とオリーブオイルで作るパスタです。材料を煮詰めて麺と合わせます。</p>
      <img src="/cover.jpg" alt="Tomato pasta">
    </main>
  </body>
</html>`;

const createJob = (overrides: Partial<ImportJobRecord> = {}): ImportJobRecord => ({
  id: "job_123",
  userId: "user_123",
  kind: "url",
  status: "running",
  url: "https://example.com/recipe",
  normalizedUrl: "https://example.com/recipe",
  recipeId: "recipe_123",
  errorCode: null,
  errorMessage: null,
  dismissedAt: null,
  completionNotificationRequested: false,
  completionNotificationSentAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  startedAt: new Date("2026-06-01T00:00:00.000Z"),
  finishedAt: null,
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  ...overrides,
});

const createImportJobRepository = (
  events: string[] = [],
  overrides: Partial<ImportJobRepository> = {},
): ImportJobRepository => ({
  createUrlJob: async () => {
    throw new Error("should not create a job");
  },
  listRecentJobs: async () => [],
  getJob: async () => null,
  getJobById: async () => null,
  expireActiveJobsForUser: async () => 0,
  expireJob: async () => {
    events.push("expire");
    return false;
  },
  claimQueuedJob: async () => {
    events.push("claim");
    return createJob();
  },
  completeJobWithRecipe: async ({ recipe }) => {
    events.push(`complete:${recipe.id}:${recipe.title}:${recipe.sourceName ?? ""}`);
    return { status: "succeeded" };
  },
  markJobSucceeded: async ({ recipeId }) => {
    events.push(`succeeded:${recipeId}`);
  },
  markJobFailed: async ({ errorCode }) => {
    events.push(`failed:${errorCode}`);
  },
  markCompletionNotificationSent: async () => false,
  dismissJob: async () => null,
  ...overrides,
});

const createRecipeRepository = (overrides: Partial<RecipeRepository> = {}): RecipeRepository => ({
  createRecipeEnforcingPlanLimit: async (recipe) => ({ status: "created", recipe }),
  getRecipe: async () => null,
  listRecipes: async () => ({ items: [], nextCursor: null }),
  updateRecipe: async () => null,
  deleteRecipe: async () => false,
  ...overrides,
});

const createUsageRepository = (overrides: Partial<UsageRepository> = {}): UsageRepository => ({
  getOrCreateAppUser: async (userId) => ({ userId, plan: "free" }),
  getAiUsage: async () => null,
  consumeAiUsage: async () => ({
    status: "consumed",
    usage: { month: "2026-06", used: 1 },
  }),
  ...overrides,
});

const aiProvider: RecipeImportAIProvider = {
  normalize: async () => ({
    title: "Tomato pasta",
    ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
    steps: [{ text: "煮詰める", imageUrls: [] }],
  }),
};

const env = {
  APP_ENV: "development",
  FREE_AI_MONTHLY_LIMIT: "10",
  IMPORT_TIMEOUT_MS: "1000",
} as Bindings;

describe("Import job timeout", () => {
  it("デフォルト期限を10分として計算する", () => {
    expect(resolveImportJobTimeoutMs({})).toBe(600_000);
    expect(getImportJobExpiresBefore(new Date("2026-06-01T00:10:00.000Z"), 600_000)).toEqual(
      new Date("2026-06-01T00:00:00.000Z"),
    );
  });

  it("正の整数だけを環境変数から採用する", () => {
    expect(resolveImportJobTimeoutMs({ IMPORT_JOB_TIMEOUT_MS: "300000" })).toBe(300_000);
    expect(resolveImportJobTimeoutMs({ IMPORT_JOB_TIMEOUT_MS: "invalid" })).toBe(600_000);
    expect(resolveImportJobTimeoutMs({ IMPORT_JOB_TIMEOUT_MS: "0" })).toBe(600_000);
  });
});

describe("processImportJob", () => {
  it("URL job成功時にRecipeを作成してjobをsucceededにする", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events),
      recipeRepository: createRecipeRepository(),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["expire", "claim", "complete:recipe_123:Tomato pasta:Example Kitchen"]);
  });

  it("import失敗時はRecipeを作らずjobをfailedにする", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events),
      recipeRepository: createRecipeRepository(),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async () => {
        throw new RecipeImportError("fetch_failed", "failed");
      },
      createRecipeId: () => "recipe_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["expire", "claim", "failed:fetch_failed"]);
  });

  it("AI利用上限に達した場合はfailedにする", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events),
      recipeRepository: createRecipeRepository(),
      usageRepository: createUsageRepository({
        consumeAiUsage: async () => ({ status: "limitExceeded" }),
      }),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["expire", "claim", "failed:ai_usage_limit_exceeded"]);
  });

  it("レシピ上限に達した場合はfailedにする", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events, {
        completeJobWithRecipe: async () => {
          events.push("complete:limitExceeded");
          return { status: "limitExceeded" };
        },
      }),
      recipeRepository: createRecipeRepository(),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["expire", "claim", "complete:limitExceeded"]);
  });

  it("画像コピー後にRecipe作成で予期しない例外が起きた場合はコピー済み画像を削除して例外を再throwする", async () => {
    const events: string[] = [];
    const imageService = {
      copyExternalImageUrl: async ({ sourceUrl, destinationKeyPrefix }) => {
        const objectKey = `${destinationKeyPrefix}/image_123.png`;
        events.push(`copyExternal:${sourceUrl}:${objectKey}`);
        return { objectKey, width: 1200, height: 800 };
      },
      deleteObject: async (objectKey: string) => {
        events.push(`delete:${objectKey}`);
      },
    } as Partial<RecipeImageService> as RecipeImageService;

    await expect(
      processImportJob({
        jobId: "job_123",
        env,
        recipeRepository: createRecipeRepository(),
        usageRepository: createUsageRepository(),
        imageService,
        aiProvider: {
          normalize: async () => ({
            title: "Tomato pasta",
            coverImageUrl: "https://example.com/cover.jpg",
            ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
            steps: [{ text: "煮詰める", imageUrls: [] }],
          }),
        },
        fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
        createRecipeId: () => "recipe_123",
        createImageId: () => "image_123",
        getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
        importJobRepository: createImportJobRepository(events, {
          completeJobWithRecipe: async () => {
            throw new Error("database unavailable");
          },
        }),
      }),
    ).rejects.toThrow("database unavailable");

    expect(events).toEqual([
      "expire",
      "claim",
      "copyExternal:https://example.com/cover.jpg:recipes/user_123/recipe_123/image_123/image_123.png",
      "delete:recipes/user_123/recipe_123/image_123/image_123.png",
    ]);
  });

  it("queuedではないjobは処理しない", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events, {
        claimQueuedJob: async () => null,
      }),
      recipeRepository: createRecipeRepository(),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["expire"]);
  });

  it("処理開始時点で期限切れならjobを処理しない", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events, {
        expireJob: async () => {
          events.push("expire:timedOut");
          return true;
        },
      }),
      recipeRepository: createRecipeRepository(),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
    });

    expect(events).toEqual(["expire:timedOut"]);
  });

  it("URL取得中に全体期限へ達した場合はRecipeを作成しない", async () => {
    const events: string[] = [];
    let fetched = false;

    await processImportJob({
      jobId: "job_123",
      env: { ...env, IMPORT_JOB_TIMEOUT_MS: "1000" },
      importJobRepository: createImportJobRepository(events),
      recipeRepository: createRecipeRepository(),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async (url) => {
        fetched = true;
        return { finalUrl: url, contentType: "text/html", body: htmlPage };
      },
      createRecipeId: () => "recipe_123",
      getCurrentDate: () =>
        fetched ? new Date("2026-06-01T00:00:01.000Z") : new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["expire", "claim", "expire", "failed:job_timeout"]);
  });

  it("Recipe保存直前にjobが期限切れになった場合はコピー済み画像を削除する", async () => {
    const events: string[] = [];
    const imageService = {
      copyExternalImageUrl: async ({ destinationKeyPrefix }) => {
        const objectKey = `${destinationKeyPrefix}.png`;
        events.push(`copy:${objectKey}`);
        return { objectKey, width: 1200, height: 800 };
      },
      deleteObject: async (objectKey: string) => {
        events.push(`delete:${objectKey}`);
      },
    } as Partial<RecipeImageService> as RecipeImageService;

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events, {
        completeJobWithRecipe: async () => {
          events.push("complete:timedOut");
          return { status: "timedOut" };
        },
      }),
      recipeRepository: createRecipeRepository(),
      usageRepository: createUsageRepository(),
      imageService,
      aiProvider: {
        normalize: async () => ({
          title: "Tomato pasta",
          coverImageUrl: "https://example.com/cover.jpg",
          ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
          steps: [{ text: "煮詰める", imageUrls: [] }],
        }),
      },
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
      createImageId: () => "image_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual([
      "expire",
      "claim",
      "copy:recipes/user_123/recipe_123/image_123.png",
      "complete:timedOut",
      "delete:recipes/user_123/recipe_123/image_123.png",
    ]);
  });
});
