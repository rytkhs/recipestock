import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const iosShareChannels = pgTable(
  "ios_share_channels",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenSuffix: text("token_suffix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ios_share_channels_token_hash_uidx").on(table.tokenHash),
    index("ios_share_channels_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const iosShareHandoffs = pgTable(
  "ios_share_handoffs",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    userId: text("user_id").notNull(),
    url: text("url").notNull(),
    deliveredTarget: text("delivered_target", { enum: ["pwa", "browser"] }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ios_share_handoffs_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("ios_share_handoffs_channel_id_created_at_idx").on(table.channelId, table.createdAt),
    uniqueIndex("ios_share_handoffs_channel_pending_uidx")
      .on(table.channelId)
      .where(sql`${table.deliveredAt} is null and ${table.supersededAt} is null`),
  ],
);
