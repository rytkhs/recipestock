import { describe, expect, it, vi } from "vitest";
import { type ImportJobRecord, type ImportJobRepository } from "../import-jobs";
import { type ShortcutCredentials } from "../shortcut-credentials";
import { createSilentTestApp } from "../test-helpers";

const env = {
  APP_ENV: "development",
  BETTER_AUTH_URL: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
};

const auth = {
  getSession: async () => ({ user: { id: "user_1", email: "chef@example.com" } }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const createJob = (overrides: Partial<ImportJobRecord> = {}): ImportJobRecord => ({
  id: "job_123",
  userId: "user_1",
  kind: "url",
  status: "queued",
  url: "https://example.com/recipe",
  normalizedUrl: "https://example.com/recipe",
  recipeId: null,
  errorCode: null,
  errorMessage: null,
  dismissedAt: null,
  createdVia: "ios_shortcut",
  completionNotificationRequested: true,
  completionNotificationSentAt: null,
  createdAt: new Date("2026-07-11T00:00:00.000Z"),
  startedAt: null,
  finishedAt: null,
  updatedAt: new Date("2026-07-11T00:00:00.000Z"),
  ...overrides,
});

const createImportJobRepository = (
  overrides: Partial<ImportJobRepository> = {},
): ImportJobRepository => ({
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

const createShortcutCredentialsFake = (): ShortcutCredentials => ({
  issue: async () => {
    throw new Error("Not used by this route.");
  },
  list: async () => [],
  revoke: async () => true,
  authenticate: async ({ token }) =>
    token.startsWith("rssc_") ? { credentialId: "credential_1", userId: "user_1" } : null,
});

const shortcutRequest = {
  url: "https://example.com/recipe",
  requestId: "550e8400-e29b-41d4-a716-446655440000",
};

const shortcutHeaders = {
  authorization: `Bearer rssc_${"a".repeat(64)}`,
  "content-type": "application/json",
};

const createRateLimiter = (success = true) => ({
  limit: vi.fn(async () => ({ success })),
});

describe("iOS Share routes", () => {
  it("有効なBearerとURL/UUIDでImport Jobを作成しQueueへ一度送る", async () => {
    const send = vi.fn(async () => undefined);
    const createUrlJob = vi.fn(async () => ({
      status: "created" as const,
      job: createJob(),
    }));
    const rateLimiter = createRateLimiter();
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ createUrlJob }),
      importQueue: { send } as unknown as Queue<{ jobId: string }>,
      createImportJobId: () => "job_123",
      shortcutRateLimiter: rateLimiter as unknown as RateLimit,
      getCurrentDate: () => new Date("2026-07-11T00:00:00.000Z"),
    });

    const response = await app.request(
      "/api/ios-share/shortcut/import-jobs",
      {
        method: "POST",
        headers: shortcutHeaders,
        body: JSON.stringify(shortcutRequest),
      },
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      kind: "created",
      job: { id: "job_123", status: "queued" },
    });
    expect(createUrlJob).toHaveBeenCalledWith({
      id: "job_123",
      userId: "user_1",
      url: shortcutRequest.url,
      normalizedUrl: shortcutRequest.url,
      createdVia: "ios_shortcut",
      requestId: shortcutRequest.requestId,
      completionNotificationRequested: true,
      now: new Date("2026-07-11T00:00:00.000Z"),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ jobId: "job_123" }, { contentType: "json" });
    expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "credential_1" });
  });

  it("Cookie sessionだけではShortcut Import Jobを作成できない", async () => {
    const rateLimiter = createRateLimiter();
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      shortcutRateLimiter: rateLimiter as unknown as RateLimit,
    });

    const response = await app.request(
      "/api/ios-share/shortcut/import-jobs",
      {
        method: "POST",
        headers: {
          cookie: "better-auth.session_token=session",
          "content-type": "application/json",
        },
        body: JSON.stringify(shortcutRequest),
      },
      env,
    );

    expect(response.status).toBe(401);
    expect(rateLimiter.limit).not.toHaveBeenCalled();
  });

  it("Shortcut Bearer tokenをCookie保護されたresourceの認証に使えない", async () => {
    const app = createSilentTestApp({
      auth: { ...auth, getSession: async () => null },
      shortcutCredentials: createShortcutCredentialsFake(),
    });

    const responses = await Promise.all(
      ["/api/recipes", "/api/import/jobs/recent", "/api/me", "/api/push-subscriptions"].map(
        (path) =>
          app.request(path, { headers: { authorization: shortcutHeaders.authorization } }, env),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
  });

  it("Bearerがない、無効、revoke済みの場合は401を返す", async () => {
    const revokedService = createShortcutCredentialsFake();
    revokedService.authenticate = async () => null;
    const app = createSilentTestApp({ auth, shortcutCredentials: revokedService });

    const responses = await Promise.all([
      app.request(
        "/api/ios-share/shortcut/import-jobs",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(shortcutRequest),
        },
        env,
      ),
      app.request(
        "/api/ios-share/shortcut/import-jobs",
        {
          method: "POST",
          headers: { ...shortcutHeaders, authorization: "Bearer invalid" },
          body: JSON.stringify(shortcutRequest),
        },
        env,
      ),
      app.request(
        "/api/ios-share/shortcut/import-jobs",
        {
          method: "POST",
          headers: shortcutHeaders,
          body: JSON.stringify(shortcutRequest),
        },
        env,
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  });

  it("UUIDでないrequestIdはrate limit後にvalidation_failedを返す", async () => {
    const rateLimiter = createRateLimiter();
    const createUrlJob = vi.fn(async () => ({
      status: "created" as const,
      job: createJob(),
    }));
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ createUrlJob }),
      shortcutRateLimiter: rateLimiter as unknown as RateLimit,
    });

    const response = await app.request(
      "/api/ios-share/shortcut/import-jobs",
      {
        method: "POST",
        headers: shortcutHeaders,
        body: JSON.stringify({ ...shortcutRequest, requestId: "not-a-uuid" }),
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
    expect(rateLimiter.limit).toHaveBeenCalledTimes(1);
    expect(createUrlJob).not.toHaveBeenCalled();
  });

  it("FTP URLはinvalid_urlを返す", async () => {
    const rateLimiter = createRateLimiter();
    const createUrlJob = vi.fn(async () => ({
      status: "created" as const,
      job: createJob(),
    }));
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ createUrlJob }),
      shortcutRateLimiter: rateLimiter as unknown as RateLimit,
    });

    const response = await app.request(
      "/api/ios-share/shortcut/import-jobs",
      {
        method: "POST",
        headers: shortcutHeaders,
        body: JSON.stringify({ ...shortcutRequest, url: "ftp://example.com/recipe" }),
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_url" } });
    expect(createUrlJob).not.toHaveBeenCalled();
  });

  it("同じrequestIdの再送は同じJobを返しQueueへ追加しない", async () => {
    const send = vi.fn(async () => undefined);
    const createUrlJob = vi
      .fn<ImportJobRepository["createUrlJob"]>()
      .mockResolvedValueOnce({ status: "created", job: createJob() })
      .mockResolvedValueOnce({
        status: "replayedRequest",
        responseKind: "created",
        job: createJob(),
      });
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ createUrlJob }),
      importQueue: { send } as unknown as Queue<{ jobId: string }>,
      shortcutRateLimiter: createRateLimiter() as unknown as RateLimit,
    });

    const request = () =>
      app.request(
        "/api/ios-share/shortcut/import-jobs",
        {
          method: "POST",
          headers: shortcutHeaders,
          body: JSON.stringify(shortcutRequest),
        },
        env,
      );

    const first = await request();
    const second = await request();
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({ kind: "created" });
    expect(createUrlJob).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("active Web Jobを再利用すると通知要求だけを有効にしQueueへ追加しない", async () => {
    const send = vi.fn(async () => undefined);
    const createUrlJob = vi.fn(async () => ({
      status: "existingActiveJob" as const,
      job: createJob({
        createdVia: "web",
        completionNotificationRequested: true,
      }),
    }));
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ createUrlJob }),
      importQueue: { send } as unknown as Queue<{ jobId: string }>,
      shortcutRateLimiter: createRateLimiter() as unknown as RateLimit,
    });

    const response = await app.request(
      "/api/ios-share/shortcut/import-jobs",
      {
        method: "POST",
        headers: shortcutHeaders,
        body: JSON.stringify(shortcutRequest),
      },
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ kind: "existing_active_job" });
    expect(createUrlJob).toHaveBeenCalledWith(
      expect.objectContaining({
        createdVia: "ios_shortcut",
        completionNotificationRequested: true,
      }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("1 credentialあたり10回を超えると429を返す", async () => {
    let calls = 0;
    const rateLimiter = {
      limit: vi.fn(async ({ key }: { key: string }) => {
        expect(key).toBe("credential_1");
        calls += 1;
        return { success: calls <= 10 };
      }),
    };
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      urlImportJobSubmission: {
        submit: async () => ({ status: "accepted", kind: "created", job: createJob() }),
      },
      shortcutRateLimiter: rateLimiter as unknown as RateLimit,
    });

    const responses = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        app.request(
          "/api/ios-share/shortcut/import-jobs",
          {
            method: "POST",
            headers: shortcutHeaders,
            body: JSON.stringify({
              ...shortcutRequest,
              requestId: `550e8400-e29b-41d4-a716-4466554400${String(index).padStart(2, "0")}`,
            }),
          },
          env,
        ),
      ),
    );

    expect(responses.filter((response) => response.status === 202)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    await expect(responses.at(-1)?.json()).resolves.toMatchObject({
      error: { code: "rate_limit_exceeded" },
    });
  });

  it("Queue送信失敗時はJobをfailedにして500を返す", async () => {
    const markJobFailed = vi.fn(async () => undefined);
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ markJobFailed }),
      importQueue: {
        send: vi.fn(async () => {
          throw new Error("Queue unavailable");
        }),
      } as unknown as Queue<{ jobId: string }>,
      shortcutRateLimiter: createRateLimiter() as unknown as RateLimit,
      getCurrentDate: () => new Date("2026-07-11T00:00:00.000Z"),
    });

    const response = await app.request(
      "/api/ios-share/shortcut/import-jobs",
      {
        method: "POST",
        headers: shortcutHeaders,
        body: JSON.stringify(shortcutRequest),
      },
      env,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unknown" } });
    expect(markJobFailed).toHaveBeenCalledWith({
      jobId: "job_123",
      errorCode: "unknown",
      errorMessage: "Queue unavailable",
      now: new Date("2026-07-11T00:00:00.000Z"),
    });
  });
});
