import { createDb } from "@recipestock/db";
import {
  createBillingPortalResponseSchema,
  createCheckoutResponseSchema,
  type GetProPriceResponse,
  getBillingStatusResponseSchema,
  getProPriceResponseSchema,
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
import { type Logger } from "../logger";
import { requireAuth } from "../middleware/auth";
import {
  createStripeBillingClient,
  type StripeBillingClient,
  type StripePriceState,
} from "../stripe-billing";

type BillingRouteDependencies = {
  auth: AuthService;
  billingRepository?: BillingRepository;
  stripeBillingClient?: StripeBillingClient;
  getCurrentDate?: () => Date;
};

const buildUrl = (origin: string, path: string) => new URL(path, origin).toString();

// 画面は「月額 ¥◯（税込）」と出す。それに合わないPriceを設定したまま別の値段を見せないよう、
// 円・1か月ごとの定期払い以外は設定の誤りとして止める（ADR 0027）。
const toProPrice = (price: StripePriceState): GetProPriceResponse => {
  if (
    price.currency !== "jpy" ||
    price.recurringInterval !== "month" ||
    price.recurringIntervalCount !== 1 ||
    price.unitAmount === null
  ) {
    throw new Error("Stripe Pro price must be a monthly JPY price.");
  }

  return { amount: price.unitAmount, currency: "jpy", interval: "month" };
};

const ensureStripeCustomerId = async ({
  appUserStripeCustomerId,
  logger,
  repository,
  stripeClient,
  userEmail,
  userId,
}: {
  appUserStripeCustomerId: string | null;
  logger: Logger;
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
      logger.error("stripe_customer_email_sync_failed", {
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
  // Priceの金額と支払いの間隔は作ったあとに変えられず、値段を変えるときはPriceを作り直してIDを差し替える。
  // そのためIDごとに一度読めば足り、isolateが生きている間は覚えておく。
  const proPrices = new Map<string, GetProPriceResponse>();

  return routes
    .post("/checkout", requireAuth(auth), async (c) => {
      const userEmail = c.get("authSession").user.email;
      const userId = c.get("userId");
      const repository = billingRepository ?? createBillingRepository(createDb(c.env.DATABASE_URL));
      const stripeClient = stripeBillingClient ?? createStripeBillingClient(c.env);
      const proPriceId = c.env.STRIPE_PRO_PRICE_ID;
      const now = getCurrentDate?.() ?? new Date();
      const appUser = await repository.getOrCreateAppUserBillingState(userId);
      const subscriptions = await repository.listSubscriptionsByUserId(userId);

      if (derivePlanFromSubscriptions(subscriptions, { proPriceId, now }) === "pro") {
        return alreadySubscribedResponse();
      }

      // 手元のsubscriptionsはwebhookが書くので、決済を終えた直後はまだ契約が載っていない。
      // その間にもう一度Checkoutを作ると二つ目の契約になるため、Stripe側の契約も確かめる。
      if (appUser.stripeCustomerId) {
        const stripeSubscriptions = await stripeClient.listCustomerSubscriptions({
          stripeCustomerId: appUser.stripeCustomerId,
        });

        if (derivePlanFromSubscriptions(stripeSubscriptions, { proPriceId, now }) === "pro") {
          return alreadySubscribedResponse();
        }
      }

      const stripeCustomerId = await ensureStripeCustomerId({
        appUserStripeCustomerId: appUser.stripeCustomerId,
        logger: c.var.logger,
        repository,
        stripeClient,
        userEmail,
        userId,
      });

      const session = await stripeClient.createCheckoutSession({
        userId,
        stripeCustomerId,
        proPriceId,
        successUrl: buildUrl(c.env.APP_ORIGIN, "/settings/billing?checkout=success"),
        cancelUrl: buildUrl(c.env.APP_ORIGIN, "/settings/billing?checkout=cancel"),
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
        logger: c.var.logger,
        repository,
        stripeClient,
        userEmail,
        userId,
      });

      const session = await stripeClient.createPortalSession({
        stripeCustomerId,
        returnUrl: buildUrl(c.env.APP_ORIGIN, "/settings/billing"),
      });

      return c.json(createBillingPortalResponseSchema.parse(session));
    })
    .get("/pro-price", requireAuth(auth), async (c) => {
      const proPriceId = c.env.STRIPE_PRO_PRICE_ID;
      let proPrice = proPrices.get(proPriceId);

      if (!proPrice) {
        const stripeClient = stripeBillingClient ?? createStripeBillingClient(c.env);
        proPrice = toProPrice(await stripeClient.retrievePrice({ priceId: proPriceId }));
        proPrices.set(proPriceId, proPrice);
      }

      return c.json(getProPriceResponseSchema.parse(proPrice));
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
