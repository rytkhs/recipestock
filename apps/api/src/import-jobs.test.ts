import { describe, expect, it } from "vitest";
import { type Bindings } from "./env";
import { type RecipeImageService } from "./images";
import { type ImportJobRecord, type ImportJobRepository, processImportJob } from "./import-jobs";
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
  claimQueuedJob: async () => {
    events.push("claim");
    return createJob();
  },
  markJobSucceeded: async ({ recipeId }) => {
    events.push(`succeeded:${recipeId}`);
  },
  markJobFailed: async ({ errorCode }) => {
    events.push(`failed:${errorCode}`);
  },
  dismissJob: async () => null,
  ...overrides,
});

const createRecipeRepository = (
  events: string[] = [],
  overrides: Partial<RecipeRepository> = {},
): RecipeRepository => ({
  createRecipeEnforcingPlanLimit: async (recipe) => {
    events.push(`recipe:${recipe.id}:${recipe.title}:${recipe.sourceName ?? ""}`);
    return { status: "created", recipe };
  },
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
    steps: [{ text: "煮詰める" }],
  }),
};

const env = {
  APP_ENV: "development",
  FREE_AI_MONTHLY_LIMIT: "10",
  IMPORT_TIMEOUT_MS: "1000",
} as Bindings;

describe("processImportJob", () => {
  it("URL job成功時にRecipeを作成してjobをsucceededにする", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events),
      recipeRepository: createRecipeRepository(events),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual([
      "claim",
      "recipe:recipe_123:Tomato pasta:Example Kitchen",
      "succeeded:recipe_123",
    ]);
  });

  it("import失敗時はRecipeを作らずjobをfailedにする", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events),
      recipeRepository: createRecipeRepository(events),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async () => {
        throw new RecipeImportError("fetch_failed", "failed");
      },
      createRecipeId: () => "recipe_123",
    });

    expect(events).toEqual(["claim", "failed:fetch_failed"]);
  });

  it("AI利用上限に達した場合はfailedにする", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events),
      recipeRepository: createRecipeRepository(events),
      usageRepository: createUsageRepository({
        consumeAiUsage: async () => ({ status: "limitExceeded" }),
      }),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
    });

    expect(events).toEqual(["claim", "failed:ai_usage_limit_exceeded"]);
  });

  it("レシピ上限に達した場合はfailedにする", async () => {
    const events: string[] = [];

    await processImportJob({
      jobId: "job_123",
      env,
      importJobRepository: createImportJobRepository(events),
      recipeRepository: createRecipeRepository(events, {
        createRecipeEnforcingPlanLimit: async () => ({ status: "limitExceeded" }),
      }),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
    });

    expect(events).toEqual(["claim", "failed:recipe_limit_exceeded"]);
  });

  it("画像コピー後にRecipe作成で予期しない例外が起きた場合はコピー済み画像を削除して例外を再throwする", async () => {
    const events: string[] = [];
    const imageService = {
      getObjectSize: async () => 100,
      copyObject: async (sourceKey: string, destinationKey: string) => {
        events.push(`copy:${sourceKey}:${destinationKey}`);
      },
      deleteObject: async (objectKey: string) => {
        events.push(`delete:${objectKey}`);
      },
    } as Partial<RecipeImageService> as RecipeImageService;

    await expect(
      processImportJob({
        jobId: "job_123",
        env,
        importJobRepository: createImportJobRepository(events),
        recipeRepository: createRecipeRepository(events, {
          createRecipeEnforcingPlanLimit: async () => {
            throw new Error("database unavailable");
          },
        }),
        usageRepository: createUsageRepository(),
        imageService,
        aiProvider: {
          normalize: async () => ({
            title: "Tomato pasta",
            coverImage: { type: "tmpObjectKey", key: "tmp/user_123/cover.png" },
            ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
            steps: [{ text: "煮詰める" }],
          }),
        },
        fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
        createRecipeId: () => "recipe_123",
        createImageId: () => "image_123",
      }),
    ).rejects.toThrow("database unavailable");

    expect(events).toEqual([
      "claim",
      "copy:tmp/user_123/cover.png:recipes/user_123/recipe_123/image_123.png",
      "delete:recipes/user_123/recipe_123/image_123.png",
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
      recipeRepository: createRecipeRepository(events),
      usageRepository: createUsageRepository(),
      aiProvider,
      fetcher: async (url) => ({ finalUrl: url, contentType: "text/html", body: htmlPage }),
      createRecipeId: () => "recipe_123",
    });

    expect(events).toEqual([]);
  });
});
