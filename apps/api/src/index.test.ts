import { afterEach, describe, expect, it, vi } from "vitest";
import { type BillingRepository } from "./billing";
import { type PushSender } from "./completion-notifications";
import { type ImportJobRecord, type ImportJobRepository } from "./import-jobs";
import { handleImportQueueMessage, handleImportQueueMessageError } from "./index";
import { createLogger, createMemoryLogSink } from "./logger";
import { type StripeBillingClient, StripeWebhookSignatureError } from "./stripe-billing";
import { createSilentTestApp } from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const auth = {
  getSession: async () => null,
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const env = {
  APP_ENV: "development",
  BETTER_AUTH_URL: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_SECRET_KEY: "sk_test",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
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

    expect(sentPayloads).toEqual([{ outcome: "succeeded", recipeId: "recipe_123" }]);
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

    expect(payloads).toEqual([{ outcome: "failed" }]);
    expect(JSON.stringify(payloads)).not.toMatch(/private|error|url|source|title/i);
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
    expect(payloads).toEqual([{ outcome: "failed" }]);
    expect(events).toEqual(["ack"]);
  });

  it("最終リトライ未満の予期しない例外はmessage.retryする", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { events, message } = createMessage(3);
    const repositoryEvents: string[] = [];

    await handleImportQueueMessageError({
      error: new Error("database failed"),
      importJobRepository: createRepository(repositoryEvents),
      message,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["retry:240"]);
    expect(repositoryEvents).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("最終リトライの予期しない例外はjobをfailedにしてackする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { events, message } = createMessage(4);
    const repositoryEvents: string[] = [];

    await handleImportQueueMessageError({
      error: new Error("database failed"),
      importJobRepository: createRepository(repositoryEvents),
      message,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(repositoryEvents).toEqual(["failed:unknown:database failed"]);
    expect(events).toEqual(["ack"]);
  });
});
