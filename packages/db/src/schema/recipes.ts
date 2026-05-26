import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").notNull(),
    sourceUrl: text("source_url"),
    normalizedSourceUrl: text("normalized_source_url"),
    sourceType: text("source_type").notNull(),
    sourcePlatform: text("source_platform"),
    sourceName: text("source_name"),
    searchText: text("search_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("recipes_user_id_updated_at_idx").on(table.userId, table.updatedAt),
    index("recipes_normalized_source_url_idx").on(table.userId, table.normalizedSourceUrl),
  ],
);
