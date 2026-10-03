import { env as workerEnv } from "cloudflare:workers";
import { isDatabaseUnavailableError } from "@recipestock/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BillingRepository } from "./billing";
import { type Bindings } from "./env";
import worker from "./index";
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
          return { session: null, setCookies: [] };
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

describe("queue handler", () => {
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
  // withSentryはenvのQueueをProxyで包む。@sentry/cloudflare 10ではProxy越しのmetrics()が
  // Illegal invocationで落ちた。default exportを通して、包まれた状態でも滞留の確認がcheck-inまで進むことを固定する。
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
