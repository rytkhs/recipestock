import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").notNull(),
    originType: text("origin_type", { enum: ["manual", "url", "image", "text"] })
      .notNull()
      .default("manual"),
    sourceUrl: text("source_url"),
    normalizedSourceUrl: text("normalized_source_url"),
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

export const importJobs = pgTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["url"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull(),
    url: text("url"),
    normalizedUrl: text("normalized_url"),
    recipeId: text("recipe_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("import_jobs_user_id_updated_at_idx").on(table.userId, table.updatedAt),
    uniqueIndex("import_jobs_user_normalized_url_active_idx")
      .on(table.userId, table.normalizedUrl)
      .where(sql`${table.status} in ('queued', 'running') and ${table.normalizedUrl} is not null`),
  ],
);
