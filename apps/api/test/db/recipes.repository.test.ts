import { neonConfig } from "@neondatabase/serverless";
import { createDb, recipes } from "@recipestock/db";
import { type RecipeListSort } from "@recipestock/schemas";
import { PLAN_LIMITS } from "@recipestock/shared";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createRecipeRepository,
  type ListRecipesResult,
  type RecipeRepository,
} from "../../src/recipes";

const baseTime = new Date("2026-07-20T00:00:00.000Z").getTime();
const minutesAfterBase = (minutes: number) => new Date(baseTime + minutes * 60_000);

describe("Recipe repository with Neon Postgres", () => {
  let db: ReturnType<typeof createDb>;
  let repository: RecipeRepository;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests.");
    }

    const connectionUrl = new URL(databaseUrl);
    neonConfig.fetchEndpoint = `http://${connectionUrl.hostname}:${connectionUrl.port}/sql`;
    neonConfig.poolQueryViaFetch = true;
    neonConfig.useSecureWebSocket = false;
    db = createDb(databaseUrl);
    // subscriptionを持たないユーザーはfreeと導出される。
    repository = createRecipeRepository(db, { proPriceId: "price_dbtest_pro" });
  });

  const insertRecipes = (
    userId: string,
    rows: readonly { id: string; createdAt: Date; updatedAt?: Date; searchText?: string }[],
  ) =>
    db.insert(recipes).values(
      rows.map((row) => ({
        id: row.id,
        userId,
        title: row.id,
        content: { title: row.id, referenceImages: [], ingredientGroups: [], steps: [] },
        searchText: row.searchText ?? row.id,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? row.createdAt,
      })),
    );

  const listAllIds = async (userId: string, sort: RecipeListSort, limit: number) => {
    const ids: string[] = [];
    let cursor: string | null = null;

    do {
      const page: ListRecipesResult = await repository.listRecipes({
        userId,
        searchTerms: [],
        tagIds: [],
        untagged: false,
        sort,
        limit,
        cursor,
      });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    return ids;
  };

  // エスケープしないと、`%`だけの検索語が全件に、`_`が任意の1文字に当たる。
  it("検索語のILIKEワイルドカードを文字そのものとして照合する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_recipe_search_user_${runId}`;
    const id = (name: string) => `dbtest_recipe_search_${name}_${runId}`;

    await insertRecipes(userId, [
      { id: id("plain"), createdAt: minutesAfterBase(0), searchText: "tomato pasta" },
      { id: id("percent"), createdAt: minutesAfterBase(1), searchText: "50% cream" },
      { id: id("underscore"), createdAt: minutesAfterBase(2), searchText: "tomato_pasta" },
    ]);

    const search = async (term: string) => {
      const { items } = await repository.listRecipes({
        userId,
        searchTerms: [term],
        tagIds: [],
        untagged: false,
        sort: "newest",
        limit: 20,
        cursor: null,
      });

      return items.map((item) => item.id);
    };

    await expect(search("%")).resolves.toEqual([id("percent")]);
    await expect(search("tomato_")).resolves.toEqual([id("underscore")]);
    await expect(search("tomato")).resolves.toEqual([id("underscore"), id("plain")]);
  });

  it("追加日の新しい順と古い順で、同時刻のRecipeがページをまたいでも抜けや重複なく並べる", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_recipe_sort_user_${runId}`;
    const id = (name: string) => `dbtest_recipe_sort_${name}_${runId}`;

    // bとcは同時刻に追加する。dは最後に編集していても追加日の位置に並ぶ。
    await insertRecipes(userId, [
      { id: id("a"), createdAt: minutesAfterBase(0) },
      { id: id("b"), createdAt: minutesAfterBase(1) },
      { id: id("c"), createdAt: minutesAfterBase(1) },
      { id: id("d"), createdAt: minutesAfterBase(2), updatedAt: minutesAfterBase(60) },
      { id: id("e"), createdAt: minutesAfterBase(3) },
    ]);

    // どちらの向きも、同時刻のbとcの間がページの境目になる件数で引く。
    await expect(listAllIds(userId, "newest", 3)).resolves.toEqual(
      ["e", "d", "c", "b", "a"].map((name) => id(name)),
    );
    await expect(listAllIds(userId, "oldest", 2)).resolves.toEqual(
      ["a", "b", "c", "d", "e"].map((name) => id(name)),
    );
  });

  it("Freeのロックは更新日によらず、新しく保存した件数枠の外にかかる", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_recipe_lock_user_${runId}`;
    const unlockedCount = PLAN_LIMITS.free.savedRecipes;
    const recipeCount = unlockedCount + 2;
    const id = (index: number) => `dbtest_recipe_lock_${index}_${runId}`;

    // 最も古いRecipeを最後に編集していても、開けておく枠には入らない。
    await insertRecipes(
      userId,
      Array.from({ length: recipeCount }, (_, index) => ({
        id: id(index),
        createdAt: minutesAfterBase(index),
        updatedAt: minutesAfterBase(index === 0 ? 60 : index),
      })),
    );

    const { items } = await repository.listRecipes({
      userId,
      searchTerms: [],
      tagIds: [],
      untagged: false,
      sort: "newest",
      limit: 20,
      cursor: null,
    });

    expect(items.map((item) => [item.id, item.locked])).toEqual(
      Array.from({ length: recipeCount }, (_, position) => [
        id(recipeCount - 1 - position),
        position >= unlockedCount,
      ]),
    );
    await expect(repository.getRecipe(userId, id(0))).resolves.toMatchObject({ locked: true });
    await expect(repository.getRecipe(userId, id(recipeCount - 1))).resolves.toMatchObject({
      locked: false,
    });
  });
});
