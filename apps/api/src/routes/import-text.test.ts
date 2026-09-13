import { IMPORT_TEXT_MAX_LENGTH } from "@recipestock/schemas";
import { describe, expect, it, vi } from "vitest";
import { type ImportJobRecord, type ImportJobRepository } from "../import-jobs";
import { createSilentTestApp } from "../test-helpers";

const auth = {
  getSession: async () => ({
    user: { id: "user_123", email: "user@example.com" },
  }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const sameOriginHeaders = {
  origin: "https://app.example.com",
  "sec-fetch-site": "same-origin",
};

const env = {
  APP_ENV: "development",
  APP_ORIGIN: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
};

const sourceText = "鶏むね肉のレモン煮\n鶏むね肉 300g\nレモン汁 大さじ2";

const createJob = (overrides: Partial<ImportJobRecord> = {}): ImportJobRecord => ({
  id: "job_123",
  userId: "user_123",
  kind: "text",
  status: "queued",
  url: null,
  normalizedUrl: null,
  sourceText,
  recipeId: null,
  errorCode: null,
  errorMessage: null,
  dismissedAt: null,
  completionNotificationRequested: false,
  completionNotificationSentAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  startedAt: null,
  finishedAt: null,
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  ...overrides,
});

const createRepository = (overrides: Partial<ImportJobRepository> = {}): ImportJobRepository => ({
  createUrlJob: async () => {
    throw new Error("should not create a URL job");
  },
  createTextJob: async () => ({ status: "created", job: createJob() }),
  listRecentJobs: async () => [],
  getJob: async () => null,
  getJobById: async () => null,
  expireActiveJobsForUser: async () => 0,
  expireJob: async () => false,
  claimQueuedJob: async () => null,
  completeJobWithRecipe: async () => ({ status: "inactive" }),
  markJobSucceeded: async () => undefined,
  markJobFailed: async () => undefined,
  markCompletionNotificationSent: async () => false,
  dismissJob: async () => null,
  ...overrides,
});

const createQueue = (send: () => Promise<unknown> = async () => undefined) =>
  ({ send }) as unknown as Queue<{ jobId: string }>;

const postText = (testApp: ReturnType<typeof createSilentTestApp>, body: unknown) =>
  testApp.request(
    "/api/import/text/jobs",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...sameOriginHeaders },
      body: JSON.stringify(body),
    },
    env,
  );

