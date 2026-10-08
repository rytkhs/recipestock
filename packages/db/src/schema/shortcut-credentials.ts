import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const shortcutCredentials = pgTable(
  "shortcut_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // 認証を通ったrequestの時刻。取り込みを受け付けたかどうかは問わない。
    // 最初の時刻は連携の設定が済んだ時点なので上書きしない。
    firstUsedAt: timestamp("first_used_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("shortcut_credentials_token_hash_uidx").on(table.tokenHash),
    index("shortcut_credentials_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);
