import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const shortcutCredentials = pgTable(
  "shortcut_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenSuffix: text("token_suffix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** 認証に初めて成功した時刻。以降の認証では書き込まない（ADR 0025）。 */
    firstUsedAt: timestamp("first_used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("shortcut_credentials_token_hash_uidx").on(table.tokenHash),
    index("shortcut_credentials_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);
