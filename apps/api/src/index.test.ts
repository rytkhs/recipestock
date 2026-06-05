import { afterEach, describe, expect, it, vi } from "vitest";
import { type BillingRepository } from "./billing";
import { type ImportJobRepository } from "./import-jobs";
import { createApp, handleImportQueueMessageError } from "./index";
import { type StripeBillingClient, StripeWebhookSignatureError } from "./stripe-billing";

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
    const testApp = createApp({ auth });

    const response = await testApp.request("/api/me", {}, env);

    expect(response.status).toBe(401);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("CSRF対象APIへのcross-site form POSTは403を返す", async () => {
    const testApp = createApp({ auth });

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
    const testApp = createApp({ auth });

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
    const testApp = createApp({
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
    const testApp = createApp({
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

  it("Stripe webhookはcross-site form POSTでもCSRF middlewareで止めない", async () => {
    const verifyWebhook = vi.fn<StripeBillingClient["verifyWebhook"]>(async () => {
      throw new StripeWebhookSignatureError();
    });
    const testApp = createApp({
      auth,
      billingRepository: {} as BillingRepository,
      stripeBillingClient: {
        createCustomer: async () => ({ id: "cus_123" }),
        createCheckoutSession: async () => ({ url: "https://checkout.stripe.com/session_123" }),
        createPortalSession: async () => ({ url: "https://billing.stripe.com/session_123" }),
        retrieveSubscription: async () => {
          throw new Error("should not retrieve subscription");
        },
        verifyWebhook,
      },
    });

    const response = await testApp.request(
      "/api/stripe/webhook",
      {
        method: "POST",
        body: "{}",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
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
