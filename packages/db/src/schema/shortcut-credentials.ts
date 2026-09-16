import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const shortcutCredentials = pgTable(
  "shortcut_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** 初回の共有でShortcutから受け取るまでは決まらない (ADR 0025)。 */
    name: text("name"),
    tokenHash: text("token_hash").notNull(),
    tokenSuffix: text("token_suffix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** 認証が初めて成功した時刻。発行済みと連携済みを区別する (ADR 0025)。 */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("shortcut_credentials_token_hash_uidx").on(table.tokenHash),
    index("shortcut_credentials_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);
