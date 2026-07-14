import { type DbClient, pushSubscriptions } from "@recipestock/db";
import { and, desc, eq } from "drizzle-orm";

export type PushSubscriptionSummary = {
  endpoint: string;
  expirationTime: string | null;
};

export type PushDeliveryTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type RegisterPushSubscriptionInput = {
  id: string;
  userId: string;
  endpoint: string;
  expirationTime: number | null;
  p256dh: string;
  auth: string;
  now: Date;
};

export type PushSubscriptionRepository = {
  listByUser(userId: string): Promise<PushSubscriptionSummary[]>;
  listDeliveryTargets(userId: string): Promise<PushDeliveryTarget[]>;
  register(input: RegisterPushSubscriptionInput): Promise<PushSubscriptionSummary | null>;
  revoke(input: { userId: string; endpoint: string }): Promise<boolean>;
};

const toSummary = (row: { endpoint: string; expirationTime: Date | null }) => ({
  endpoint: row.endpoint,
  expirationTime: row.expirationTime?.toISOString() ?? null,
});

export const createPushSubscriptionRepository = (db: DbClient): PushSubscriptionRepository => ({
  async listByUser(userId) {
    const rows = await db
      .select({
        endpoint: pushSubscriptions.endpoint,
        expirationTime: pushSubscriptions.expirationTime,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt));

    return rows.map(toSummary);
  },

  async listDeliveryTargets(userId) {
    return db
      .select({
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt));
  },

  async register({ id, userId, endpoint, expirationTime, p256dh, auth, now }) {
    const expirationDate = expirationTime === null ? null : new Date(expirationTime);
    const [row] = await db
      .insert(pushSubscriptions)
      .values({
        id,
        userId,
        endpoint,
        expirationTime: expirationDate,
        p256dh,
        auth,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          expirationTime: expirationDate,
          p256dh,
          auth,
          updatedAt: now,
        },
        setWhere: eq(pushSubscriptions.userId, userId),
      })
      .returning({
        endpoint: pushSubscriptions.endpoint,
        expirationTime: pushSubscriptions.expirationTime,
      });

    return row ? toSummary(row) : null;
  },

  async revoke({ userId, endpoint }) {
    const rows = await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning({ id: pushSubscriptions.id });
    return rows.length > 0;
  },
});
