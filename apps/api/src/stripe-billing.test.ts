import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { normalizeStripeSubscription, normalizeStripeWebhookEvent } from "./stripe-billing";

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
