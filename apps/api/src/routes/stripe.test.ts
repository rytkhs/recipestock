import { describe, expect, it, vi } from "vitest";
import { type BillingRepository } from "../billing";
import { createApp } from "../index";
import {
  type StripeBillingClient,
  type StripeSubscriptionState,
  type StripeWebhookEvent,
  StripeWebhookSignatureError,
} from "../stripe-billing";

const env = {
  APP_ENV: "development",
  BETTER_AUTH_URL: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_SECRET_KEY: "sk_test",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
};

const auth = {
  getSession: async () => null,
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const eventCreatedAt = new Date("2026-06-04T00:00:00.000Z");

const checkoutCompletedEvent = (
  overrides: Partial<Extract<StripeWebhookEvent, { kind: "checkout_completed" }>> = {},
): StripeWebhookEvent => ({
  kind: "checkout_completed",
  eventId: "evt_checkout",
  eventCreatedAt,
  userId: "user_123",
  stripeCustomerId: "cus_123",
  ...overrides,
});

const subscriptionChangedEvent = (
  overrides: Partial<Extract<StripeWebhookEvent, { kind: "subscription_changed" }>> = {},
): StripeWebhookEvent => ({
  kind: "subscription_changed",
  eventId: "evt_subscription",
  eventCreatedAt,
  stripeSubscriptionId: "sub_123",
  ...overrides,
});

const subscriptionState = (
  overrides: Partial<StripeSubscriptionState> = {},
): StripeSubscriptionState => ({
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
  ...overrides,
});

const noopEvent = (type = "invoice.payment_failed"): StripeWebhookEvent => ({
  kind: "noop",
  eventId: `evt_${type}`,
  eventCreatedAt,
  type,
});

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

const createStripeClient = (
  event: StripeWebhookEvent,
  subscription: StripeSubscriptionState = subscriptionState(),
): StripeBillingClient => ({
  createCustomer: async () => ({ id: "cus_123" }),
  createCheckoutSession: async () => ({ url: "https://checkout.stripe.com/session_123" }),
  createPortalSession: async () => ({ url: "https://billing.stripe.com/session_123" }),
  retrieveSubscription: async () => subscription,
  verifyWebhook: async () => event,
});

const requestWebhook = (
  dependencies: {
    billingRepository?: BillingRepository;
    stripeBillingClient?: StripeBillingClient;
  },
  init: RequestInit = {},
) =>
  createApp({ auth, ...dependencies }).request(
    "/api/stripe/webhook",
    {
      method: "POST",
      body: "{}",
      headers: {
        "stripe-signature": "sig_test",
        ...init.headers,
      },
      ...init,
    },
    env,
  );

describe("Stripe webhook route", () => {
  it("invalid signatureは400を返しrepositoryを呼ばない", async () => {
    const hasProcessedStripeEvent = vi.fn<BillingRepository["hasProcessedStripeEvent"]>();
    const response = await requestWebhook({
      billingRepository: createRepository({ hasProcessedStripeEvent }),
      stripeBillingClient: {
        ...createStripeClient(noopEvent()),
        verifyWebhook: async () => {
          throw new StripeWebhookSignatureError();
        },
      },
    });

    expect(response.status).toBe(400);
    expect(hasProcessedStripeEvent).not.toHaveBeenCalled();
  });

  it("重複eventは同期処理せず200を返す", async () => {
    const setStripeCustomerId = vi.fn<BillingRepository["setStripeCustomerId"]>();
    const markStripeEventProcessed = vi.fn<BillingRepository["markStripeEventProcessed"]>();
    const retrieveSubscription = vi.fn<StripeBillingClient["retrieveSubscription"]>();
    const response = await requestWebhook({
      billingRepository: createRepository({
        hasProcessedStripeEvent: async () => true,
        setStripeCustomerId,
        markStripeEventProcessed,
      }),
      stripeBillingClient: {
        ...createStripeClient(checkoutCompletedEvent()),
        retrieveSubscription,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(setStripeCustomerId).not.toHaveBeenCalled();
    expect(retrieveSubscription).not.toHaveBeenCalled();
    expect(markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("checkout.session.completedはcustomer idを保存しeventを処理済みにする", async () => {
    const setStripeCustomerId = vi.fn<BillingRepository["setStripeCustomerId"]>();
    const markStripeEventProcessed = vi.fn<BillingRepository["markStripeEventProcessed"]>();
    const syncAppUserPlanFromSubscriptions =
      vi.fn<BillingRepository["syncAppUserPlanFromSubscriptions"]>();

    const response = await requestWebhook({
      billingRepository: createRepository({
        setStripeCustomerId,
        markStripeEventProcessed,
        syncAppUserPlanFromSubscriptions,
      }),
      stripeBillingClient: createStripeClient(checkoutCompletedEvent()),
    });

    expect(response.status).toBe(200);
    expect(setStripeCustomerId).toHaveBeenCalledWith("user_123", "cus_123");
    expect(syncAppUserPlanFromSubscriptions).not.toHaveBeenCalled();
    expect(markStripeEventProcessed).toHaveBeenCalledWith("evt_checkout");
  });

  it("customer.subscription.createdはsubscriptionを保存しplanを同期する", async () => {
    const calls: string[] = [];
    const setStripeCustomerId = vi.fn<BillingRepository["setStripeCustomerId"]>(
      async (userId, stripeCustomerId) => {
        calls.push(`save-customer:${userId}:${stripeCustomerId}`);
      },
    );
    const upsertSubscriptionFromStripeEvent = vi.fn<
      BillingRepository["upsertSubscriptionFromStripeEvent"]
    >(async () => {
      calls.push("upsert-subscription");
    });
    const syncAppUserPlanFromSubscriptions = vi.fn<
      BillingRepository["syncAppUserPlanFromSubscriptions"]
    >(async () => {
      calls.push("sync-plan");
      return "pro";
    });
    const retrieveSubscription = vi.fn<StripeBillingClient["retrieveSubscription"]>(async () =>
      subscriptionState(),
    );

    const response = await requestWebhook({
      billingRepository: createRepository({
        setStripeCustomerId,
        upsertSubscriptionFromStripeEvent,
        syncAppUserPlanFromSubscriptions,
      }),
      stripeBillingClient: {
        ...createStripeClient(subscriptionChangedEvent()),
        retrieveSubscription,
      },
    });

    expect(response.status).toBe(200);
    expect(retrieveSubscription).toHaveBeenCalledWith({ stripeSubscriptionId: "sub_123" });
    expect(setStripeCustomerId).toHaveBeenCalledWith("user_123", "cus_123");
    expect(upsertSubscriptionFromStripeEvent).toHaveBeenCalledWith({
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
      latestEventCreatedAt: eventCreatedAt,
    });
    expect(syncAppUserPlanFromSubscriptions).toHaveBeenCalledWith({
      userId: "user_123",
      proPriceId: "price_pro",
      now: eventCreatedAt,
    });
    expect(calls).toEqual(["save-customer:user_123:cus_123", "upsert-subscription", "sync-plan"]);
  });

  it.each([
    "canceled",
    "unpaid",
    "incomplete",
  ])("customer.subscription.updated %sは同期repositoryへ渡す", async (status) => {
    const upsertSubscriptionFromStripeEvent = vi.fn<
      BillingRepository["upsertSubscriptionFromStripeEvent"]
    >(async () => {});
    const syncAppUserPlanFromSubscriptions = vi.fn<
      BillingRepository["syncAppUserPlanFromSubscriptions"]
    >(async () => "free");

    const response = await requestWebhook({
      billingRepository: createRepository({
        upsertSubscriptionFromStripeEvent,
        syncAppUserPlanFromSubscriptions,
      }),
      stripeBillingClient: createStripeClient(
        subscriptionChangedEvent(),
        subscriptionState({ status }),
      ),
    });

    expect(response.status).toBe(200);
    expect(upsertSubscriptionFromStripeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status }),
    );
    expect(syncAppUserPlanFromSubscriptions).toHaveBeenCalledWith({
      userId: "user_123",
      proPriceId: "price_pro",
      now: eventCreatedAt,
    });
  });

  it("customer.subscription.deletedは失効状態を保存してplanを同期する", async () => {
    const upsertSubscriptionFromStripeEvent = vi.fn<
      BillingRepository["upsertSubscriptionFromStripeEvent"]
    >(async () => {});
    const syncAppUserPlanFromSubscriptions = vi.fn<
      BillingRepository["syncAppUserPlanFromSubscriptions"]
    >(async () => "free");

    const response = await requestWebhook({
      billingRepository: createRepository({
        upsertSubscriptionFromStripeEvent,
        syncAppUserPlanFromSubscriptions,
      }),
      stripeBillingClient: createStripeClient(
        subscriptionChangedEvent({ eventId: "evt_deleted" }),
        subscriptionState({ status: "canceled" }),
      ),
    });

    expect(response.status).toBe(200);
    expect(upsertSubscriptionFromStripeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" }),
    );
    expect(syncAppUserPlanFromSubscriptions).toHaveBeenCalledWith({
      userId: "user_123",
      proPriceId: "price_pro",
      now: eventCreatedAt,
    });
  });

  it("stale payloadでもStripe current stateを保存してplan同期する", async () => {
    const upsertSubscriptionFromStripeEvent = vi.fn<
      BillingRepository["upsertSubscriptionFromStripeEvent"]
    >(async () => {});
    const syncAppUserPlanFromSubscriptions = vi.fn<
      BillingRepository["syncAppUserPlanFromSubscriptions"]
    >(async () => "free");
    const markStripeEventProcessed = vi.fn<BillingRepository["markStripeEventProcessed"]>();

    const response = await requestWebhook({
      billingRepository: createRepository({
        upsertSubscriptionFromStripeEvent,
        syncAppUserPlanFromSubscriptions,
        markStripeEventProcessed,
      }),
      stripeBillingClient: createStripeClient(
        subscriptionChangedEvent({ eventId: "evt_stale" }),
        subscriptionState({
          status: "canceled",
          currentPeriodEnd: new Date("2026-06-04T00:00:00.000Z"),
          canceledAt: new Date("2026-06-04T00:00:00.000Z"),
        }),
      ),
    });

    expect(response.status).toBe(200);
    expect(upsertSubscriptionFromStripeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "canceled",
        canceledAt: new Date("2026-06-04T00:00:00.000Z"),
      }),
    );
    expect(syncAppUserPlanFromSubscriptions).toHaveBeenCalledWith({
      userId: "user_123",
      proPriceId: "price_pro",
      now: eventCreatedAt,
    });
    expect(markStripeEventProcessed).toHaveBeenCalledWith("evt_stale");
  });

  it("subscription取得失敗時はeventを処理済みにしない", async () => {
    const markStripeEventProcessed = vi.fn<BillingRepository["markStripeEventProcessed"]>();
    const syncAppUserPlanFromSubscriptions =
      vi.fn<BillingRepository["syncAppUserPlanFromSubscriptions"]>();
    const upsertSubscriptionFromStripeEvent =
      vi.fn<BillingRepository["upsertSubscriptionFromStripeEvent"]>();

    const response = await requestWebhook({
      billingRepository: createRepository({
        markStripeEventProcessed,
        upsertSubscriptionFromStripeEvent,
        syncAppUserPlanFromSubscriptions,
      }),
      stripeBillingClient: {
        ...createStripeClient(subscriptionChangedEvent({ eventId: "evt_retrieve_failed" })),
        retrieveSubscription: async () => {
          throw new Error("Stripe retrieve failed.");
        },
      },
    });

    expect(response.status).toBe(500);
    expect(upsertSubscriptionFromStripeEvent).not.toHaveBeenCalled();
    expect(syncAppUserPlanFromSubscriptions).not.toHaveBeenCalled();
    expect(markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("upsert失敗時はeventを処理済みにしない", async () => {
    const markStripeEventProcessed = vi.fn<BillingRepository["markStripeEventProcessed"]>();
    const upsertSubscriptionFromStripeEvent = vi.fn<
      BillingRepository["upsertSubscriptionFromStripeEvent"]
    >(async () => {
      throw new Error("DB upsert failed.");
    });
    const syncAppUserPlanFromSubscriptions =
      vi.fn<BillingRepository["syncAppUserPlanFromSubscriptions"]>();

    const response = await requestWebhook({
      billingRepository: createRepository({
        markStripeEventProcessed,
        upsertSubscriptionFromStripeEvent,
        syncAppUserPlanFromSubscriptions,
      }),
      stripeBillingClient: createStripeClient(subscriptionChangedEvent({ eventId: "evt_failed" })),
    });

    expect(response.status).toBe(500);
    expect(syncAppUserPlanFromSubscriptions).not.toHaveBeenCalled();
    expect(markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("price不一致のcurrent stateも保存するがPro判定は同期repositoryに委ねる", async () => {
    const upsertSubscriptionFromStripeEvent = vi.fn<
      BillingRepository["upsertSubscriptionFromStripeEvent"]
    >(async () => {});
    const syncAppUserPlanFromSubscriptions = vi.fn<
      BillingRepository["syncAppUserPlanFromSubscriptions"]
    >(async () => "free");

    const response = await requestWebhook({
      billingRepository: createRepository({
        upsertSubscriptionFromStripeEvent,
        syncAppUserPlanFromSubscriptions,
      }),
      stripeBillingClient: createStripeClient(
        subscriptionChangedEvent(),
        subscriptionState({ stripePriceId: "price_other" }),
      ),
    });

    expect(response.status).toBe(200);
    expect(upsertSubscriptionFromStripeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ stripePriceId: "price_other" }),
    );
    expect(syncAppUserPlanFromSubscriptions).toHaveBeenCalled();
  });

  it.each([
    "invoice.payment_failed",
    "invoice.payment_succeeded",
  ])("%sはno-opとして処理済みにする", async (type) => {
    const upsertSubscriptionFromStripeEvent =
      vi.fn<BillingRepository["upsertSubscriptionFromStripeEvent"]>();
    const markStripeEventProcessed = vi.fn<BillingRepository["markStripeEventProcessed"]>();

    const response = await requestWebhook({
      billingRepository: createRepository({
        upsertSubscriptionFromStripeEvent,
        markStripeEventProcessed,
      }),
      stripeBillingClient: createStripeClient(noopEvent(type)),
    });

    expect(response.status).toBe(200);
    expect(upsertSubscriptionFromStripeEvent).not.toHaveBeenCalled();
    expect(markStripeEventProcessed).toHaveBeenCalledWith(`evt_${type}`);
  });
});
