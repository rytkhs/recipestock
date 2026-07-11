import { type DbClient, iosShareChannels, iosShareHandoffs } from "@recipestock/db";
import {
  type IosShareChannel,
  type IosShareHandoffStatus,
  type PendingIosShareHandoff,
} from "@recipestock/schemas";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

const HANDOFF_TTL_MS = 30 * 60 * 1000;
const TOKEN_PREFIX = "rssc_";

export type IosShareChannelRecord = {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenSuffix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type IosShareHandoffRecord = {
  id: string;
  channelId: string;
  userId: string;
  url: string;
  deliveredTarget: "pwa" | "browser" | null;
  deliveredAt: Date | null;
  supersededAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type IosShareRepository = {
  createChannel(channel: IosShareChannelRecord): Promise<IosShareChannelRecord>;
  listChannels(userId: string): Promise<IosShareChannelRecord[]>;
  revokeChannel(params: { channelId: string; userId: string; now: Date }): Promise<boolean>;
  submitHandoff(params: {
    id: string;
    tokenHash: string;
    url: string;
    now: Date;
    expiresAt: Date;
  }): Promise<IosShareHandoffRecord | null>;
  findPendingHandoff(params: { userId: string; now: Date }): Promise<IosShareHandoffRecord | null>;
  deliverHandoff(params: {
    handoffId: string;
    userId: string;
    target: "pwa" | "browser";
    now: Date;
  }): Promise<IosShareHandoffRecord | null>;
  inspectHandoff(params: {
    handoffId: string;
    tokenHash: string;
  }): Promise<IosShareHandoffRecord | null>;
};

export type IosShareService = {
  provisionChannel(params: {
    id: string;
    userId: string;
    name: string;
    token: string;
    now: Date;
  }): Promise<{ channel: IosShareChannel; token: string }>;
  listChannels(userId: string): Promise<IosShareChannel[]>;
  revokeChannel(params: { channelId: string; userId: string; now: Date }): Promise<boolean>;
  submitHandoff(params: {
    id: string;
    token: string;
    url: string;
    origin: string;
    now: Date;
  }): Promise<{
    handoffId: string;
    status: IosShareHandoffStatus;
    expiresAt: string;
    fallbackUrl: string;
  } | null>;
  findPendingHandoff(params: { userId: string; now: Date }): Promise<PendingIosShareHandoff | null>;
  deliverHandoff(params: {
    handoffId: string;
    userId: string;
    target: "pwa" | "browser";
    now: Date;
  }): Promise<IosShareHandoffStatus | null>;
  inspectHandoff(params: {
    handoffId: string;
    token: string;
    now: Date;
  }): Promise<IosShareHandoffStatus | null>;
};

type IosShareHandoffSqlRow = {
  id: string;
  channelId: string;
  userId: string;
  url: string;
  deliveredTarget: "pwa" | "browser" | null;
  deliveredAt: Date | string | null;
  supersededAt: Date | string | null;
  expiresAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const toDate = (value: Date | string | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value);

const mapHandoffSqlRow = (row: IosShareHandoffSqlRow): IosShareHandoffRecord => ({
  ...row,
  deliveredAt: toDate(row.deliveredAt),
  supersededAt: toDate(row.supersededAt),
  expiresAt: toDate(row.expiresAt) ?? new Date(0),
  createdAt: toDate(row.createdAt) ?? new Date(0),
  updatedAt: toDate(row.updatedAt) ?? new Date(0),
});

const mapHandoffRow = (row: typeof iosShareHandoffs.$inferSelect): IosShareHandoffRecord => ({
  ...row,
  deliveredTarget: row.deliveredTarget,
});

const mapChannel = (channel: IosShareChannelRecord): IosShareChannel => ({
  id: channel.id,
  name: channel.name,
  tokenSuffix: channel.tokenSuffix,
  createdAt: channel.createdAt.toISOString(),
  lastUsedAt: channel.lastUsedAt?.toISOString() ?? null,
});

export const createIosShareToken = () =>
  `${TOKEN_PREFIX}${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")}`;

export const hashIosShareToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
};

export const resolveIosShareHandoffStatus = (
  handoff: IosShareHandoffRecord,
  now: Date,
): IosShareHandoffStatus => {
  if (handoff.supersededAt) {
    return "superseded";
  }

  if (handoff.deliveredTarget === "pwa") {
    return "delivered_to_pwa";
  }

  if (handoff.deliveredTarget === "browser") {
    return "delivered_to_browser";
  }

  if (handoff.expiresAt <= now) {
    return "expired";
  }

  return "pending";
};

export const createIosShareRepository = (db: DbClient): IosShareRepository => ({
  async createChannel(channel) {
    const [row] = await db.insert(iosShareChannels).values(channel).returning();
    if (!row) {
      throw new Error("iOS share channel was not created.");
    }
    return row;
  },

  async listChannels(userId) {
    return db
      .select()
      .from(iosShareChannels)
      .where(and(eq(iosShareChannels.userId, userId), isNull(iosShareChannels.revokedAt)))
      .orderBy(desc(iosShareChannels.createdAt));
  },

  async revokeChannel({ channelId, userId, now }) {
    const [row] = await db
      .update(iosShareChannels)
      .set({ revokedAt: now })
      .where(
        and(
          eq(iosShareChannels.id, channelId),
          eq(iosShareChannels.userId, userId),
          isNull(iosShareChannels.revokedAt),
        ),
      )
      .returning({ id: iosShareChannels.id });
    return Boolean(row);
  },

  async submitHandoff({ id, tokenHash, url, now, expiresAt }) {
    const result = await db.execute<IosShareHandoffSqlRow>(sql`
      with selected_channel as (
        select id, user_id
        from ios_share_channels
        where token_hash = ${tokenHash}
          and revoked_at is null
        limit 1
      ),
      touched_channel as (
        update ios_share_channels
        set last_used_at = ${now.toISOString()}::timestamptz
        where id = (select id from selected_channel)
        returning id
      ),
      superseded as (
        update ios_share_handoffs
        set
          superseded_at = ${now.toISOString()}::timestamptz,
          updated_at = ${now.toISOString()}::timestamptz
        where channel_id = (select id from selected_channel)
          and delivered_at is null
          and superseded_at is null
        returning id
      ),
      inserted as (
        insert into ios_share_handoffs (
          id,
          channel_id,
          user_id,
          url,
          expires_at,
          created_at,
          updated_at
        )
        select
          ${id},
          selected_channel.id,
          selected_channel.user_id,
          ${url},
          ${expiresAt.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz
        from selected_channel
        where exists (select 1 from touched_channel)
        returning
          id,
          channel_id as "channelId",
          user_id as "userId",
          url,
          delivered_target as "deliveredTarget",
          delivered_at as "deliveredAt",
          superseded_at as "supersededAt",
          expires_at as "expiresAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
      )
      select * from inserted
    `);
    const row = result.rows[0];
    return row ? mapHandoffSqlRow(row) : null;
  },

  async findPendingHandoff({ userId, now }) {
    const [row] = await db
      .select({ handoff: iosShareHandoffs })
      .from(iosShareHandoffs)
      .innerJoin(
        iosShareChannels,
        and(
          eq(iosShareHandoffs.channelId, iosShareChannels.id),
          isNull(iosShareChannels.revokedAt),
        ),
      )
      .where(
        and(
          eq(iosShareHandoffs.userId, userId),
          isNull(iosShareHandoffs.deliveredAt),
          isNull(iosShareHandoffs.supersededAt),
          sql`${iosShareHandoffs.expiresAt} > ${now}`,
        ),
      )
      .orderBy(desc(iosShareHandoffs.createdAt), desc(iosShareHandoffs.id))
      .limit(1);
    return row ? mapHandoffRow(row.handoff) : null;
  },

  async deliverHandoff({ handoffId, userId, target, now }) {
    const [updated] = await db
      .update(iosShareHandoffs)
      .set({ deliveredTarget: target, deliveredAt: now, updatedAt: now })
      .where(
        and(
          eq(iosShareHandoffs.id, handoffId),
          eq(iosShareHandoffs.userId, userId),
          isNull(iosShareHandoffs.deliveredAt),
          isNull(iosShareHandoffs.supersededAt),
          sql`${iosShareHandoffs.expiresAt} > ${now}`,
        ),
      )
      .returning();

    if (updated) {
      return mapHandoffRow(updated);
    }

    const [existing] = await db
      .select()
      .from(iosShareHandoffs)
      .where(and(eq(iosShareHandoffs.id, handoffId), eq(iosShareHandoffs.userId, userId)))
      .limit(1);
    return existing ? mapHandoffRow(existing) : null;
  },

  async inspectHandoff({ handoffId, tokenHash }) {
    const [row] = await db
      .select({ handoff: iosShareHandoffs })
      .from(iosShareHandoffs)
      .innerJoin(
        iosShareChannels,
        and(
          eq(iosShareHandoffs.channelId, iosShareChannels.id),
          eq(iosShareChannels.tokenHash, tokenHash),
          isNull(iosShareChannels.revokedAt),
        ),
      )
      .where(eq(iosShareHandoffs.id, handoffId))
      .limit(1);
    return row ? mapHandoffRow(row.handoff) : null;
  },
});

export const createIosShareService = (repository: IosShareRepository): IosShareService => ({
  async provisionChannel({ id, userId, name, token, now }) {
    const channel = await repository.createChannel({
      id,
      userId,
      name,
      tokenHash: await hashIosShareToken(token),
      tokenSuffix: token.slice(-6),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    });
    return { channel: mapChannel(channel), token };
  },

  async listChannels(userId) {
    return (await repository.listChannels(userId)).map(mapChannel);
  },

  revokeChannel(params) {
    return repository.revokeChannel(params);
  },

  async submitHandoff({ id, token, url, origin, now }) {
    const expiresAt = new Date(now.getTime() + HANDOFF_TTL_MS);
    const handoff = await repository.submitHandoff({
      id,
      tokenHash: await hashIosShareToken(token),
      url,
      now,
      expiresAt,
    });
    if (!handoff) {
      return null;
    }

    const fallbackUrl = new URL("/import/url", origin);
    fallbackUrl.searchParams.set("url", handoff.url);
    fallbackUrl.searchParams.set("handoff", handoff.id);
    fallbackUrl.searchParams.set("source", "ios-shortcut");

    return {
      handoffId: handoff.id,
      status: resolveIosShareHandoffStatus(handoff, now),
      expiresAt: handoff.expiresAt.toISOString(),
      fallbackUrl: fallbackUrl.toString(),
    };
  },

  async findPendingHandoff({ userId, now }) {
    const handoff = await repository.findPendingHandoff({ userId, now });
    return handoff
      ? { id: handoff.id, url: handoff.url, createdAt: handoff.createdAt.toISOString() }
      : null;
  },

  async deliverHandoff(params) {
    const handoff = await repository.deliverHandoff(params);
    return handoff ? resolveIosShareHandoffStatus(handoff, params.now) : null;
  },

  async inspectHandoff({ handoffId, token, now }) {
    const handoff = await repository.inspectHandoff({
      handoffId,
      tokenHash: await hashIosShareToken(token),
    });
    return handoff ? resolveIosShareHandoffStatus(handoff, now) : null;
  },
});
