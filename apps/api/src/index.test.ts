import { env as workerEnv } from "cloudflare:workers";
import { isDatabaseUnavailableError } from "@recipestock/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BillingRepository } from "./billing";
import { type PushSender } from "./completion-notifications";
import { type Bindings } from "./env";
import { type ImportJobRecord, type ImportJobRepository } from "./import-jobs";
import worker, {
  handleDeadLetteredImportJobMessage,
  handleImportQueueMessage,
  handleImportQueueMessageError,
  ImportJobDeadLetteredError,
} from "./index";
import { createLogger, createMemoryLogSink } from "./logger";
import { type ErrorReporter } from "./monitoring";
import { type StripeBillingClient, StripeWebhookSignatureError } from "./stripe-billing";
import { createSilentTestApp, createTestAuth } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const auth = createTestAuth(null);

const createErrorReporter = () => {
  const reports: { error: unknown; context: Parameters<ErrorReporter["report"]>[1] }[] = [];
  const errorReporter: ErrorReporter = {
    report: (error, context) => {
      reports.push({ error, context });
    },
  };

  return { errorReporter, reports };
};

const requiredStringBindings = {
  DATABASE_URL: "postgresql://example",
  APP_ORIGIN: "https://app.example.com",
  BETTER_AUTH_SECRET: "secret",
  AUTH_EMAIL_FROM: "Recipe Stock <login@example.com>",
  RESEND_API_KEY: "re_test",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_SECRET_KEY: "sk_test",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  CLOUDFLARE_ACCOUNT_ID: "account",
  R2_BUCKET_NAME: "recipestock-images-test",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  VAPID_PUBLIC_KEY: "public-key",
  VAPID_PRIVATE_KEY: "private-key",
  VAPID_SUBJECT: "https://github.com/rytkhs/recipestock",
} satisfies Partial<Bindings>;

const env = {
  APP_ENV: "development",
  ...requiredStringBindings,
};

