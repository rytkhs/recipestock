import { appUsers, type DbClient, subscriptions } from "@recipestock/db";
import { type Plan } from "@recipestock/shared";
import { eq } from "drizzle-orm";

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

type SyncAppUserPlanStorage = {
  ensureAppUser(userId: string): Promise<void>;
  listSubscriptionsByUserId(userId: string): Promise<SubscriptionPlanInput[]>;
  updateAppUserPlan(userId: string, plan: Plan): Promise<void>;
};

export type BillingRepository = {
  getOrCreateAppUserBillingState(userId: string): Promise<AppUserBillingState>;
  listSubscriptionsByUserId(userId: string): Promise<SubscriptionPlanInput[]>;
  setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void>;
  syncAppUserPlanFromSubscriptions(params: SyncAppUserPlanParams): Promise<Plan>;
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
    listSubscriptionsByUserId: storage.listSubscriptionsByUserId,
    async setStripeCustomerId(userId, stripeCustomerId) {
      await db
        .update(appUsers)
        .set({ stripeCustomerId, updatedAt: new Date() })
        .where(eq(appUsers.userId, userId));
    },
    syncAppUserPlanFromSubscriptions(params) {
      return syncAppUserPlanFromSubscriptions({ ...params, repository: storage });
    },
  };
};
