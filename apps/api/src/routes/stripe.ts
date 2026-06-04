import { createDb } from "@recipestock/db";
import { Hono } from "hono";
import {
  type BillingRepository,
  createBillingRepository,
  type UpsertSubscriptionFromStripeEventParams,
} from "../billing";
import { type ApiEnv } from "../context";
import {
  createStripeBillingClient,
  type StripeBillingClient,
  type StripeWebhookEvent,
  StripeWebhookSignatureError,
} from "../stripe-billing";

type StripeRouteDependencies = {
  billingRepository?: BillingRepository;
  stripeBillingClient?: StripeBillingClient;
};

const invalidWebhookResponse = () =>
  Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Stripe webhook signature verification failed.",
      },
    },
    { status: 400 },
  );

const receivedResponse = () => Response.json({ received: true });

const toSubscriptionUpsertParams = (
  event: Extract<StripeWebhookEvent, { kind: "subscription_changed" }>,
): UpsertSubscriptionFromStripeEventParams => ({
  userId: event.userId,
  stripeCustomerId: event.stripeCustomerId,
  stripeSubscriptionId: event.stripeSubscriptionId,
  stripePriceId: event.stripePriceId,
  stripeProductId: event.stripeProductId,
  status: event.status,
  currentPeriodStart: event.currentPeriodStart,
  currentPeriodEnd: event.currentPeriodEnd,
  cancelAtPeriodEnd: event.cancelAtPeriodEnd,
  cancelAt: event.cancelAt,
  canceledAt: event.canceledAt,
  latestEventCreatedAt: event.eventCreatedAt,
});

export const processStripeWebhookEvent = async ({
  event,
  proPriceId,
  repository,
}: {
  event: StripeWebhookEvent;
  proPriceId: string;
  repository: BillingRepository;
}) => {
  if (await repository.hasProcessedStripeEvent(event.eventId)) {
    return;
  }

  if (event.kind === "checkout_completed") {
    await repository.setStripeCustomerId(event.userId, event.stripeCustomerId);
    await repository.markStripeEventProcessed(event.eventId);
    return;
  }

  if (event.kind === "subscription_changed") {
    const result = await repository.upsertSubscriptionFromStripeEvent(
      toSubscriptionUpsertParams(event),
    );

    if (result.status === "upserted") {
      await repository.syncAppUserPlanFromSubscriptions({
        userId: event.userId,
        proPriceId,
        now: event.eventCreatedAt,
      });
    }

    await repository.markStripeEventProcessed(event.eventId);
    return;
  }

  await repository.markStripeEventProcessed(event.eventId);
};

export const createStripeRoutes = ({
  billingRepository,
  stripeBillingClient,
}: StripeRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.post("/webhook", async (c) => {
    const signature = c.req.header("stripe-signature");

    if (!signature) {
      return invalidWebhookResponse();
    }

    const repository = billingRepository ?? createBillingRepository(createDb(c.env.DATABASE_URL));
    const stripeClient = stripeBillingClient ?? createStripeBillingClient(c.env);
    const payload = await c.req.text();

    let event: StripeWebhookEvent;

    try {
      event = await stripeClient.verifyWebhook({
        payload,
        signature,
        webhookSecret: c.env.STRIPE_WEBHOOK_SECRET,
      });
    } catch (error) {
      if (error instanceof StripeWebhookSignatureError) {
        return invalidWebhookResponse();
      }

      throw error;
    }

    await processStripeWebhookEvent({
      event,
      proPriceId: c.env.STRIPE_PRO_PRICE_ID,
      repository,
    });

    return receivedResponse();
  });
};
