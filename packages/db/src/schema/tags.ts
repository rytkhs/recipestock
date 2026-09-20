import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { recipes } from "./recipes";

// タグは利用者ごとの語彙。同じ利用者の中では、表示名を小文字にしたnormalized_nameで一つに収束させる。
// positionは利用者が決めた並び。並びはposition, created_at, idで決まるので、
// 同時に作って値が重なっても、消して隙間ができても困らない。一意制約も索引も置かない。
export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tags_user_id_normalized_name_uidx").on(table.userId, table.normalizedName),
  ],
);

// Recipeとタグのどちらを消しても付与は残さない。created_atは付けた順に並べるために持つ。
export const recipeTags = pgTable(
  "recipe_tags",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.recipeId, table.tagId] }),
    index("recipe_tags_tag_id_idx").on(table.tagId),
  ],
);
