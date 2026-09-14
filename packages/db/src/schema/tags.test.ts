import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { recipeTags, tags } from "./tags";

describe("tags schema", () => {
  it("同じ利用者の中で、揃えた名前ごとにタグを一つにする", () => {
    const config = getTableConfig(tags);
    const index = config.indexes.find(
      (candidate) => candidate.config.name === "tags_user_id_normalized_name_uidx",
    );

    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns).toHaveLength(2);
  });

  it("Recipeとタグの組を一つだけ持ち、どちらを消しても付与を消す", () => {
    const config = getTableConfig(recipeTags);

    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "recipe_id",
      "tag_id",
    ]);
    expect(config.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
      "cascade",
      "cascade",
    ]);
  });
});