describe("Text import job routes", () => {
  it("前後の空白を除いた原文でテキストのimport jobを作成しQueueに送る", async () => {
    const send = vi.fn(async () => undefined);
    const expireActiveJobsForUser = vi.fn(async () => 1);
    const createTextJob = vi.fn<ImportJobRepository["createTextJob"]>(async () => ({
      status: "created",
      job: createJob(),
    }));
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({ createTextJob, expireActiveJobsForUser }),
      importQueue: createQueue(send),
      createImportJobId: () => "job_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    const response = await postText(testApp, { text: `\n  ${sourceText}  \n` });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      kind: "created",
      job: {
        id: "job_123",
        kind: "text",
        status: "queued",
        url: null,
        textPreview: "鶏むね肉のレモン煮",
        recipeId: null,
        errorCode: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      },
    });
    expect(createTextJob).toHaveBeenCalledWith({
      id: "job_123",
      userId: "user_123",
      sourceText,
      sourceTextDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      aiUsage: { month: "2026-06", freeLimit: 10, proLimit: 300 },
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(expireActiveJobsForUser.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      createTextJob.mock.invocationCallOrder[0] ?? 0,
    );
    expect(send).toHaveBeenCalledWith({ jobId: "job_123" }, { contentType: "json" });
  });

  it("前後の空白だけが違う原文は同じ原文として重複を判定する", async () => {
    const createTextJob = vi.fn<ImportJobRepository["createTextJob"]>(async () => ({
      status: "created",
      job: createJob(),
    }));
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({ createTextJob }),
      importQueue: createQueue(),
    });

    await postText(testApp, { text: sourceText });
    await postText(testApp, { text: `  ${sourceText}\n\n` });
    await postText(testApp, { text: "豚の生姜焼き\n豚ロース 200g" });

    const [first, second, other] = createTextJob.mock.calls.map(([params]) => params);
    expect(second?.sourceTextDigest).toBe(first?.sourceTextDigest);
    expect(other?.sourceTextDigest).not.toBe(first?.sourceTextDigest);
  });

  it.each([
    ["空白だけの原文", { text: " \n\t " }],
    ["上限文字数を超える原文", { text: "あ".repeat(IMPORT_TEXT_MAX_LENGTH + 1) }],
    ["文字列ではない原文", { text: 123 }],
    ["textのないbody", {}],
  ])("%sはvalidation_failedを返しjobを作らない", async (_label, body) => {
    const createTextJob = vi.fn<ImportJobRepository["createTextJob"]>();
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({ createTextJob }),
    });

    const response = await postText(testApp, body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
    expect(createTextJob).not.toHaveBeenCalled();
  });

  it("上限文字数ちょうどの原文は受け付ける", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository(),
      importQueue: createQueue(),
    });

    const response = await postText(testApp, { text: "あ".repeat(IMPORT_TEXT_MAX_LENGTH) });

    expect(response.status).toBe(202);
  });

  it("本文が大きすぎる場合は、空白を除けば有効な原文でもvalidation_failedを返す", async () => {
    const createTextJob = vi.fn<ImportJobRepository["createTextJob"]>();
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({ createTextJob }),
      importQueue: createQueue(),
    });

    const response = await postText(testApp, { text: `${" ".repeat(70_000)}${sourceText}` });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
    expect(createTextJob).not.toHaveBeenCalled();
  });

  it("同じ原文のactive jobがある場合は既存jobを返しQueueに送らない", async () => {
    const send = vi.fn(async () => undefined);
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        createTextJob: async () => ({
          status: "existingActiveJob",
          job: createJob({ id: "job_active", status: "running" }),
        }),
      }),
      importQueue: createQueue(send),
    });

    const response = await postText(testApp, { text: sourceText });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      kind: "existing_active_job",
      job: { id: "job_active", kind: "text", status: "running" },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("レシピ上限到達時はjobを作らずrecipe_limit_exceededを返す", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        createTextJob: async () => ({ status: "recipeLimitExceeded" }),
      }),
      importQueue: createQueue(),
    });

    const response = await postText(testApp, { text: sourceText });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "recipe_limit_exceeded" },
    });
  });

  it("AI月次上限に達した場合はjobを作らず429を返す", async () => {
    const send = vi.fn(async () => undefined);
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        createTextJob: async () => ({ status: "aiUsageLimitExceeded", plan: "free" }),
      }),
      importQueue: createQueue(send),
    });

    const response = await postText(testApp, { text: sourceText });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ai_usage_limit_exceeded" },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("Queue投入に失敗したjobをfailedにして一時利用不可を返す", async () => {
    const markJobFailed = vi.fn(async () => undefined);
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({ markJobFailed }),
      importQueue: createQueue(async () => {
        throw new Error("Queue unavailable");
      }),
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    const response = await postText(testApp, { text: sourceText });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "temporarily_unavailable" },
    });
    expect(markJobFailed).toHaveBeenCalledWith({
      jobId: "job_123",
      errorCode: "unknown",
      errorMessage: "Queue unavailable",
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
  });
});

describe("Import job detail route", () => {
  it("失敗したテキストのjobは直して送り直すための原文を返す", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        getJob: async () =>
          createJob({
            status: "failed",
            errorCode: "extraction_failed",
            finishedAt: new Date("2026-06-01T00:00:10.000Z"),
          }),
      }),
    });

    const response = await testApp.request("/api/import/jobs/job_123");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: {
        id: "job_123",
        kind: "text",
        status: "failed",
        textPreview: "鶏むね肉のレモン煮",
      },
      sourceText,
    });
  });

  it("URLのjobは原文を返さない", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        getJob: async () =>
          createJob({
            kind: "url",
            url: "https://example.com/recipe",
            normalizedUrl: "https://example.com/recipe",
            sourceText: null,
          }),
      }),
    });

    const response = await testApp.request("/api/import/jobs/job_123");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: { kind: "url", url: "https://example.com/recipe", textPreview: null },
      sourceText: null,
    });
  });

  it("成功したテキストjobも保存された原文を返す", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        getJob: async () =>
          createJob({
            status: "succeeded",
            sourceText,
            recipeId: "recipe_123",
            finishedAt: new Date("2026-06-01T00:00:10.000Z"),
          }),
      }),
    });

    const response = await testApp.request("/api/import/jobs/job_123");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: { status: "succeeded", textPreview: "鶏むね肉のレモン煮" },
      sourceText,
    });
  });

  it("閉じた失敗テキストjobも保存された原文を返す", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        getJob: async () =>
          createJob({
            status: "failed",
            sourceText,
            errorCode: "extraction_failed",
            dismissedAt: new Date("2026-06-01T00:00:20.000Z"),
            finishedAt: new Date("2026-06-01T00:00:10.000Z"),
          }),
      }),
    });

    const response = await testApp.request("/api/import/jobs/job_123");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: { status: "failed", textPreview: "鶏むね肉のレモン煮" },
      sourceText,
    });
  });
});
