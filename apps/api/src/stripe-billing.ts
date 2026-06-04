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

export type StripeBillingClient = {
  createCustomer(params: CreateStripeCustomerParams): Promise<{ id: string }>;
  createCheckoutSession(params: CreateStripeCheckoutSessionParams): Promise<{ url: string }>;
};

const STRIPE_API_VERSION = "2026-02-25.clover";

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
  };
};
