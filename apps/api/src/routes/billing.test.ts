import { describe, expect, it, vi } from "vitest";
import { type BillingRepository } from "../billing";
import { createApp } from "../index";
import { type StripeBillingClient } from "../stripe-billing";

const env = {
  APP_ENV: "development",
  BETTER_AUTH_URL: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_SECRET_KEY: "sk_test",
};

const auth = {
  getSession: async () => ({ user: { id: "user_123", email: "user@example.com" } }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const sameOriginPost = {
  method: "POST",
  headers: {
    origin: "https://app.example.com",
    "sec-fetch-site": "same-origin",
  },
};

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
    const testApp = createApp({
      auth: {
        getSession: async () => null,
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
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
    const testApp = createApp({
      auth: {
        getSession: async () => null,
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
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
    const testApp = createApp({
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
    const testApp = createApp({
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
    const testApp = createApp({
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
    const testApp = createApp({
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

  it("Pro相当のsubscriptionがある場合は二重Checkoutを作らない", async () => {
    const stripeClient = createStripeClient({
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
      updateCustomerEmail: vi.fn(),
    });
    const testApp = createApp({
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
    const testApp = createApp({
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
    const testApp = createApp({
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
});
