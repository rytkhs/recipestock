import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStripeBillingClient,
  normalizeStripeSubscription,
  normalizeStripeWebhookEvent,
} from "./stripe-billing";

const stripeMocks = vi.hoisted(() => ({
  checkoutSessionsCreate: vi.fn(),
  constructEventAsync: vi.fn(),
  customersCreate: vi.fn(),
  portalSessionsCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
}));

vi.mock("stripe", () => {
  const StripeMock = vi.fn(function StripeMock() {
    return {
      billingPortal: { sessions: { create: stripeMocks.portalSessionsCreate } },
      checkout: { sessions: { create: stripeMocks.checkoutSessionsCreate } },
      customers: { create: stripeMocks.customersCreate },
      subscriptions: { retrieve: stripeMocks.subscriptionsRetrieve },
      webhooks: { constructEventAsync: stripeMocks.constructEventAsync },
    };
  });

  (
    StripeMock as unknown as {
      createSubtleCryptoProvider: ReturnType<typeof vi.fn>;
    }
  ).createSubtleCryptoProvider = vi.fn();

  return { default: StripeMock };
});

const stripeEvent = (overrides: Record<string, unknown>): Stripe.Event =>
  ({
    id: "evt_123",
    type: "customer.subscription.created",
    created: 1_780_531_200,
    data: { object: {} },
    ...overrides,
  }) as Stripe.Event;

const subscriptionObject = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "sub_123",
    customer: "cus_123",
    metadata: { userId: "user_123" },
    items: {
      data: [
        {
          price: {
            id: "price_pro",
            product: "prod_123",
          },
        },
      ],
    },
    status: "active",
    current_period_start: 1_780_531_200,
    current_period_end: 1_783_123_200,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    ...overrides,
  }) as unknown as Stripe.Subscription;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createStripeBillingClient", () => {
  it("Customer作成はuserIdベースのidempotency keyを付ける", async () => {
    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_123" });

    const client = createStripeBillingClient({
      STRIPE_SECRET_KEY: "sk_test",
    } as Parameters<typeof createStripeBillingClient>[0]);

    await expect(
      client.createCustomer({ email: "user@example.com", userId: "user_123" }),
    ).resolves.toEqual({
      id: "cus_123",
    });
    expect(stripeMocks.customersCreate).toHaveBeenCalledWith(
      {
        email: "user@example.com",
        metadata: {
          userId: "user_123",
        },
      },
      {
        idempotencyKey: "create-customer:user_123",
      },
    );
  });

  it("Checkout作成はCustomerの請求先情報更新を許可する", async () => {
    stripeMocks.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_123",
      url: "https://checkout.stripe.com/session_123",
    });

    const client = createStripeBillingClient({
      STRIPE_SECRET_KEY: "sk_test",
    } as Parameters<typeof createStripeBillingClient>[0]);

    await expect(
      client.createCheckoutSession({
        userId: "user_123",
        stripeCustomerId: "cus_123",
        proPriceId: "price_pro",
        successUrl: "https://app.example.com/settings/billing?checkout=success",
        cancelUrl: "https://app.example.com/settings/billing?checkout=cancel",
      }),
    ).resolves.toEqual({
      url: "https://checkout.stripe.com/session_123",
    });
    expect(stripeMocks.checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_123",
        customer_update: {
          address: "auto",
          name: "auto",
        },
      }),
    );
  });
});

describe("normalizeStripeWebhookEvent", () => {
  it("subscription eventからsubscription idを抽出する", () => {
    expect(
      normalizeStripeWebhookEvent(
        stripeEvent({
          type: "customer.subscription.updated",
          data: {
            object: subscriptionObject({
              status: "past_due",
              cancel_at_period_end: true,
              cancel_at: 1_783_123_200,
            }),
          },
        }),
      ),
    ).toEqual({
      kind: "subscription_changed",
      eventId: "evt_123",
      eventCreatedAt: new Date("2026-06-04T00:00:00.000Z"),
      stripeSubscriptionId: "sub_123",
    });
  });

  it("checkout completedからuserIdとcustomerを抽出する", () => {
    expect(
      normalizeStripeWebhookEvent(
        stripeEvent({
          type: "checkout.session.completed",
          data: {
            object: {
              client_reference_id: "user_123",
              customer: "cus_123",
              metadata: {},
            } as Stripe.Checkout.Session,
          },
        }),
      ),
    ).toEqual({
      kind: "checkout_completed",
      eventId: "evt_123",
      eventCreatedAt: new Date("2026-06-04T00:00:00.000Z"),
      userId: "user_123",
      stripeCustomerId: "cus_123",
    });
  });

  it("subscription eventでsubscription idが欠けている場合は処理エラーにする", () => {
    expect(() =>
      normalizeStripeWebhookEvent(
        stripeEvent({
          data: {
            object: subscriptionObject({ id: "" }),
          },
        }),
      ),
    ).toThrow("Stripe Subscription id was missing.");
  });

  it("対象外eventはno-opにする", () => {
    expect(
      normalizeStripeWebhookEvent(
        stripeEvent({
          type: "invoice.payment_failed",
        }),
      ),
    ).toEqual({
      kind: "noop",
      eventId: "evt_123",
      eventCreatedAt: new Date("2026-06-04T00:00:00.000Z"),
      type: "invoice.payment_failed",
    });
  });
});

describe("normalizeStripeSubscription", () => {
  it("Stripe subscriptionから保存用stateを抽出する", () => {
    expect(
      normalizeStripeSubscription(
        subscriptionObject({
          status: "past_due",
          cancel_at_period_end: true,
          cancel_at: 1_783_123_200,
        }),
      ),
    ).toEqual({
      userId: "user_123",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      stripePriceId: "price_pro",
      stripeProductId: "prod_123",
      status: "past_due",
      currentPeriodStart: new Date("2026-06-04T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-07-04T00:00:00.000Z"),
      cancelAtPeriodEnd: true,
      cancelAt: new Date("2026-07-04T00:00:00.000Z"),
      canceledAt: null,
    });
  });

  it("userIdが欠けているsubscriptionは処理エラーにする", () => {
    expect(() => normalizeStripeSubscription(subscriptionObject({ metadata: {} }))).toThrow(
      "Stripe Subscription userId was missing.",
    );
  });
});
