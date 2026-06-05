import { createDb } from "@recipestock/db";
import {
  createBillingPortalResponseSchema,
  createCheckoutResponseSchema,
  getBillingStatusResponseSchema,
} from "@recipestock/schemas";
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

const ensureStripeCustomerId = async ({
  appUserStripeCustomerId,
  repository,
  stripeClient,
  userEmail,
  userId,
}: {
  appUserStripeCustomerId: string | null;
  repository: BillingRepository;
  stripeClient: StripeBillingClient;
  userEmail: string;
  userId: string;
}) => {
  if (appUserStripeCustomerId) {
    try {
      await stripeClient.updateCustomerEmail({
        email: userEmail,
        stripeCustomerId: appUserStripeCustomerId,
        userId,
      });
    } catch (error) {
      console.error("[billing] Stripe customer email sync failed", {
        error,
        stripeCustomerId: appUserStripeCustomerId,
        userId,
      });
    }

    return appUserStripeCustomerId;
  }

  const customer = await stripeClient.createCustomer({ email: userEmail, userId });
  await repository.setStripeCustomerId(userId, customer.id);
  return customer.id;
};

export const createBillingRoutes = ({
  auth,
  billingRepository,
  stripeBillingClient,
  getCurrentDate,
}: BillingRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes
    .post("/checkout", requireAuth(auth), async (c) => {
      const userEmail = c.get("authSession").user.email;
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

      const stripeCustomerId = await ensureStripeCustomerId({
        appUserStripeCustomerId: appUser.stripeCustomerId,
        repository,
        stripeClient,
        userEmail,
        userId,
      });

      const session = await stripeClient.createCheckoutSession({
        userId,
        stripeCustomerId,
        proPriceId,
        successUrl: buildUrl(c.env.BETTER_AUTH_URL, "/settings/billing?checkout=success"),
        cancelUrl: buildUrl(c.env.BETTER_AUTH_URL, "/settings/billing?checkout=cancel"),
      });

      return c.json(createCheckoutResponseSchema.parse(session));
    })
    .post("/portal", requireAuth(auth), async (c) => {
      const userEmail = c.get("authSession").user.email;
      const userId = c.get("userId");
      const repository = billingRepository ?? createBillingRepository(createDb(c.env.DATABASE_URL));
      const stripeClient = stripeBillingClient ?? createStripeBillingClient(c.env);
      const appUser = await repository.getOrCreateAppUserBillingState(userId);
      const stripeCustomerId = await ensureStripeCustomerId({
        appUserStripeCustomerId: appUser.stripeCustomerId,
        repository,
        stripeClient,
        userEmail,
        userId,
      });

      const session = await stripeClient.createPortalSession({
        stripeCustomerId,
        returnUrl: buildUrl(c.env.BETTER_AUTH_URL, "/settings/billing"),
      });

      return c.json(createBillingPortalResponseSchema.parse(session));
    })
    .get("/status", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository = billingRepository ?? createBillingRepository(createDb(c.env.DATABASE_URL));
      const status = await repository.getBillingStatus({
        userId,
        proPriceId: c.env.STRIPE_PRO_PRICE_ID,
        now: getCurrentDate?.() ?? new Date(),
      });

      return c.json(
        getBillingStatusResponseSchema.parse({
          plan: status.plan,
          subscription: status.subscription
            ? {
                status: status.subscription.status,
                cancelAtPeriodEnd: status.subscription.cancelAtPeriodEnd,
                currentPeriodEnd: status.subscription.currentPeriodEnd?.toISOString() ?? null,
                cancelAt: status.subscription.cancelAt?.toISOString() ?? null,
              }
            : null,
        }),
      );
    });
};
