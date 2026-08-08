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

const shortcutHeaders = {
  authorization: `Bearer rssc_${"a".repeat(64)}`,
  "content-type": "application/json",
  "x-shortcut-version": "1",
};

const createRateLimiter = (success = true) => ({
  limit: vi.fn(async () => ({ success })),
});

const shareRequest = (input = "https://example.com/recipe") => ({
  method: "POST",
  headers: shortcutHeaders,
  body: JSON.stringify({ input }),
});

describe("iOS Share routes", () => {
  it("共有入力からImport Jobを作成しQueueへ一度送る", async () => {
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

    const response = await app.request("/api/ios-share/shortcut/import-jobs", shareRequest(), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: "accepted",
      reason: "created",
      notice: {
        title: "取り込みを開始しました",
        body: "完了したらお知らせします。",
        openUrl: null,
      },
    });
    expect(createUrlJob).toHaveBeenCalledWith({
      id: "job_123",
      userId: "user_1",
      url: "https://example.com/recipe",
      normalizedUrl: "https://example.com/recipe",
      completionNotificationRequested: true,
      now: new Date("2026-07-11T00:00:00.000Z"),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ jobId: "job_123" }, { contentType: "json" });
    expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "credential_1" });
  });

  it("共有テキストに埋め込まれたURLを取り出して取り込む", async () => {
    const createUrlJob = vi.fn(async () => ({
      status: "created" as const,
      job: createJob(),
    }));
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ createUrlJob }),
      importQueue: { send: async () => undefined } as unknown as Queue<{ jobId: string }>,
      shortcutRateLimiter: createRateLimiter() as unknown as RateLimit,
    });

    const response = await app.request(
      "/api/ios-share/shortcut/import-jobs",
      shareRequest("この唐揚げ美味しそう https://example.com/recipe。 #レシピ"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: "created" });
    expect(createUrlJob).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/recipe" }),
    );
  });

  it("URLを含まない共有入力はJobを作らずno_url_in_inputを返す", async () => {
    const createUrlJob = vi.fn(async () => ({
      status: "created" as const,
      job: createJob(),
    }));
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ createUrlJob }),
      shortcutRateLimiter: createRateLimiter() as unknown as RateLimit,
    });

    const responses = await Promise.all([
      app.request("/api/ios-share/shortcut/import-jobs", shareRequest("レシピのスクショです"), env),
      app.request(
        "/api/ios-share/shortcut/import-jobs",
        shareRequest("ftp://example.com/recipe"),
        env,
      ),
      app.request("/api/ios-share/shortcut/import-jobs", shareRequest("a".repeat(8193)), env),
      app.request(
        "/api/ios-share/shortcut/import-jobs",
        { method: "POST", headers: shortcutHeaders, body: "not json" },
        env,
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({
        outcome: "rejected",
        reason: "no_url_in_input",
      });
    }
    expect(createUrlJob).not.toHaveBeenCalled();
  });

  it("取り込めないURLはinvalid_urlを返す", async () => {
    const createUrlJob = vi.fn(async () => ({
      status: "created" as const,
      job: createJob(),
    }));
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({ createUrlJob }),
      shortcutRateLimiter: createRateLimiter() as unknown as RateLimit,
    });

    const response = await app.request(
      "/api/ios-share/shortcut/import-jobs",
      shareRequest(`https://example.com/${"a".repeat(4097)}`),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "rejected",
      reason: "invalid_url",
    });
    expect(createUrlJob).not.toHaveBeenCalled();
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
        body: JSON.stringify({ input: "https://example.com/recipe" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: "unauthorized" });
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

  it("Bearerがない、無効、revoke済みの場合は再連携を促すnoticeを返す", async () => {
    const revokedService = createShortcutCredentialsFake();
    revokedService.authenticate = async () => null;
    const app = createSilentTestApp({ auth, shortcutCredentials: revokedService });

    const responses = await Promise.all([
      app.request(
        "/api/ios-share/shortcut/import-jobs",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: "https://example.com/recipe" }),
        },
        env,
      ),
      app.request(
        "/api/ios-share/shortcut/import-jobs",
        {
          method: "POST",
          headers: { ...shortcutHeaders, authorization: "Bearer invalid" },
          body: JSON.stringify({ input: "https://example.com/recipe" }),
        },
        env,
      ),
      app.request("/api/ios-share/shortcut/import-jobs", shareRequest(), env),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({
        outcome: "rejected",
        reason: "unauthorized",
        notice: { openUrl: "https://app.example.com/settings" },
      });
    }
  });

  it("active Jobを再利用すると通知要求だけを有効にしQueueへ追加しない", async () => {
    const send = vi.fn(async () => undefined);
    const createUrlJob = vi.fn(async () => ({
      status: "existingActiveJob" as const,
      job: createJob({
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

    const response = await app.request("/api/ios-share/shortcut/import-jobs", shareRequest(), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "accepted",
      reason: "existing_active_job",
    });
    expect(createUrlJob).toHaveBeenCalledWith(
      expect.objectContaining({
        completionNotificationRequested: true,
      }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("Recipe上限時はアップセル先を含むnoticeを返しQueueへ追加しない", async () => {
    const send = vi.fn(async () => undefined);
    const app = createSilentTestApp({
      auth,
      shortcutCredentials: createShortcutCredentialsFake(),
      importJobRepository: createImportJobRepository({
        createUrlJob: async () => ({ status: "limitExceeded" }),
      }),
      importQueue: { send } as unknown as Queue<{ jobId: string }>,
      shortcutRateLimiter: createRateLimiter() as unknown as RateLimit,
    });

    const response = await app.request("/api/ios-share/shortcut/import-jobs", shareRequest(), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "rejected",
      reason: "recipe_limit_exceeded",
      notice: {
        openUrl: "https://app.example.com/settings/billing?upsell=recipe_limit&from=shortcut",
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("1 credentialあたり10回を超えるとrate_limit_exceededを返す", async () => {
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
      Array.from({ length: 11 }, () =>
        app.request("/api/ios-share/shortcut/import-jobs", shareRequest(), env),
      ),
    );
    const reasons = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(200);
        return (await response.json<{ reason: string }>()).reason;
      }),
    );

    expect(reasons.filter((reason) => reason === "created")).toHaveLength(10);
    expect(reasons.filter((reason) => reason === "rate_limit_exceeded")).toHaveLength(1);
  });

  it("Queue送信失敗時はJobをfailedにしてtemporarily_unavailableを返す", async () => {
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

    const response = await app.request("/api/ios-share/shortcut/import-jobs", shareRequest(), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "rejected",
      reason: "temporarily_unavailable",
    });
    expect(markJobFailed).toHaveBeenCalledWith({
      jobId: "job_123",
      errorCode: "unknown",
      errorMessage: "Queue unavailable",
      now: new Date("2026-07-11T00:00:00.000Z"),
    });
  });
});
