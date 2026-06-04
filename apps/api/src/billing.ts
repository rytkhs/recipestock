import { appUsers, type DbClient, stripeEvents, subscriptions } from "@recipestock/db";
import { type Plan } from "@recipestock/shared";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

export type SubscriptionPlanInput = {
  stripePriceId: string;
  status: string;
  currentPeriodEnd: Date | string | null;
};

export type ProSubscriptionOptions = {
  proPriceId: string;
  now?: Date;
};

export type SyncAppUserPlanParams = {
  userId: string;
  proPriceId: string;
  now?: Date;
};

export type AppUserBillingState = {
  userId: string;
  plan: Plan;
  stripeCustomerId: string | null;
};

export type UpsertSubscriptionFromStripeEventParams = {
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
  latestEventCreatedAt: Date;
};

export type UpsertSubscriptionFromStripeEventResult =
  | { status: "upserted" }
  | { status: "skippedOldEvent" };

type SyncAppUserPlanStorage = {
  ensureAppUser(userId: string): Promise<void>;
  listSubscriptionsByUserId(userId: string): Promise<SubscriptionPlanInput[]>;
  updateAppUserPlan(userId: string, plan: Plan): Promise<void>;
};

export type BillingRepository = {
  getOrCreateAppUserBillingState(userId: string): Promise<AppUserBillingState>;
  hasProcessedStripeEvent(eventId: string): Promise<boolean>;
  listSubscriptionsByUserId(userId: string): Promise<SubscriptionPlanInput[]>;
  markStripeEventProcessed(eventId: string): Promise<void>;
  setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void>;
  syncAppUserPlanFromSubscriptions(params: SyncAppUserPlanParams): Promise<Plan>;
  upsertSubscriptionFromStripeEvent(
    params: UpsertSubscriptionFromStripeEventParams,
  ): Promise<UpsertSubscriptionFromStripeEventResult>;
};

export const isProSubscription = (
  subscription: SubscriptionPlanInput,
  { proPriceId, now = new Date() }: ProSubscriptionOptions,
) => {
  if (subscription.stripePriceId !== proPriceId) {
    return false;
  }

  if (subscription.status === "active" || subscription.status === "trialing") {
    return true;
  }

  if (subscription.status !== "past_due" || subscription.currentPeriodEnd === null) {
    return false;
  }

  return now.getTime() <= new Date(subscription.currentPeriodEnd).getTime();
};

export const derivePlanFromSubscriptions = (
  subscriptionRows: SubscriptionPlanInput[],
  options: ProSubscriptionOptions,
): Plan =>
  subscriptionRows.some((subscription) => isProSubscription(subscription, options))
    ? "pro"
    : "free";

export const shouldApplyStripeEvent = ({
  latestEventCreatedAt,
  eventCreatedAt,
}: {
  latestEventCreatedAt: Date | string | null;
  eventCreatedAt: Date | string;
}) =>
  latestEventCreatedAt === null ||
  new Date(eventCreatedAt).getTime() >= new Date(latestEventCreatedAt).getTime();

export const syncAppUserPlanFromSubscriptions = async ({
  userId,
  proPriceId,
  repository,
  now = new Date(),
}: SyncAppUserPlanParams & {
  repository: SyncAppUserPlanStorage;
}): Promise<Plan> => {
  await repository.ensureAppUser(userId);

  const subscriptionRows = await repository.listSubscriptionsByUserId(userId);
  const plan = derivePlanFromSubscriptions(subscriptionRows, { proPriceId, now });

  await repository.updateAppUserPlan(userId, plan);

  return plan;
};

export const createBillingRepository = (db: DbClient): BillingRepository => {
  const storage: SyncAppUserPlanStorage = {
    async ensureAppUser(userId) {
      await db.insert(appUsers).values({ userId }).onConflictDoNothing();
    },
    async listSubscriptionsByUserId(userId) {
      return db
        .select({
          stripePriceId: subscriptions.stripePriceId,
          status: subscriptions.status,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId));
    },
    async updateAppUserPlan(userId, plan) {
      await db
        .update(appUsers)
        .set({ plan, updatedAt: new Date() })
        .where(eq(appUsers.userId, userId));
    },
  };

  return {
    async getOrCreateAppUserBillingState(userId) {
      await storage.ensureAppUser(userId);

      const [appUser] = await db
        .select({
          userId: appUsers.userId,
          plan: appUsers.plan,
          stripeCustomerId: appUsers.stripeCustomerId,
        })
        .from(appUsers)
        .where(eq(appUsers.userId, userId))
        .limit(1);

      if (!appUser) {
        throw new Error("App user was not created.");
      }

      return appUser;
    },
    async hasProcessedStripeEvent(eventId) {
      const [event] = await db
        .select({ eventId: stripeEvents.eventId })
        .from(stripeEvents)
        .where(eq(stripeEvents.eventId, eventId))
        .limit(1);

      return Boolean(event);
    },
    listSubscriptionsByUserId: storage.listSubscriptionsByUserId,
    async markStripeEventProcessed(eventId) {
      await db.insert(stripeEvents).values({ eventId }).onConflictDoNothing();
    },
    async setStripeCustomerId(userId, stripeCustomerId) {
      await db
        .insert(appUsers)
        .values({ userId, stripeCustomerId })
        .onConflictDoUpdate({
          target: appUsers.userId,
          set: { stripeCustomerId, updatedAt: new Date() },
        });
    },
    syncAppUserPlanFromSubscriptions(params) {
      return syncAppUserPlanFromSubscriptions({ ...params, repository: storage });
    },
    async upsertSubscriptionFromStripeEvent(params) {
      const [existingSubscription] = await db
        .select({
          latestEventCreatedAt: subscriptions.latestEventCreatedAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, params.stripeSubscriptionId))
        .limit(1);

      if (
        existingSubscription &&
        !shouldApplyStripeEvent({
          latestEventCreatedAt: existingSubscription.latestEventCreatedAt,
          eventCreatedAt: params.latestEventCreatedAt,
        })
      ) {
        return { status: "skippedOldEvent" };
      }

      const values = {
        userId: params.userId,
        stripeCustomerId: params.stripeCustomerId,
        stripeSubscriptionId: params.stripeSubscriptionId,
        stripePriceId: params.stripePriceId,
        stripeProductId: params.stripeProductId,
        status: params.status,
        currentPeriodStart: params.currentPeriodStart,
        currentPeriodEnd: params.currentPeriodEnd,
        cancelAtPeriodEnd: params.cancelAtPeriodEnd,
        cancelAt: params.cancelAt,
        canceledAt: params.canceledAt,
        latestEventCreatedAt: params.latestEventCreatedAt,
        updatedAt: new Date(),
      };

      if (existingSubscription) {
        await db
          .update(subscriptions)
          .set(values)
          .where(eq(subscriptions.stripeSubscriptionId, params.stripeSubscriptionId));
      } else {
        await db.insert(subscriptions).values({
          id: ulid(),
          ...values,
        });
      }

      return { status: "upserted" };
    },
  };
};
