import Stripe from "stripe";
import { type Bindings } from "./env";

export type CreateStripeCustomerParams = {
  userId: string;
};

export type CreateStripeCheckoutSessionParams = {
  userId: string;
  stripeCustomerId: string;
  proPriceId: string;
  successUrl: string;
  cancelUrl: string;
};

export type CreateStripePortalSessionParams = {
  stripeCustomerId: string;
  returnUrl: string;
};

export type StripeBillingClient = {
  createCustomer(params: CreateStripeCustomerParams): Promise<{ id: string }>;
  createCheckoutSession(params: CreateStripeCheckoutSessionParams): Promise<{ url: string }>;
  createPortalSession(params: CreateStripePortalSessionParams): Promise<{ url: string }>;
  verifyWebhook(params: VerifyStripeWebhookParams): Promise<StripeWebhookEvent>;
};

const STRIPE_API_VERSION = "2026-02-25.clover";

export type VerifyStripeWebhookParams = {
  payload: string;
  signature: string;
  webhookSecret: string;
};

export type StripeWebhookEvent =
  | {
      kind: "checkout_completed";
      eventId: string;
      eventCreatedAt: Date;
      userId: string;
      stripeCustomerId: string;
    }
  | {
      kind: "subscription_changed";
      eventId: string;
      eventCreatedAt: Date;
      userId: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      stripePriceId: string;
      stripeProductId: string | null;
      status: string;
      currentPeriodStart: Date | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
      cancelAt: Date | null;
      canceledAt: Date | null;
    }
  | {
      kind: "noop";
      eventId: string;
      eventCreatedAt: Date;
      type: string;
    };

export class StripeWebhookSignatureError extends Error {
  constructor() {
    super("Stripe webhook signature verification failed.");
    this.name = "StripeWebhookSignatureError";
  }
}

const toDate = (seconds: number | null | undefined) =>
  typeof seconds === "number" ? new Date(seconds * 1000) : null;

const toEventCreatedAt = (event: Stripe.Event) => new Date(event.created * 1000);

const getStringId = (value: string | { id: string } | null | undefined, label: string) => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (value && typeof value === "object" && typeof value.id === "string" && value.id.length > 0) {
    return value.id;
  }

  throw new Error(`Stripe webhook ${label} was missing.`);
};

export const normalizeStripeWebhookEvent = (event: Stripe.Event): StripeWebhookEvent => {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id || session.metadata?.userId;

    if (!userId) {
      throw new Error("Stripe Checkout Session userId was missing.");
    }

    return {
      kind: "checkout_completed",
      eventId: event.id,
      eventCreatedAt: toEventCreatedAt(event),
      userId,
      stripeCustomerId: getStringId(session.customer, "customer"),
    };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const subscriptionPeriods = subscription as Stripe.Subscription & {
      current_period_start?: number | null;
      current_period_end?: number | null;
    };
    const userId = subscription.metadata?.userId;
    const item = subscription.items.data[0];

    if (!userId) {
      throw new Error("Stripe Subscription userId was missing.");
    }

    if (!item) {
      throw new Error("Stripe Subscription item was missing.");
    }

    return {
      kind: "subscription_changed",
      eventId: event.id,
      eventCreatedAt: toEventCreatedAt(event),
      userId,
      stripeCustomerId: getStringId(subscription.customer, "customer"),
      stripeSubscriptionId: subscription.id,
      stripePriceId: item.price.id,
      stripeProductId: getStringId(item.price.product, "product"),
      status: subscription.status,
      currentPeriodStart: toDate(subscriptionPeriods.current_period_start),
      currentPeriodEnd: toDate(subscriptionPeriods.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: toDate(subscription.cancel_at),
      canceledAt: toDate(subscription.canceled_at),
    };
  }

  return {
    kind: "noop",
    eventId: event.id,
    eventCreatedAt: toEventCreatedAt(event),
    type: event.type,
  };
};

export const createStripeBillingClient = (env: Bindings): StripeBillingClient => {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  });

  return {
    async createCustomer({ userId }) {
      const customer = await stripe.customers.create({
        metadata: {
          userId,
        },
      });

      return { id: customer.id };
    },
    async createCheckoutSession({ userId, stripeCustomerId, proPriceId, successUrl, cancelUrl }) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: stripeCustomerId,
        client_reference_id: userId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            price: proPriceId,
            quantity: 1,
          },
        ],
        metadata: {
          userId,
        },
        subscription_data: {
          metadata: {
            userId,
          },
        },
      });

      if (!session.url) {
        throw new Error("Stripe Checkout Session URL was not returned.");
      }

      return { url: session.url };
    },
    async createPortalSession({ stripeCustomerId, returnUrl }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl,
      });

      return { url: session.url };
    },
    async verifyWebhook({ payload, signature, webhookSecret }) {
      let event: Stripe.Event;

      try {
        event = await stripe.webhooks.constructEventAsync(
          payload,
          signature,
          webhookSecret,
          undefined,
          Stripe.createSubtleCryptoProvider(),
        );
      } catch {
        throw new StripeWebhookSignatureError();
      }

      return normalizeStripeWebhookEvent(event);
    },
  };
};
