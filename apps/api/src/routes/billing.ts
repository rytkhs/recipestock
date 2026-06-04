import { createDb } from "@recipestock/db";
import { createCheckoutResponseSchema } from "@recipestock/schemas";
import { Hono } from "hono";
import { alreadySubscribedResponse } from "../api-error";
import { type AuthService } from "../auth";
import {
  type BillingRepository,
  createBillingRepository,
  derivePlanFromSubscriptions,
} from "../billing";
import { type ApiEnv } from "../context";
import { requireAuth } from "../middleware/auth";
import { createStripeBillingClient, type StripeBillingClient } from "../stripe-billing";

type BillingRouteDependencies = {
  auth: AuthService;
  billingRepository?: BillingRepository;
  stripeBillingClient?: StripeBillingClient;
  getCurrentDate?: () => Date;
};

const buildUrl = (origin: string, path: string) => new URL(path, origin).toString();

export const createBillingRoutes = ({
  auth,
  billingRepository,
  stripeBillingClient,
  getCurrentDate,
}: BillingRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.post("/checkout", requireAuth(auth), async (c) => {
    const userId = c.get("userId");
    const repository = billingRepository ?? createBillingRepository(createDb(c.env.DATABASE_URL));
    const stripeClient = stripeBillingClient ?? createStripeBillingClient(c.env);
    const proPriceId = c.env.STRIPE_PRO_PRICE_ID;
    const appUser = await repository.getOrCreateAppUserBillingState(userId);
    const subscriptions = await repository.listSubscriptionsByUserId(userId);
    const plan = derivePlanFromSubscriptions(subscriptions, {
      proPriceId,
      now: getCurrentDate?.() ?? new Date(),
    });

    if (plan === "pro") {
      return alreadySubscribedResponse();
    }

    let stripeCustomerId = appUser.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripeClient.createCustomer({ userId });
      stripeCustomerId = customer.id;
      await repository.setStripeCustomerId(userId, stripeCustomerId);
    }

    const session = await stripeClient.createCheckoutSession({
      userId,
      stripeCustomerId,
      proPriceId,
      successUrl: buildUrl(c.env.BETTER_AUTH_URL, "/settings/billing?checkout=success"),
      cancelUrl: buildUrl(c.env.BETTER_AUTH_URL, "/settings/billing?checkout=cancel"),
    });

    return c.json(createCheckoutResponseSchema.parse(session));
  });
};
