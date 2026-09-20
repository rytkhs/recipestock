import { neonConfig } from "@neondatabase/serverless";
import { createDb, recipes, recipeTags } from "@recipestock/db";
import { type RecipeListSort } from "@recipestock/schemas";
import { PLAN_LIMITS } from "@recipestock/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createRecipeRepository,
  type ListRecipesParams,
  type ListRecipesResult,
  type RecipeRepository,
} from "../../src/recipes";
import {
  createTagRepository,
  normalizeRequestedTagNames,
  type TagRepository,
} from "../../src/tags";

const baseTime = new Date("2026-07-20T00:00:00.000Z").getTime();
const minutesAfterBase = (minutes: number) => new Date(baseTime + minutes * 60_000);

const tagNames = (...names: string[]) => {
  const normalized = normalizeRequestedTagNames(names);

  if (!normalized) {
    throw new Error(`Invalid tag names: ${names.join(", ")}`);
  }

  return normalized;
};

describe("Tag repository with Neon Postgres", () => {
  let db: ReturnType<typeof createDb>;
  let recipeRepository: RecipeRepository;
  let tagRepository: TagRepository;

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
    recipeRepository = createRecipeRepository(db, { proPriceId: "price_dbtest_pro" });
    tagRepository = createTagRepository(db);
  });

  const insertRecipes = (
    userId: string,
    rows: readonly { id: string; createdAt: Date; searchText?: string }[],
  ) =>
    db.insert(recipes).values(
      rows.map((row) => ({
        id: row.id,
        userId,
        title: row.id,
        content: { title: row.id, referenceImages: [], ingredientGroups: [], steps: [] },
        searchText: row.searchText ?? row.id,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      })),
    );

  const replaceTags = async (
    userId: string,
    recipeId: string,
    names: string[],
    minutes: number,
  ) => {
    const tags = await tagRepository.replaceRecipeTags({
      userId,
      recipeId,
      names: tagNames(...names),
      now: minutesAfterBase(minutes),
    });

    if (!tags) {
      throw new Error(`Recipe was not found: ${recipeId}`);
    }

    return tags;
  };

  const tagIdOf = async (userId: string, name: string) => {
    const tag = (await tagRepository.listTags(userId)).find((candidate) => candidate.name === name);

    if (!tag) {
      throw new Error(`Tag was not found: ${name}`);
    }

    return tag.id;
  };

  const listAll = async (
    userId: string,
    filter: Partial<Pick<ListRecipesParams, "searchTerms" | "tagIds" | "untagged">>,
    { sort = "newest", limit = 20 }: { sort?: RecipeListSort; limit?: number } = {},
  ) => {
    const items: ListRecipesResult["items"] = [];
    let cursor: string | null = null;

    do {
      const page: ListRecipesResult = await recipeRepository.listRecipes({
        userId,
        searchTerms: [],
        tagIds: [],
        untagged: false,
        ...filter,
        sort,
        limit,
        cursor,
      });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    return items;
  };

  it("Recipeのタグの組を置き換え、残したタグは付けた順を保ち、外したタグも語彙に残す", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_tags_replace_user_${runId}`;
    const recipeA = `dbtest_tags_replace_a_${runId}`;
    const recipeB = `dbtest_tags_replace_b_${runId}`;

    await insertRecipes(userId, [
      { id: recipeA, createdAt: minutesAfterBase(0) },
      { id: recipeB, createdAt: minutesAfterBase(0) },
    ]);

    await replaceTags(userId, recipeA, ["作り置き"], 1);
    await replaceTags(userId, recipeA, ["作り置き", "鶏肉"], 2);
    await expect(replaceTags(userId, recipeA, ["鶏肉", "お弁当", "作り置き"], 3)).resolves.toEqual([
      expect.objectContaining({ name: "作り置き" }),
      expect.objectContaining({ name: "鶏肉" }),
      expect.objectContaining({ name: "お弁当" }),
    ]);

    await replaceTags(userId, recipeA, ["お弁当"], 4);
    await expect(recipeRepository.getRecipe(userId, recipeA)).resolves.toMatchObject({
      tags: [expect.objectContaining({ name: "お弁当" })],
    });
    // 語彙は作った順に並び、付いている件数では動かない。
    await expect(tagRepository.listTags(userId)).resolves.toEqual([
      expect.objectContaining({ name: "作り置き", recipeCount: 0 }),
      expect.objectContaining({ name: "鶏肉", recipeCount: 0 }),
      expect.objectContaining({ name: "お弁当", recipeCount: 1 }),
    ]);

    // 揃えた名前が同じなら既存のタグを使い、最初に付けたときの表示名のまま返す。
    const [bbq] = await replaceTags(userId, recipeA, ["BBQ"], 5);
    await expect(replaceTags(userId, recipeB, ["#bbq"], 6)).resolves.toEqual([
      { id: bbq?.id, name: "BBQ" },
    ]);

    await expect(replaceTags(userId, recipeA, [], 7)).resolves.toEqual([]);
  });

  it("他人のRecipeにはタグを付けず、タグも作らない", async () => {
    const runId = crypto.randomUUID();
    const ownerId = `dbtest_tags_owner_${runId}`;
    const otherUserId = `dbtest_tags_other_${runId}`;
    const recipeId = `dbtest_tags_owner_recipe_${runId}`;

    await insertRecipes(ownerId, [{ id: recipeId, createdAt: minutesAfterBase(0) }]);

    await expect(
      tagRepository.replaceRecipeTags({
        userId: otherUserId,
        recipeId,
        names: tagNames("作り置き"),
        now: minutesAfterBase(1),
      }),
    ).resolves.toBeNull();
    await expect(tagRepository.listTags(otherUserId)).resolves.toEqual([]);
    await expect(tagRepository.listTags(ownerId)).resolves.toEqual([]);
  });

  it("指定したタグがすべて付いたRecipeに絞り、ページをまたいでも抜けや重複なく並べる", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_tags_filter_user_${runId}`;
    const id = (index: number) => `dbtest_tags_filter_${index}_${runId}`;

    await insertRecipes(
      userId,
      Array.from({ length: 5 }, (_, index) => ({
        id: id(index),
        createdAt: minutesAfterBase(index),
      })),
    );
    await replaceTags(userId, id(0), ["鶏肉"], 10);
    await replaceTags(userId, id(1), ["鶏肉", "作り置き"], 11);
    await replaceTags(userId, id(3), ["作り置き", "鶏肉"], 12);
    await replaceTags(userId, id(4), ["鶏肉", "作り置き"], 13);

    const chicken = await tagIdOf(userId, "鶏肉");
    const mealPrep = await tagIdOf(userId, "作り置き");
    const ids = (items: ListRecipesResult["items"]) => items.map((item) => item.id);

    await expect(
      listAll(userId, { tagIds: [chicken, mealPrep] }, { limit: 2 }).then(ids),
    ).resolves.toEqual([id(4), id(3), id(1)]);
    await expect(
      listAll(userId, { tagIds: [chicken] }, { sort: "oldest", limit: 3 }).then(ids),
    ).resolves.toEqual([id(0), id(1), id(3), id(4)]);
    await expect(listAll(userId, { untagged: true }).then(ids)).resolves.toEqual([id(2)]);
  });

  it("検索語はsearchTextかタグ名のどちらかに当たればよい", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_tags_search_user_${runId}`;
    const tomato = `dbtest_tags_search_tomato_${runId}`;
    const potato = `dbtest_tags_search_potato_${runId}`;

    await insertRecipes(userId, [
      { id: tomato, createdAt: minutesAfterBase(0), searchText: "tomato pasta" },
      { id: potato, createdAt: minutesAfterBase(1), searchText: "potato salad" },
    ]);
    await replaceTags(userId, tomato, ["作り置き"], 10);
    await replaceTags(userId, potato, ["BBQ"], 11);

    const ids = (items: ListRecipesResult["items"]) => items.map((item) => item.id);

    await expect(listAll(userId, { searchTerms: ["作り置"] }).then(ids)).resolves.toEqual([tomato]);
    await expect(listAll(userId, { searchTerms: ["bbq"] }).then(ids)).resolves.toEqual([potato]);
    await expect(
      listAll(userId, { searchTerms: ["tomato", "作り置き"] }).then(ids),
    ).resolves.toEqual([tomato]);
    await expect(listAll(userId, { searchTerms: ["potato", "作り置き"] })).resolves.toEqual([]);
  });

  it("Freeのロックはタグで絞っても、どちらの向きでも一続きになる", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_tags_lock_user_${runId}`;
    const recipeCount = PLAN_LIMITS.free.savedRecipes + 2;
    const id = (index: number) => `dbtest_tags_lock_${index}_${runId}`;

    await insertRecipes(
      userId,
      Array.from({ length: recipeCount }, (_, index) => ({
        id: id(index),
        createdAt: minutesAfterBase(index),
      })),
    );

    // 最も古いRecipe（開けておく枠の外）と、枠の内側の2件に付ける。
    for (const index of [0, 3, recipeCount - 1]) {
      await replaceTags(userId, id(index), ["定番"], 100 + index);
    }

    const staple = await tagIdOf(userId, "定番");
    const lockState = (items: ListRecipesResult["items"]) =>
      items.map((item) => [item.id, item.locked]);

    await expect(listAll(userId, { tagIds: [staple] }).then(lockState)).resolves.toEqual([
      [id(recipeCount - 1), false],
      [id(3), false],
      [id(0), true],
    ]);
    await expect(
      listAll(userId, { tagIds: [staple] }, { sort: "oldest" }).then(lockState),
    ).resolves.toEqual([
      [id(0), true],
      [id(3), false],
      [id(recipeCount - 1), false],
    ]);
  });

  it("並びは送った順になり、送られなかったタグは相対順のまま後ろに残る", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_tags_order_user_${runId}`;
    const otherUserId = `dbtest_tags_order_other_${runId}`;
    const recipeId = `dbtest_tags_order_recipe_${runId}`;
    const otherRecipeId = `dbtest_tags_order_other_recipe_${runId}`;

    await insertRecipes(userId, [{ id: recipeId, createdAt: minutesAfterBase(0) }]);
    await insertRecipes(otherUserId, [{ id: otherRecipeId, createdAt: minutesAfterBase(0) }]);
    await replaceTags(userId, recipeId, ["主菜", "副菜", "作り置き"], 1);
    await replaceTags(otherUserId, otherRecipeId, ["主菜", "副菜"], 1);

    const namesOf = (id: string) =>
      tagRepository.listTags(id).then((listed) => listed.map((tag) => tag.name));

    // 新しく作ったタグは語彙の末尾に入る。
    await replaceTags(userId, recipeId, ["主菜", "副菜", "作り置き", "お弁当"], 2);
    await expect(namesOf(userId)).resolves.toEqual(["主菜", "副菜", "作り置き", "お弁当"]);

    const bento = await tagIdOf(userId, "お弁当");
    const mealPrep = await tagIdOf(userId, "作り置き");
    const otherMain = await tagIdOf(otherUserId, "主菜");

    // 他人のタグと消えたidは無視し、送られなかった「主菜」「副菜」は今の順のまま後ろに回す。
    await tagRepository.reorderTags({
      userId,
      tagIds: [bento, otherMain, `dbtest_tags_order_missing_${runId}`, mealPrep],
      now: minutesAfterBase(3),
    });

    await expect(namesOf(userId)).resolves.toEqual(["お弁当", "作り置き", "主菜", "副菜"]);
    await expect(namesOf(otherUserId)).resolves.toEqual(["主菜", "副菜"]);

    // 並べ替えた後に作ったタグも末尾に入る。
    await replaceTags(userId, recipeId, ["主菜", "汁物"], 4);
    await expect(namesOf(userId)).resolves.toEqual(["お弁当", "作り置き", "主菜", "副菜", "汁物"]);
  });

  it("名前の変更は、別のタグと重なれば変えずにそのタグを返す", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_tags_rename_user_${runId}`;
    const otherUserId = `dbtest_tags_rename_other_${runId}`;
    const recipeId = `dbtest_tags_rename_recipe_${runId}`;

    await insertRecipes(userId, [{ id: recipeId, createdAt: minutesAfterBase(0) }]);
    await replaceTags(userId, recipeId, ["とり肉", "鶏肉"], 1);

    const toriniku = await tagIdOf(userId, "とり肉");
    const chicken = await tagIdOf(userId, "鶏肉");
    const [chickenName] = tagNames("鶏肉");
    const [katakanaName] = tagNames("ﾄﾘﾆｸ");
    const [sameName] = tagNames("トリニク ");

    if (!chickenName || !katakanaName || !sameName) {
      throw new Error("Tag names were not normalized.");
    }

    await expect(
      tagRepository.renameTag({
        userId,
        tagId: toriniku,
        name: chickenName,
        now: minutesAfterBase(2),
      }),
    ).resolves.toEqual({ status: "conflict", tag: { id: chicken, name: "鶏肉" } });
    await expect(
      tagRepository.renameTag({
        userId,
        tagId: toriniku,
        name: katakanaName,
        now: minutesAfterBase(3),
      }),
    ).resolves.toEqual({ status: "renamed", tag: { id: toriniku, name: "トリニク" } });
    // 自分自身の名前とは重ならない。
    await expect(
      tagRepository.renameTag({
        userId,
        tagId: toriniku,
        name: sameName,
        now: minutesAfterBase(4),
      }),
    ).resolves.toEqual({ status: "renamed", tag: { id: toriniku, name: "トリニク" } });
    await expect(
      tagRepository.renameTag({
        userId: otherUserId,
        tagId: toriniku,
        name: chickenName,
        now: minutesAfterBase(5),
      }),
    ).resolves.toEqual({ status: "notFound" });
  });

  it("統合すると付与を統合先へ移し、両方付いていたRecipeでは重複させず早い方の付けた日時を残す", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_tags_merge_user_${runId}`;
    const both = `dbtest_tags_merge_both_${runId}`;
    const sourceOnly = `dbtest_tags_merge_source_${runId}`;

    await insertRecipes(userId, [
      { id: both, createdAt: minutesAfterBase(0) },
      { id: sourceOnly, createdAt: minutesAfterBase(1) },
    ]);
    // 統合元を先に付け、統合先はその間に付けた「作り置き」より後に付ける。
    await replaceTags(userId, both, ["とり肉"], 10);
    await replaceTags(userId, both, ["とり肉", "作り置き"], 11);
    await replaceTags(userId, both, ["とり肉", "作り置き", "鶏肉"], 12);
    await replaceTags(userId, sourceOnly, ["とり肉"], 13);

    const source = await tagIdOf(userId, "とり肉");
    const target = await tagIdOf(userId, "鶏肉");
    const mealPrep = await tagIdOf(userId, "作り置き");

    await expect(
      tagRepository.mergeTag({ userId, tagId: source, intoTagId: source }),
    ).resolves.toEqual({ status: "notFound" });
    await expect(
      tagRepository.mergeTag({ userId, tagId: source, intoTagId: target }),
    ).resolves.toEqual({ status: "merged", tag: { id: target, name: "鶏肉" } });

    await expect(recipeRepository.getRecipe(userId, both)).resolves.toMatchObject({
      tags: [
        { id: target, name: "鶏肉" },
        { id: mealPrep, name: "作り置き" },
      ],
    });
    await expect(recipeRepository.getRecipe(userId, sourceOnly)).resolves.toMatchObject({
      tags: [{ id: target, name: "鶏肉" }],
    });
    // 統合しても残ったタグの並びは変わらない。
    await expect(tagRepository.listTags(userId)).resolves.toEqual([
      { id: mealPrep, name: "作り置き", recipeCount: 1 },
      { id: target, name: "鶏肉", recipeCount: 2 },
    ]);
    await expect(
      tagRepository.mergeTag({ userId, tagId: source, intoTagId: target }),
    ).resolves.toEqual({ status: "notFound" });
  });

  it("タグを消すと付与も消え、Recipeを消すとそのRecipeの付与も消える", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_tags_delete_user_${runId}`;
    const kept = `dbtest_tags_delete_kept_${runId}`;
    const removed = `dbtest_tags_delete_removed_${runId}`;

    await insertRecipes(userId, [
      { id: kept, createdAt: minutesAfterBase(0) },
      { id: removed, createdAt: minutesAfterBase(1) },
    ]);
    await replaceTags(userId, kept, ["作り置き", "鶏肉"], 10);
    await replaceTags(userId, removed, ["鶏肉"], 11);

    const mealPrep = await tagIdOf(userId, "作り置き");

    await expect(tagRepository.deleteTag(userId, mealPrep)).resolves.toBe(true);
    await expect(tagRepository.deleteTag(userId, mealPrep)).resolves.toBe(false);
    await expect(recipeRepository.getRecipe(userId, kept)).resolves.toMatchObject({
      tags: [expect.objectContaining({ name: "鶏肉" })],
    });

    await expect(recipeRepository.deleteRecipe(userId, removed)).resolves.toBe(true);
    await expect(
      db.select().from(recipeTags).where(eq(recipeTags.recipeId, removed)),
    ).resolves.toEqual([]);
  });
});
