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
  },
  (table) => [
    uniqueIndex("shortcut_credentials_token_hash_uidx").on(table.tokenHash),
    index("shortcut_credentials_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);
