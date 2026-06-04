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
  getSession: async () => ({ user: { id: "user_123" } }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const createRepository = (overrides: Partial<BillingRepository> = {}): BillingRepository => ({
  getOrCreateAppUserBillingState: async (userId) => ({
    userId,
    plan: "free",
    stripeCustomerId: null,
  }),
  listSubscriptionsByUserId: async () => [],
  setStripeCustomerId: async () => {},
  syncAppUserPlanFromSubscriptions: async () => "free",
  ...overrides,
});

const createStripeClient = (overrides: Partial<StripeBillingClient> = {}): StripeBillingClient => ({
  createCustomer: async () => ({ id: "cus_123" }),
  createCheckoutSession: async () => ({ url: "https://checkout.stripe.com/session_123" }),
  ...overrides,
});

describe("Billing routes", () => {
  it("未ログイン時はCheckoutを作らずunauthorizedを返す", async () => {
    const stripeClient = createStripeClient({
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
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

    const response = await testApp.request("/api/billing/checkout", { method: "POST" }, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    });
    expect(stripeClient.createCustomer).not.toHaveBeenCalled();
    expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
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
    const testApp = createApp({
      auth,
      billingRepository: createRepository({ setStripeCustomerId }),
      stripeBillingClient: createStripeClient({ createCustomer, createCheckoutSession }),
      getCurrentDate: () => new Date("2026-06-04T00:00:00.000Z"),
    });

    const response = await testApp.request("/api/billing/checkout", { method: "POST" }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.com/session_123",
    });
    expect(createCustomer).toHaveBeenCalledWith({ userId: "user_123" });
    expect(setStripeCustomerId).toHaveBeenCalledWith("user_123", "cus_123");
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
    const createCustomer = vi.fn<StripeBillingClient["createCustomer"]>();
    const createCheckoutSession = vi.fn<StripeBillingClient["createCheckoutSession"]>(async () => ({
      url: "https://checkout.stripe.com/session_456",
    }));
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
      stripeBillingClient: createStripeClient({ createCustomer, createCheckoutSession }),
    });

    const response = await testApp.request("/api/billing/checkout", { method: "POST" }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.com/session_456",
    });
    expect(createCustomer).not.toHaveBeenCalled();
    expect(setStripeCustomerId).not.toHaveBeenCalled();
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeCustomerId: "cus_existing",
      }),
    );
  });

  it("Pro相当のsubscriptionがある場合は二重Checkoutを作らない", async () => {
    const stripeClient = createStripeClient({
      createCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
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

    const response = await testApp.request("/api/billing/checkout", { method: "POST" }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "already_subscribed",
        message: "User already has an active Pro subscription.",
      },
    });
    expect(stripeClient.createCustomer).not.toHaveBeenCalled();
    expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
  });
});
