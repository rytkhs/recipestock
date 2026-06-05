import { appUsers, type DbClient, stripeEvents, subscriptions } from "@recipestock/db";
import { type Plan } from "@recipestock/shared";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

export type SubscriptionPlanInput = {
  stripePriceId: string;
  status: string;
  currentPeriodEnd: Date | string | null;
};

export type BillingSubscriptionSummary = {
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
};

export type BillingStatus = {
  plan: Plan;
  subscription: BillingSubscriptionSummary | null;
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

export type AppUserPlanSyncer = (userId: string, params?: { now?: Date }) => Promise<Plan>;

export type AppUserPlanSyncOptions = {
  proPriceId?: string;
  now?: Date;
  syncAppUserPlan?: AppUserPlanSyncer;
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

type SyncAppUserPlanStorage = {
  ensureAppUser(userId: string): Promise<void>;
  getAppUserPlan(userId: string): Promise<Plan>;
  listSubscriptionsByUserId(userId: string): Promise<SubscriptionPlanInput[]>;
  updateAppUserPlan(userId: string, plan: Plan): Promise<void>;
};

export type BillingRepository = {
  getBillingStatus(params: SyncAppUserPlanParams): Promise<BillingStatus>;
  getOrCreateAppUserBillingState(userId: string): Promise<AppUserBillingState>;
  hasProcessedStripeEvent(eventId: string): Promise<boolean>;
  listSubscriptionsByUserId(userId: string): Promise<SubscriptionPlanInput[]>;
  markStripeEventProcessed(eventId: string): Promise<void>;
  setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void>;
  syncAppUserPlanFromSubscriptions(params: SyncAppUserPlanParams): Promise<Plan>;
  upsertSubscriptionFromStripeEvent(params: UpsertSubscriptionFromStripeEventParams): Promise<void>;
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

export const syncAppUserPlanFromSubscriptions = async ({
  userId,
  proPriceId,
  repository,
  now = new Date(),
}: SyncAppUserPlanParams & {
  repository: SyncAppUserPlanStorage;
}): Promise<Plan> => {
  await repository.ensureAppUser(userId);

  const [storedPlan, subscriptionRows] = await Promise.all([
    repository.getAppUserPlan(userId),
    repository.listSubscriptionsByUserId(userId),
  ]);
  const plan = derivePlanFromSubscriptions(subscriptionRows, { proPriceId, now });

  if (storedPlan !== plan) {
    await repository.updateAppUserPlan(userId, plan);
  }

  return plan;
};

export const syncAppUserPlanForDb = async (
  db: DbClient,
  userId: string,
  { proPriceId, now = new Date(), syncAppUserPlan }: AppUserPlanSyncOptions,
): Promise<Plan> => {
  if (syncAppUserPlan) {
    return syncAppUserPlan(userId, { now });
  }

  if (!proPriceId) {
    throw new Error("Plan sync requires a Stripe Pro price ID.");
  }

  return syncAppUserPlanFromSubscriptions({
    userId,
    proPriceId,
    now,
    repository: {
      ensureAppUser: async (targetUserId) => storageEnsureAppUser(db, targetUserId),
      getAppUserPlan: async (targetUserId) => getAppUserPlan(db, targetUserId),
      listSubscriptionsByUserId: async (targetUserId) => listSubscriptionPlans(db, targetUserId),
      updateAppUserPlan: async (targetUserId, plan) => updateAppUserPlan(db, targetUserId, plan),
    },
  });
};

const storageEnsureAppUser = async (db: DbClient, userId: string) => {
  await db.insert(appUsers).values({ userId }).onConflictDoNothing();
};

const getAppUserPlan = async (db: DbClient, userId: string): Promise<Plan> => {
  const [appUser] = await db
    .select({ plan: appUsers.plan })
    .from(appUsers)
    .where(eq(appUsers.userId, userId))
    .limit(1);

  if (!appUser) {
    throw new Error(`App user was not created for ${userId}`);
  }

  return appUser.plan;
};

const listSubscriptionPlans = (db: DbClient, userId: string) =>
  db
    .select({
      stripePriceId: subscriptions.stripePriceId,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

const updateAppUserPlan = async (db: DbClient, userId: string, plan: Plan) => {
  await db.update(appUsers).set({ plan, updatedAt: new Date() }).where(eq(appUsers.userId, userId));
};

export const selectBillingSubscriptionSummary = <
  T extends {
    stripePriceId: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAt: Date | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodStart: Date | null;
    updatedAt: Date;
  },
>(
  subscriptionRows: T[],
  options: ProSubscriptionOptions,
): BillingSubscriptionSummary | null => {
  const proPriceSubscriptions = subscriptionRows.filter(
    (subscription) => subscription.stripePriceId === options.proPriceId,
  );

  const [selectedSubscription] = [...proPriceSubscriptions].sort((left, right) => {
    const leftIsPro = isProSubscription(left, options);
    const rightIsPro = isProSubscription(right, options);

    if (leftIsPro !== rightIsPro) {
      return leftIsPro ? -1 : 1;
    }

    const leftTime = left.currentPeriodStart?.getTime() ?? left.updatedAt.getTime();
    const rightTime = right.currentPeriodStart?.getTime() ?? right.updatedAt.getTime();

    return rightTime - leftTime;
  });

  if (!selectedSubscription) {
    return null;
  }

  return {
    status: selectedSubscription.status,
    cancelAtPeriodEnd: selectedSubscription.cancelAtPeriodEnd,
    currentPeriodEnd: selectedSubscription.currentPeriodEnd,
    cancelAt: selectedSubscription.cancelAt,
  };
};

export const createBillingRepository = (db: DbClient): BillingRepository => {
  const storage: SyncAppUserPlanStorage = {
    async ensureAppUser(userId) {
      await storageEnsureAppUser(db, userId);
    },
    async getAppUserPlan(userId) {
      return getAppUserPlan(db, userId);
    },
    async listSubscriptionsByUserId(userId) {
      return listSubscriptionPlans(db, userId);
    },
    async updateAppUserPlan(userId, plan) {
      await updateAppUserPlan(db, userId, plan);
    },
  };

  return {
    async getBillingStatus({ userId, proPriceId, now = new Date() }) {
      await storage.ensureAppUser(userId);

      const [appUser, subscriptionRows] = await Promise.all([
        db
          .select({ plan: appUsers.plan })
          .from(appUsers)
          .where(eq(appUsers.userId, userId))
          .limit(1),
        db
          .select({
            stripePriceId: subscriptions.stripePriceId,
            status: subscriptions.status,
            currentPeriodStart: subscriptions.currentPeriodStart,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
            cancelAt: subscriptions.cancelAt,
            updatedAt: subscriptions.updatedAt,
          })
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId)),
      ]);

      if (!appUser[0]) {
        throw new Error("App user was not created.");
      }

      const plan = derivePlanFromSubscriptions(subscriptionRows, { proPriceId, now });

      if (appUser[0].plan !== plan) {
        await storage.updateAppUserPlan(userId, plan);
      }

      return {
        plan,
        subscription: selectBillingSubscriptionSummary(subscriptionRows, {
          proPriceId,
          now,
        }),
      };
    },
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

      await db
        .insert(subscriptions)
        .values({
          id: ulid(),
          ...values,
        })
        .onConflictDoUpdate({
          target: subscriptions.stripeSubscriptionId,
          set: values,
        });
    },
  };
};
