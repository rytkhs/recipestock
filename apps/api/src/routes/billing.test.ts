import { describe, expect, it, vi } from "vitest";
import { type BillingRepository } from "../billing";
import { createLogger, createMemoryLogSink } from "../logger";
import { type StripeBillingClient } from "../stripe-billing";
import { createSilentTestApp, createTestAuth, sameOriginHeaders } from "../test-helpers";

const env = {
  APP_ENV: "development",
  APP_ORIGIN: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_SECRET_KEY: "sk_test",
};

const auth = createTestAuth();

const sameOriginPost = { method: "POST", headers: sameOriginHeaders };

const createRepository = (overrides: Partial<BillingRepository> = {}): BillingRepository => ({
  getBillingStatus: async () => ({
    plan: "free",
    subscription: null,
  }),
  getOrCreateAppUserBillingState: async (userId) => ({
    userId,
    plan: "free",
    stripeCustomerId: null,
  }),
  hasProcessedStripeEvent: async () => false,
  listSubscriptionsByUserId: async () => [],
  markStripeEventProcessed: async () => {},
  setStripeCustomerId: async () => {},
  syncAppUserPlanFromSubscriptions: async () => "free",
  upsertSubscriptionFromStripeEvent: async () => {},
  ...overrides,
});

const createStripeClient = (overrides: Partial<StripeBillingClient> = {}): StripeBillingClient => ({
  createCustomer: async () => ({ id: "cus_123" }),
  createCheckoutSession: async () => ({ url: "https://checkout.stripe.com/session_123" }),
  createPortalSession: async () => ({ url: "https://billing.stripe.com/session_123" }),
  retrieveSubscription: async () => ({
    userId: "user_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    stripePriceId: "price_pro",
    stripeProductId: "prod_123",
    status: "active",
    currentPeriodStart: new Date("2026-06-04T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-07-04T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
  }),
  retrievePrice: async () => ({
    unitAmount: 480,
    currency: "jpy",
    recurringInterval: "month",
    recurringIntervalCount: 1,
  }),
  listCustomerSubscriptions: async () => [],
  updateCustomerEmail: async () => {},
  verifyWebhook: async () => ({
    kind: "noop",
    eventId: "evt_123",
    eventCreatedAt: new Date("2026-06-04T00:00:00.000Z"),
    type: "invoice.payment_failed",
  }),
  ...overrides,
});

describe("Billing routes", () => {
  it("未ログイン時はCheckoutを作らずunauthorizedを返す", async () => {
    const stripeClient = createStripeClient({
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
      updateCustomerEmail: vi.fn(),
    });
    const testApp = createSilentTestApp({
      auth: createTestAuth(null),
      billingRepository: createRepository({
        getOrCreateAppUserBillingState: async () => {
          throw new Error("should not load billing state without a session");
        },
      }),
      stripeBillingClient: stripeClient,
    });

    const response = await testApp.request("/api/billing/checkout", sameOriginPost, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    });
    expect(stripeClient.createCustomer).not.toHaveBeenCalled();
    expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
    expect(stripeClient.updateCustomerEmail).not.toHaveBeenCalled();
  });

  it("未ログイン時はPortalを作らずunauthorizedを返す", async () => {
    const stripeClient = createStripeClient({
      createCustomer: vi.fn(),
      createPortalSession: vi.fn(),
      updateCustomerEmail: vi.fn(),
    });
    const testApp = createSilentTestApp({
      auth: createTestAuth(null),
      billingRepository: createRepository({
        getOrCreateAppUserBillingState: async () => {
          throw new Error("should not load billing state without a session");
        },
      }),
      stripeBillingClient: stripeClient,
    });

    const response = await testApp.request("/api/billing/portal", sameOriginPost, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    });
    expect(stripeClient.createCustomer).not.toHaveBeenCalled();
    expect(stripeClient.createPortalSession).not.toHaveBeenCalled();
    expect(stripeClient.updateCustomerEmail).not.toHaveBeenCalled();
  });

  it("Stripe Customer未作成のFreeユーザーはCustomerを作成してCheckout URLを返す", async () => {
    const calls: string[] = [];
    const setStripeCustomerId = vi.fn<(userId: string, stripeCustomerId: string) => Promise<void>>(
      async (userId, stripeCustomerId) => {
        calls.push(`save-customer:${userId}:${stripeCustomerId}`);
      },
    );
    const createCustomer = vi.fn<StripeBillingClient["createCustomer"]>(async ({ userId }) => {
      calls.push(`create-customer:${userId}`);
      return { id: "cus_123" };
    });
    const createCheckoutSession = vi.fn<StripeBillingClient["createCheckoutSession"]>(
      async (params) => {
        calls.push(`create-checkout:${params.stripeCustomerId}`);
        return { url: "https://checkout.stripe.com/session_123" };
      },
    );
    const updateCustomerEmail = vi.fn<StripeBillingClient["updateCustomerEmail"]>();
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({ setStripeCustomerId }),
      stripeBillingClient: createStripeClient({
        createCustomer,
        createCheckoutSession,
        updateCustomerEmail,
      }),
      getCurrentDate: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const response = await testApp.request("/api/billing/checkout", sameOriginPost, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.com/session_123",
    });
    expect(createCustomer).toHaveBeenCalledWith({
      email: "user@example.com",
      userId: "user_123",
    });
    expect(setStripeCustomerId).toHaveBeenCalledWith("user_123", "cus_123");
    expect(updateCustomerEmail).not.toHaveBeenCalled();
    expect(createCheckoutSession).toHaveBeenCalledWith({
      userId: "user_123",
      stripeCustomerId: "cus_123",
      proPriceId: "price_pro",
      successUrl: "https://app.example.com/settings/billing?checkout=success",
      cancelUrl: "https://app.example.com/settings/billing?checkout=cancel",
    });
    expect(calls).toEqual([
      "create-customer:user_123",
      "save-customer:user_123:cus_123",
      "create-checkout:cus_123",
    ]);
  });

  it("Stripe Customer作成済みならCustomerを再作成せずCheckoutを作る", async () => {
    const calls: string[] = [];
    const createCustomer = vi.fn<StripeBillingClient["createCustomer"]>();
    const createCheckoutSession = vi.fn<StripeBillingClient["createCheckoutSession"]>(
      async (params) => {
        calls.push(`create-checkout:${params.stripeCustomerId}`);
        return { url: "https://checkout.stripe.com/session_456" };
      },
    );
    const updateCustomerEmail = vi.fn<StripeBillingClient["updateCustomerEmail"]>(
      async (params) => {
        calls.push(`update-customer-email:${params.stripeCustomerId}:${params.email}`);
      },
    );
    const setStripeCustomerId = vi.fn<BillingRepository["setStripeCustomerId"]>();
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({
        getOrCreateAppUserBillingState: async (userId) => ({
          userId,
          plan: "free",
          stripeCustomerId: "cus_existing",
        }),
        setStripeCustomerId,
      }),
      stripeBillingClient: createStripeClient({
        createCustomer,
        createCheckoutSession,
        updateCustomerEmail,
      }),
    });

    const response = await testApp.request("/api/billing/checkout", sameOriginPost, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.com/session_456",
    });
    expect(createCustomer).not.toHaveBeenCalled();
    expect(setStripeCustomerId).not.toHaveBeenCalled();
    expect(updateCustomerEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      stripeCustomerId: "cus_existing",
      userId: "user_123",
    });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeCustomerId: "cus_existing",
      }),
    );
    expect(calls).toEqual([
      "update-customer-email:cus_existing:user@example.com",
      "create-checkout:cus_existing",
    ]);
  });

  it("webhookが届く前でも、StripeにProの契約があれば二つ目のCheckoutを作らない", async () => {
    const listCustomerSubscriptions = vi.fn<StripeBillingClient["listCustomerSubscriptions"]>(
      async () => [{ stripePriceId: "price_pro", status: "active", currentPeriodEnd: null }],
    );
    const createCheckoutSession = vi.fn<StripeBillingClient["createCheckoutSession"]>();
    const updateCustomerEmail = vi.fn<StripeBillingClient["updateCustomerEmail"]>();
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({
        getOrCreateAppUserBillingState: async (userId) => ({
          userId,
          plan: "free",
          stripeCustomerId: "cus_existing",
        }),
      }),
      stripeBillingClient: createStripeClient({
        listCustomerSubscriptions,
        createCheckoutSession,
        updateCustomerEmail,
      }),
    });

    const response = await testApp.request("/api/billing/checkout", sameOriginPost, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "already_subscribed" },
    });
    expect(listCustomerSubscriptions).toHaveBeenCalledWith({ stripeCustomerId: "cus_existing" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(updateCustomerEmail).not.toHaveBeenCalled();
  });

  it("StripeにあるのがProでない契約だけなら、Checkoutを作る", async () => {
    const createCheckoutSession = vi.fn<StripeBillingClient["createCheckoutSession"]>(async () => ({
      url: "https://checkout.stripe.com/session_456",
    }));
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({
        getOrCreateAppUserBillingState: async (userId) => ({
          userId,
          plan: "free",
          stripeCustomerId: "cus_existing",
        }),
      }),
      stripeBillingClient: createStripeClient({
        listCustomerSubscriptions: async () => [
          { stripePriceId: "price_pro", status: "incomplete", currentPeriodEnd: null },
          { stripePriceId: "price_other", status: "active", currentPeriodEnd: null },
        ],
        createCheckoutSession,
      }),
    });

    const response = await testApp.request("/api/billing/checkout", sameOriginPost, env);

    expect(response.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalled();
  });

  it("Stripe Customerがまだなければ、Stripeの契約を問い合わせない", async () => {
    const listCustomerSubscriptions = vi.fn<StripeBillingClient["listCustomerSubscriptions"]>(
      async () => [],
    );
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository(),
      stripeBillingClient: createStripeClient({ listCustomerSubscriptions }),
    });

    const response = await testApp.request("/api/billing/checkout", sameOriginPost, env);

    expect(response.status).toBe(200);
    expect(listCustomerSubscriptions).not.toHaveBeenCalled();
  });

  it("Checkout前のCustomer email同期が失敗してもCheckoutを作る", async () => {
    const createCheckoutSession = vi.fn<StripeBillingClient["createCheckoutSession"]>(async () => ({
      url: "https://checkout.stripe.com/session_456",
    }));
    const updateCustomerEmail = vi.fn<StripeBillingClient["updateCustomerEmail"]>(async () => {
      throw new Error("Stripe update failed.");
    });
    const sink = createMemoryLogSink();
    const testApp = createSilentTestApp({
      auth,
      loggerFactory: (baseFields) => createLogger(baseFields, { sink }),
      billingRepository: createRepository({
        getOrCreateAppUserBillingState: async (userId) => ({
          userId,
          plan: "free",
          stripeCustomerId: "cus_existing",
        }),
      }),
      stripeBillingClient: createStripeClient({
        createCheckoutSession,
        updateCustomerEmail,
      }),
    });

    const response = await testApp.request("/api/billing/checkout", sameOriginPost, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.com/session_456",
    });
    expect(updateCustomerEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      stripeCustomerId: "cus_existing",
      userId: "user_123",
    });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeCustomerId: "cus_existing",
      }),
    );
    expect(sink.entries).toContainEqual(
      expect.objectContaining({
        event: "stripe_customer_email_sync_failed",
        level: "error",
        stripeCustomerId: "cus_existing",
        userId: "user_123",
      }),
    );
  });

  it("Stripe Customer未作成ユーザーはCustomerを作成してPortal URLを返す", async () => {
    const calls: string[] = [];
    const setStripeCustomerId = vi.fn<(userId: string, stripeCustomerId: string) => Promise<void>>(
      async (userId, stripeCustomerId) => {
        calls.push(`save-customer:${userId}:${stripeCustomerId}`);
      },
    );
    const createCustomer = vi.fn<StripeBillingClient["createCustomer"]>(async ({ userId }) => {
      calls.push(`create-customer:${userId}`);
      return { id: "cus_123" };
    });
    const createPortalSession = vi.fn<StripeBillingClient["createPortalSession"]>(
      async (params) => {
        calls.push(`create-portal:${params.stripeCustomerId}`);
        return { url: "https://billing.stripe.com/session_123" };
      },
    );
    const updateCustomerEmail = vi.fn<StripeBillingClient["updateCustomerEmail"]>();
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({ setStripeCustomerId }),
      stripeBillingClient: createStripeClient({
        createCustomer,
        createPortalSession,
        updateCustomerEmail,
      }),
    });

    const response = await testApp.request("/api/billing/portal", sameOriginPost, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://billing.stripe.com/session_123",
    });
    expect(createCustomer).toHaveBeenCalledWith({
      email: "user@example.com",
      userId: "user_123",
    });
    expect(setStripeCustomerId).toHaveBeenCalledWith("user_123", "cus_123");
    expect(updateCustomerEmail).not.toHaveBeenCalled();
    expect(createPortalSession).toHaveBeenCalledWith({
      stripeCustomerId: "cus_123",
      returnUrl: "https://app.example.com/settings/billing",
    });
    expect(calls).toEqual([
      "create-customer:user_123",
      "save-customer:user_123:cus_123",
      "create-portal:cus_123",
    ]);
  });

  it("Stripe Customer作成済みならCustomerを再作成せずPortalを作る", async () => {
    const calls: string[] = [];
    const createCustomer = vi.fn<StripeBillingClient["createCustomer"]>();
    const createPortalSession = vi.fn<StripeBillingClient["createPortalSession"]>(
      async (params) => {
        calls.push(`create-portal:${params.stripeCustomerId}`);
        return { url: "https://billing.stripe.com/session_456" };
      },
    );
    const updateCustomerEmail = vi.fn<StripeBillingClient["updateCustomerEmail"]>(
      async (params) => {
        calls.push(`update-customer-email:${params.stripeCustomerId}:${params.email}`);
      },
    );
    const setStripeCustomerId = vi.fn<BillingRepository["setStripeCustomerId"]>();
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({
        getOrCreateAppUserBillingState: async (userId) => ({
          userId,
          plan: "pro",
          stripeCustomerId: "cus_existing",
        }),
        setStripeCustomerId,
      }),
      stripeBillingClient: createStripeClient({
        createCustomer,
        createPortalSession,
        updateCustomerEmail,
      }),
    });

    const response = await testApp.request("/api/billing/portal", sameOriginPost, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://billing.stripe.com/session_456",
    });
    expect(createCustomer).not.toHaveBeenCalled();
    expect(setStripeCustomerId).not.toHaveBeenCalled();
    expect(updateCustomerEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      stripeCustomerId: "cus_existing",
      userId: "user_123",
    });
    expect(createPortalSession).toHaveBeenCalledWith({
      stripeCustomerId: "cus_existing",
      returnUrl: "https://app.example.com/settings/billing",
    });
    expect(calls).toEqual([
      "update-customer-email:cus_existing:user@example.com",
      "create-portal:cus_existing",
    ]);
  });

  it("Portal前のCustomer email同期が失敗してもPortalを作る", async () => {
    const createPortalSession = vi.fn<StripeBillingClient["createPortalSession"]>(async () => ({
      url: "https://billing.stripe.com/session_456",
    }));
    const updateCustomerEmail = vi.fn<StripeBillingClient["updateCustomerEmail"]>(async () => {
      throw new Error("Stripe update failed.");
    });
    const sink = createMemoryLogSink();
    const testApp = createSilentTestApp({
      auth,
      loggerFactory: (baseFields) => createLogger(baseFields, { sink }),
      billingRepository: createRepository({
        getOrCreateAppUserBillingState: async (userId) => ({
          userId,
          plan: "pro",
          stripeCustomerId: "cus_existing",
        }),
      }),
      stripeBillingClient: createStripeClient({
        createPortalSession,
        updateCustomerEmail,
      }),
    });

    const response = await testApp.request("/api/billing/portal", sameOriginPost, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://billing.stripe.com/session_456",
    });
    expect(updateCustomerEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      stripeCustomerId: "cus_existing",
      userId: "user_123",
    });
    expect(createPortalSession).toHaveBeenCalledWith({
      stripeCustomerId: "cus_existing",
      returnUrl: "https://app.example.com/settings/billing",
    });
    expect(sink.entries).toContainEqual(
      expect.objectContaining({
        event: "stripe_customer_email_sync_failed",
        level: "error",
        stripeCustomerId: "cus_existing",
        userId: "user_123",
      }),
    );
  });

  it("Pro相当のsubscriptionがある場合は二重Checkoutを作らない", async () => {
    const stripeClient = createStripeClient({
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
      updateCustomerEmail: vi.fn(),
    });
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({
        listSubscriptionsByUserId: async () => [
          {
            stripePriceId: "price_pro",
            status: "active",
            currentPeriodEnd: null,
          },
        ],
      }),
      stripeBillingClient: stripeClient,
    });

    const response = await testApp.request("/api/billing/checkout", sameOriginPost, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "already_subscribed",
        message: "User already has an active Pro subscription.",
      },
    });
    expect(stripeClient.createCustomer).not.toHaveBeenCalled();
    expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
    expect(stripeClient.updateCustomerEmail).not.toHaveBeenCalled();
  });

  it("Billing statusでPro対象subscriptionを返す", async () => {
    const getBillingStatus = vi.fn<BillingRepository["getBillingStatus"]>(async () => ({
      plan: "pro",
      subscription: {
        status: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2026-07-04T00:00:00.000Z"),
        cancelAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    }));
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({ getBillingStatus }),
      getCurrentDate: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const response = await testApp.request("/api/billing/status", undefined, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      plan: "pro",
      subscription: {
        status: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: "2026-07-04T00:00:00.000Z",
        cancelAt: "2026-07-04T00:00:00.000Z",
      },
    });
    expect(getBillingStatus).toHaveBeenCalledWith({
      userId: "user_123",
      proPriceId: "price_pro",
      now: new Date("2026-06-04T00:00:00.000Z"),
    });
  });

  it("Pro対象subscriptionがなければBilling statusはsubscription nullを返す", async () => {
    const testApp = createSilentTestApp({
      auth,
      billingRepository: createRepository({
        getBillingStatus: async () => ({
          plan: "free",
          subscription: null,
        }),
      }),
    });

    const response = await testApp.request("/api/billing/status", undefined, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      plan: "free",
      subscription: null,
    });
  });

  it("Proの値段を月額の円で返し、同じPriceは一度しかStripeに問い合わせない", async () => {
    const retrievePrice = vi.fn<StripeBillingClient["retrievePrice"]>(async () => ({
      unitAmount: 480,
      currency: "jpy",
      recurringInterval: "month",
      recurringIntervalCount: 1,
    }));
    const testApp = createSilentTestApp({
      auth,
      stripeBillingClient: createStripeClient({ retrievePrice }),
    });

    const first = await testApp.request("/api/billing/pro-price", undefined, env);
    const second = await testApp.request("/api/billing/pro-price", undefined, env);

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      amount: 480,
      currency: "jpy",
      interval: "month",
    });
    await expect(second.json()).resolves.toEqual({
      amount: 480,
      currency: "jpy",
      interval: "month",
    });
    expect(retrievePrice).toHaveBeenCalledTimes(1);
    expect(retrievePrice).toHaveBeenCalledWith({ priceId: "price_pro" });
  });

  it.each([
    { name: "円でない", currency: "usd", recurringInterval: "month", recurringIntervalCount: 1 },
    { name: "年払い", currency: "jpy", recurringInterval: "year", recurringIntervalCount: 1 },
    { name: "3か月ごと", currency: "jpy", recurringInterval: "month", recurringIntervalCount: 3 },
    { name: "一回払い", currency: "jpy", recurringInterval: null, recurringIntervalCount: null },
  ])("Proの値段が$nameのPriceなら、別の値段を見せずにエラーにする", async (price) => {
    const testApp = createSilentTestApp({
      auth,
      stripeBillingClient: createStripeClient({
        retrievePrice: async () => ({ unitAmount: 480, ...price }),
      }),
    });

    const response = await testApp.request("/api/billing/pro-price", undefined, env);

    expect(response.status).toBe(500);
  });

  it("未ログイン時はProの値段を問い合わせない", async () => {
    const retrievePrice = vi.fn<StripeBillingClient["retrievePrice"]>();
    const testApp = createSilentTestApp({
      auth: createTestAuth(null),
      stripeBillingClient: createStripeClient({ retrievePrice }),
    });

    const response = await testApp.request("/api/billing/pro-price", undefined, env);

    expect(response.status).toBe(401);
    expect(retrievePrice).not.toHaveBeenCalled();
  });
});
