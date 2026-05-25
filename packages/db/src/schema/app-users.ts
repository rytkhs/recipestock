import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const appUsers = pgTable("app_users", {
  userId: text("user_id").primaryKey(),
  plan: text("plan", { enum: ["free", "pro"] })
    .notNull()
    .default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