describe("API app composition", () => {
  it("APIレスポンスにsecure headersを付与する", async () => {
    const testApp = createSilentTestApp({ auth });

    const response = await testApp.request("/api/me", {}, env);

    expect(response.status).toBe(401);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("request loggerにloggerFactoryで作成したloggerを使う", async () => {
    const sink = createMemoryLogSink();
    const testApp = createSilentTestApp({
      auth,
      loggerFactory: (baseFields) => createLogger(baseFields, { sink }),
    });

    const response = await testApp.request("/api/me", {}, env);

    expect(response.status).toBe(401);
    expect(sink.entries).toEqual([
      expect.objectContaining({
        event: "api_request_completed",
        level: "warn",
        method: "GET",
        route: "/api/me",
        status: 401,
      }),
    ]);
  });

  it("外形監視用のhealthは依存先に触れずno-storeで200を返す", async () => {
    const testApp = createSilentTestApp({
      auth: {
        getSession: async () => {
          throw new Error("should not get session");
        },
        handleAuthRequest: async () => {
          throw new Error("should not handle auth");
        },
      },
    });

    const response = await testApp.request("/api/health", {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("ログのrequestIdをX-Request-IDとして返す", async () => {
    const sink = createMemoryLogSink();
    const testApp = createSilentTestApp({
      auth,
      loggerFactory: (baseFields) => createLogger(baseFields, { sink }),
    });

    const response = await testApp.request("/api/me", {}, env);

    expect(response.headers.get("x-request-id")).toEqual(expect.any(String));
    expect(sink.entries).toEqual([
      expect.objectContaining({
        event: "api_request_completed",
        requestId: response.headers.get("x-request-id"),
      }),
    ]);
  });

  it("予期しない例外は500にしてrequestIdとroute付きでerror reporterへ送る", async () => {
    const { errorReporter, reports } = createErrorReporter();
    const error = new Error("session store failed");
    const testApp = createSilentTestApp({
      auth: {
        getSession: async () => {
          throw error;
        },
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      errorReporter,
    });

    const response = await testApp.request("/api/me", {}, env);

    expect(response.status).toBe(500);
    expect(reports).toEqual([
      {
        error,
        context: {
          tags: { request_id: response.headers.get("x-request-id"), route: "/api/me" },
          userId: undefined,
        },
      },
    ]);
  });

  it("4xxのHTTPExceptionはerror reporterへ送らない", async () => {
    const { errorReporter, reports } = createErrorReporter();
    const testApp = createSilentTestApp({ auth, errorReporter });

    const response = await testApp.request(
      "/api/billing/checkout",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example.com",
          "sec-fetch-site": "cross-site",
        },
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(reports).toEqual([]);
  });

  it("CSRF対象APIへのcross-site form POSTは403を返す", async () => {
    const testApp = createSilentTestApp({ auth });

    const response = await testApp.request(
      "/api/billing/checkout",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example.com",
          "sec-fetch-site": "cross-site",
        },
      },
      env,
    );

    expect(response.status).toBe(403);
  });

  it("CSRF対象APIへのsame-origin form POSTは認証middlewareまで進む", async () => {
    const testApp = createSilentTestApp({ auth });

    const response = await testApp.request(
      "/api/billing/checkout",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://app.example.com",
          "sec-fetch-site": "same-origin",
        },
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    });
  });

  it("Auth APIは認証middlewareを通さずBetter Authへ委譲する", async () => {
    let getSessionCalls = 0;
    const testApp = createSilentTestApp({
      auth: {
        getSession: async () => {
          getSessionCalls += 1;
          return null;
        },
        handleAuthRequest: async () =>
          Response.json(
            {
              ok: true,
            },
            { status: 202 },
          ),
      },
    });

    const response = await testApp.request(
      "/api/auth/sign-out",
      {
        method: "POST",
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(getSessionCalls).toBe(0);
  });

  it("Auth APIはCSRF middlewareで止めずBetter Authへ委譲する", async () => {
    const testApp = createSilentTestApp({
      auth: {
        getSession: async () => {
          throw new Error("should not get session");
        },
        handleAuthRequest: async () => Response.json({ ok: true }, { status: 202 }),
      },
    });

    const response = await testApp.request(
      "/api/auth/sign-out",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example.com",
          "sec-fetch-site": "cross-site",
        },
      },
      env,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("Stripe webhookはcross-site POSTでもCSRF middlewareで止めない", async () => {
    const verifyWebhook = vi.fn<StripeBillingClient["verifyWebhook"]>(async () => {
      throw new StripeWebhookSignatureError();
    });
    const testApp = createSilentTestApp({
      auth,
      billingRepository: {} as BillingRepository,
      stripeBillingClient: {
        createCustomer: async () => ({ id: "cus_123" }),
        createCheckoutSession: async () => ({ url: "https://checkout.stripe.com/session_123" }),
        createPortalSession: async () => ({ url: "https://billing.stripe.com/session_123" }),
        retrieveSubscription: async () => {
          throw new Error("should not retrieve subscription");
        },
        retrievePrice: async () => {
          throw new Error("should not retrieve price");
        },
        listCustomerSubscriptions: async () => [],
        updateCustomerEmail: async () => {},
        verifyWebhook,
      },
    });

    const response = await testApp.request(
      "/api/stripe/webhook",
      {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example.com",
          "sec-fetch-site": "cross-site",
          "stripe-signature": "sig_test",
        },
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(verifyWebhook).toHaveBeenCalled();
  });
});

describe("import queue handler", () => {
  const createRepository = (events: string[] = []): ImportJobRepository =>
    ({
      markJobFailed: async ({ errorCode, errorMessage }) => {
        events.push(`failed:${errorCode}:${errorMessage}`);
      },
    }) as ImportJobRepository;

  const createMessage = (attempts: number) => {
    const events: string[] = [];

    return {
      events,
      message: {
        id: "message_123",
        attempts,
        body: { jobId: "job_123" },
        ack: () => {
          events.push("ack");
        },
        retry: ({ delaySeconds }: { delaySeconds: number }) => {
          events.push(`retry:${delaySeconds}`);
        },
      },
    };
  };

  const terminalJob = (overrides: Partial<ImportJobRecord> = {}): ImportJobRecord => ({
    id: "job_123",
    userId: "user_1",
    kind: "url",
    status: "succeeded",
    url: "https://private.example.com/recipe",
    normalizedUrl: "https://private.example.com/recipe",
    sourceText: null,
    recipeId: "recipe_123",
    errorCode: null,
    errorMessage: null,
    dismissedAt: null,
    completionNotificationRequested: true,
    completionNotificationSentAt: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    startedAt: new Date("2026-06-01T00:00:01.000Z"),
    finishedAt: new Date("2026-06-01T00:00:02.000Z"),
    updatedAt: new Date("2026-06-01T00:00:02.000Z"),
    ...overrides,
  });

  it("終端成功を全端末へ通知してaccepted後にtimestampを記録してackする", async () => {
    const { events, message } = createMessage(1);
    let job = terminalJob();
    const sentPayloads: unknown[] = [];
    const repository = {
      getJobById: async () => job,
      markCompletionNotificationSent: async ({ now }: { jobId: string; now: Date }) => {
        if (job.completionNotificationSentAt) return false;
        job = { ...job, completionNotificationSentAt: now };
        return true;
      },
    } as unknown as ImportJobRepository;
    const pushSender: PushSender = {
      sendToUser: async ({ payload }) => {
        sentPayloads.push(payload);
        return { acceptedCount: 2 };
      },
    };

    await handleImportQueueMessage({
      importJobRepository: repository,
      message,
      processJob: async () => {},
      pushSender,
      now: new Date("2026-06-01T00:00:03.000Z"),
    });

    expect(sentPayloads).toEqual([
      {
        outcome: "succeeded",
        recipeId: "recipe_123",
        notice: { title: expect.any(String), body: expect.any(String) },
      },
    ]);
    expect(JSON.stringify(sentPayloads)).not.toMatch(/private\.example|https?:\/\//);
    expect(job.completionNotificationSentAt).toEqual(new Date("2026-06-01T00:00:03.000Z"));
    expect(events).toEqual(["ack"]);
  });

  it.each([
    ["通常失敗", "unknown"],
    ["timeout", "job_timeout"],
    ["Recipe上限", "recipe_limit_exceeded"],
  ] as const)("%sの終端Jobをgenericな失敗として通知する", async (_label, errorCode) => {
    const { events, message } = createMessage(1);
    const payloads: unknown[] = [];
    const repository = {
      getJobById: async () =>
        terminalJob({
          status: "failed",
          recipeId: null,
          errorCode,
          errorMessage: "private failure detail",
        }),
      markCompletionNotificationSent: async () => true,
    } as unknown as ImportJobRepository;

    await handleImportQueueMessage({
      importJobRepository: repository,
      message,
      processJob: async () => {},
      pushSender: {
        sendToUser: async ({ payload }) => {
          payloads.push(payload);
          return { acceptedCount: 1 };
        },
      },
    });

    expect(payloads).toEqual([
      { outcome: "failed", notice: { title: expect.any(String), body: expect.any(String) } },
    ]);
    expect(JSON.stringify(payloads)).not.toMatch(/private\.example|private failure detail/);
    expect(JSON.stringify(payloads)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(payloads)).not.toContain(errorCode);
    expect(events).toEqual(["ack"]);
  });

  it.each([
    terminalJob({ status: "queued", finishedAt: null }),
    terminalJob({ status: "running", finishedAt: null }),
    terminalJob({ completionNotificationRequested: false }),
    terminalJob({ completionNotificationSentAt: new Date("2026-06-01T00:00:02.500Z") }),
  ])("通知対象外のJobは送信せずackする", async (job) => {
    const { events, message } = createMessage(1);
    const sendToUser = vi.fn<PushSender["sendToUser"]>();

    await handleImportQueueMessage({
      importJobRepository: {
        getJobById: async () => job,
      } as unknown as ImportJobRepository,
      message,
      processJob: async () => {},
      pushSender: { sendToUser },
    });

    expect(sendToUser).not.toHaveBeenCalled();
    expect(events).toEqual(["ack"]);
  });

  it("購読なしまたは全送信失敗ではtimestampを記録せずackする", async () => {
    const { events, message } = createMessage(1);
    const markCompletionNotificationSent = vi.fn(async () => true);

    await handleImportQueueMessage({
      importJobRepository: {
        getJobById: async () => terminalJob(),
        markCompletionNotificationSent,
      } as unknown as ImportJobRepository,
      message,
      processJob: async () => {},
      pushSender: { sendToUser: async () => ({ acceptedCount: 0 }) },
    });

    expect(markCompletionNotificationSent).not.toHaveBeenCalled();
    expect(events).toEqual(["ack"]);
  });

  it("Push sender例外がJobとRecipeの結果を変えずackする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { events, message } = createMessage(1);
    const job = terminalJob();
    const markCompletionNotificationSent = vi.fn(async () => true);

    await handleImportQueueMessage({
      importJobRepository: {
        getJobById: async () => job,
        markCompletionNotificationSent,
      } as unknown as ImportJobRepository,
      message,
      processJob: async () => {},
      pushSender: {
        sendToUser: async () => {
          throw new Error("encryption failed");
        },
      },
    });

    expect(job).toMatchObject({ status: "succeeded", recipeId: "recipe_123" });
    expect(markCompletionNotificationSent).not.toHaveBeenCalled();
    expect(events).toEqual(["ack"]);
  });

  it("通知済みtimestampにより同じJobを通常のqueue処理で重複通知しない", async () => {
    let job = terminalJob();
    const sendToUser = vi.fn<PushSender["sendToUser"]>(async () => ({ acceptedCount: 1 }));
    const repository = {
      getJobById: async () => job,
      markCompletionNotificationSent: async ({ now }: { jobId: string; now: Date }) => {
        if (job.completionNotificationSentAt) return false;
        job = { ...job, completionNotificationSentAt: now };
        return true;
      },
    } as unknown as ImportJobRepository;

    for (const attempts of [1, 2]) {
      await handleImportQueueMessage({
        importJobRepository: repository,
        message: createMessage(attempts).message,
        processJob: async () => {},
        pushSender: { sendToUser },
      });
    }

    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it("最大queue試行の例外をfailedへ永続化した後に失敗通知してackする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { events, message } = createMessage(4);
    let job = terminalJob({ status: "running", recipeId: null, finishedAt: null });
    const payloads: unknown[] = [];
    const repository = {
      getJobById: async () => job,
      markJobFailed: async ({
        errorCode,
        errorMessage,
        now,
      }: Parameters<ImportJobRepository["markJobFailed"]>[0]) => {
        job = { ...job, status: "failed", errorCode, errorMessage, finishedAt: now };
      },
      markCompletionNotificationSent: async () => true,
    } as unknown as ImportJobRepository;

    await handleImportQueueMessage({
      importJobRepository: repository,
      message,
      processJob: async () => {
        throw new Error("database failed");
      },
      pushSender: {
        sendToUser: async ({ payload }) => {
          payloads.push(payload);
          return { acceptedCount: 1 };
        },
      },
      now: new Date("2026-06-01T00:00:04.000Z"),
    });

    expect(job.status).toBe("failed");
    expect(payloads).toEqual([
      { outcome: "failed", notice: { title: expect.any(String), body: expect.any(String) } },
    ]);
    expect(events).toEqual(["ack"]);
  });

  it("最終リトライ未満の予期しない例外はmessage.retryし、error reporterへは送らない", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { errorReporter, reports } = createErrorReporter();
    const { events, message } = createMessage(3);
    const repositoryEvents: string[] = [];

    await handleImportQueueMessageError({
      error: new Error("database failed"),
      errorReporter,
      importJobRepository: createRepository(repositoryEvents),
      message,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["retry:240"]);
    expect(repositoryEvents).toEqual([]);
    expect(reports).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("最終リトライの予期しない例外はerror reporterへ送り、jobをfailedにしてackする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { errorReporter, reports } = createErrorReporter();
    const { events, message } = createMessage(4);
    const repositoryEvents: string[] = [];
    const error = new Error("database failed");

    await handleImportQueueMessageError({
      error,
      errorReporter,
      importJobRepository: createRepository(repositoryEvents),
      message,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(reports).toEqual([{ error, context: { tags: { attempts: 4, job_id: "job_123" } } }]);
    expect(repositoryEvents).toEqual(["failed:unknown:database failed"]);
    expect(events).toEqual(["ack"]);
  });
});

describe("import dead letter queue handler", () => {
  const createMessage = () => {
    const events: string[] = [];

    return {
      events,
      message: {
        id: "message_123",
        attempts: 1,
        body: { jobId: "job_123" },
        ack: () => {
          events.push("ack");
        },
        retry: () => {
          events.push("retry");
        },
      },
    };
  };

  it("DLQに落ちたJobを送信・ログしてから失敗に確定し、完了通知してackする", async () => {
    const sink = createMemoryLogSink();
    const { errorReporter, reports } = createErrorReporter();
    const { events, message } = createMessage();
    const now = new Date("2026-06-01T00:10:00.000Z");

    await handleDeadLetteredImportJobMessage({
      errorReporter,
      importJobRepository: {
        markJobFailed: async (params: Parameters<ImportJobRepository["markJobFailed"]>[0]) => {
          events.push(`failed:${params.jobId}:${params.errorCode}:${params.now.toISOString()}`);
        },
      } as ImportJobRepository,
      message,
      logger: createLogger({ jobId: "job_123", messageId: "message_123" }, { sink }),
      notifyCompletion: async () => {
        events.push("notified");
      },
      now,
    });

    expect(reports).toEqual([
      {
        error: expect.any(ImportJobDeadLetteredError),
        context: { tags: { area: "import_dlq", job_id: "job_123" } },
      },
    ]);
    expect(sink.entries).toEqual([
      expect.objectContaining({
        event: "import_job_dead_lettered",
        level: "error",
        jobId: "job_123",
        messageId: "message_123",
      }),
    ]);
    expect(events).toEqual(["failed:job_123:unknown:2026-06-01T00:10:00.000Z", "notified", "ack"]);
  });

  it("失敗に確定できなければackせずthrowしてDLQの再試行に任せる", async () => {
    const { errorReporter } = createErrorReporter();
    const { events, message } = createMessage();
    const error = new Error("database failed");

    await expect(
      handleDeadLetteredImportJobMessage({
        errorReporter,
        importJobRepository: {
          markJobFailed: async () => {
            throw error;
          },
        } as unknown as ImportJobRepository,
        message,
        logger: createLogger({}, { sink: createMemoryLogSink() }),
        notifyCompletion: async () => {
          events.push("notified");
        },
      }),
    ).rejects.toBe(error);

    expect(events).toEqual([]);
  });

  // 外へ出た例外はWorkers Logsにも残る。default exportを通して、出る時点で引数が消えていることを固定する。
  it("失敗に確定できなかったqueryの引数を、handlerの外へ投げる例外に残さない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const ack = vi.fn();
    const batch = {
      queue: "recipestock-import-jobs-dlq",
      messages: [
        {
          id: "message_123",
          timestamp: new Date("2026-06-01T00:00:00.000Z"),
          attempts: 1,
          body: { jobId: "job_123" },
          ack,
          retry: vi.fn(),
        },
      ],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<{ jobId: string }>;
    const ctx = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext;

    const error = await Promise.resolve(
      worker.queue?.(
        batch,
        {
          ...(workerEnv as Bindings),
          ...requiredStringBindings,
          DATABASE_URL: "postgresql://user:password@db.example.com/recipestock",
        },
        ctx,
      ),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    const { message, stack } = error as Error;
    expect(message).toMatch(/^Failed query: update "import_jobs"/);
    expect(`${message}\n${stack}`).not.toMatch(/params:|job_123/);
    // 書き換えた同じ例外なので、Sentryは元のNeonの失敗をたどって障害としてまとめられる。
    expect(isDatabaseUnavailableError(error)).toBe(true);
    expect(ack).not.toHaveBeenCalled();
  });
});

describe("cron handler", () => {
  // withSentryはenvのQueueをProxyで包み、Proxy越しのmetrics()はIllegal invocationで落ちる。
  // default exportを通して、包まれた状態でも滞留の確認がcheck-inまで進むことを固定する。
  it("withSentryで包んだscheduledでもImport Queueのmetricsを読める", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext;

    await worker.scheduled?.(
      { cron: "*/5 * * * *", scheduledTime: Date.now(), noRetry: () => undefined },
      { ...(workerEnv as Bindings), ...requiredStringBindings },
      ctx,
    );
    await Promise.all(pending);

    const events = [...info.mock.calls, ...error.mock.calls].map(
      ([line]) => JSON.parse(String(line)).event,
    );
    expect(events).toContain("import_queue_health_checked");
  });
});
