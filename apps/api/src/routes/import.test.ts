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

const createJob = (overrides: Partial<ImportJobRecord> = {}): ImportJobRecord => ({
  id: "job_123",
  userId: "user_123",
  kind: "url",
  status: "queued",
  url: "https://example.com/recipe",
  normalizedUrl: "https://example.com/recipe",
  recipeId: null,
  errorCode: null,
  errorMessage: null,
  dismissedAt: null,
  createdVia: "web",
  completionNotificationRequested: false,
  completionNotificationSentAt: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  startedAt: null,
  finishedAt: null,
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  ...overrides,
});

const createRepository = (overrides: Partial<ImportJobRepository> = {}): ImportJobRepository => ({
  createUrlJob: async () => ({ status: "created", job: createJob() }),
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

describe("Import job routes", () => {
  it("期限切れactive jobを処理してURL import jobを作成しQueueに送る", async () => {
    const send = vi.fn(async () => undefined);
    const expireActiveJobsForUser = vi.fn(async () => 1);
    const createUrlJob = vi.fn(async () => ({
      status: "created" as const,
      job: createJob(),
    }));
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({ createUrlJob, expireActiveJobsForUser }),
      importQueue: { send } as unknown as Queue<{ jobId: string }>,
      createImportJobId: () => "job_123",
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    const response = await testApp.request("/api/import/url/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", ...sameOriginHeaders },
      body: JSON.stringify({ url: "https://example.com:443/recipe?utm_source=x#step" }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      kind: "created",
      job: {
        id: "job_123",
        kind: "url",
        createdVia: "web",
        status: "queued",
        url: "https://example.com/recipe",
        recipeId: null,
        errorCode: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      },
    });
    expect(createUrlJob).toHaveBeenCalledWith({
      id: "job_123",
      userId: "user_123",
      url: "https://example.com:443/recipe?utm_source=x#step",
      normalizedUrl: "https://example.com/recipe",
      createdVia: "web",
      requestId: null,
      completionNotificationRequested: false,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(expireActiveJobsForUser).toHaveBeenCalledWith({
      userId: "user_123",
      expiresBefore: new Date("2026-05-31T23:50:00.000Z"),
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(expireActiveJobsForUser.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      createUrlJob.mock.invocationCallOrder[0] ?? 0,
    );
    expect(send).toHaveBeenCalledWith({ jobId: "job_123" }, { contentType: "json" });
  });

  it("active jobがある場合は既存jobを返しQueueに送らない", async () => {
    const send = vi.fn(async () => undefined);
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        createUrlJob: async () => ({
          status: "existingActiveJob",
          job: createJob({ id: "job_active", status: "running" }),
        }),
      }),
      importQueue: { send } as unknown as Queue<{ jobId: string }>,
    });

    const response = await testApp.request("/api/import/url/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", ...sameOriginHeaders },
      body: JSON.stringify({ url: "https://example.com/recipe" }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      kind: "existing_active_job",
      job: {
        id: "job_active",
        status: "running",
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("URLが不正な場合はinvalid_urlを返す", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository(),
      importQueue: { send: vi.fn(async () => undefined) } as unknown as Queue<{ jobId: string }>,
    });

    const response = await testApp.request("/api/import/url/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", ...sameOriginHeaders },
      body: JSON.stringify({ url: "ftp://example.com/recipe" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_url" },
    });
  });

  it("レシピ上限到達時はjobを作らずrecipe_limit_exceededを返す", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        createUrlJob: async () => ({ status: "limitExceeded" }),
      }),
      importQueue: { send: vi.fn(async () => undefined) } as unknown as Queue<{ jobId: string }>,
    });

    const response = await testApp.request("/api/import/url/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", ...sameOriginHeaders },
      body: JSON.stringify({ url: "https://example.com/recipe" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "recipe_limit_exceeded" },
    });
  });

  it("Queue投入に失敗したjobをfailedにしてエラーを返す", async () => {
    const markJobFailed = vi.fn(async () => undefined);
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({ markJobFailed }),
      importQueue: {
        send: vi.fn(async () => {
          throw new Error("Queue unavailable");
        }),
      } as unknown as Queue<{ jobId: string }>,
      getCurrentDate: () => new Date("2026-06-01T00:00:00.000Z"),
    });

    const response = await testApp.request("/api/import/url/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", ...sameOriginHeaders },
      body: JSON.stringify({ url: "https://example.com/recipe" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown" },
    });
    expect(markJobFailed).toHaveBeenCalledWith({
      jobId: "job_123",
      errorCode: "unknown",
      errorMessage: "Queue unavailable",
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
  });

  it("recent jobsはactiveと未dismissの完了jobを返す", async () => {
    const expireActiveJobsForUser = vi.fn(async () => 1);
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        expireActiveJobsForUser,
        listRecentJobs: async () => [
          createJob({ id: "job_running", status: "running" }),
          createJob({
            id: "job_done",
            status: "succeeded",
            recipeId: "recipe_123",
            finishedAt: new Date("2026-06-01T00:01:00.000Z"),
          }),
        ],
      }),
      getCurrentDate: () => new Date("2026-06-01T00:10:00.000Z"),
    });

    const response = await testApp.request("/api/import/jobs/recent");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [
        { id: "job_running", status: "running", recipeId: null },
        { id: "job_done", status: "succeeded", recipeId: "recipe_123" },
      ],
    });
    expect(expireActiveJobsForUser).toHaveBeenCalledWith({
      userId: "user_123",
      expiresBefore: new Date("2026-06-01T00:00:00.000Z"),
      now: new Date("2026-06-01T00:10:00.000Z"),
    });
  });

  it("jobをdismissする", async () => {
    const testApp = createSilentTestApp({
      auth,
      importJobRepository: createRepository({
        dismissJob: async () =>
          createJob({
            status: "failed",
            errorCode: "fetch_failed",
            dismissedAt: new Date("2026-06-01T00:02:00.000Z"),
          }),
      }),
    });

    const response = await testApp.request("/api/import/jobs/job_123/dismiss", {
      method: "PATCH",
      headers: sameOriginHeaders,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: {
        id: "job_123",
        status: "failed",
        errorCode: "fetch_failed",
      },
    });
  });
});
