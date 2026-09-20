import { MAX_RECIPE_TAGS } from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { type RecipeRepository, type RecipeWithTagsRecord } from "../recipes";
import { type ReplaceRecipeTagsParams, type TagRepository } from "../tags";
import { createSilentTestApp, createTestAuth } from "../test-helpers";
import { unusedDeleteRecipe, unusedListRecipes, unusedUpdateRecipe } from "./test-helpers";

const savedRecipe = (overrides: Partial<RecipeWithTagsRecord> = {}): RecipeWithTagsRecord => ({
  id: "recipe_123",
  userId: "user_123",
  title: "Tomato pasta",
  content: {
    title: "Tomato pasta",
    referenceImages: [],
    ingredientGroups: [],
    steps: [],
  },
  originType: "manual",
  sourceUrl: null,
  normalizedSourceUrl: null,
  sourceName: null,
  searchText: "tomato pasta",
  createdAt: new Date("2026-05-26T00:00:00.000Z"),
  updatedAt: new Date("2026-05-26T00:00:00.000Z"),
  tags: [],
  ...overrides,
});

const createRecipeRepositoryStub = (
  getRecipe: RecipeRepository["getRecipe"],
): RecipeRepository => ({
  createRecipeEnforcingPlanLimit: async () => {
    throw new Error("should not create a recipe");
  },
  getRecipe,
  listRecipes: unusedListRecipes,
  updateRecipe: unusedUpdateRecipe,
  deleteRecipe: unusedDeleteRecipe,
});

const createTagRepositoryStub = (
  replaceRecipeTags: TagRepository["replaceRecipeTags"] = async () => {
    throw new Error("should not replace recipe tags");
  },
): TagRepository => ({
  listTags: async () => {
    throw new Error("should not list tags");
  },
  replaceRecipeTags,
  renameTag: async () => {
    throw new Error("should not rename a tag");
  },
  reorderTags: async () => {
    throw new Error("should not reorder tags");
  },
  mergeTag: async () => {
    throw new Error("should not merge tags");
  },
  deleteTag: async () => {
    throw new Error("should not delete a tag");
  },
});

const putRecipeTags = (app: ReturnType<typeof createSilentTestApp>, body: unknown) =>
  app.request(
    "/api/recipes/recipe_123/tags",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { APP_ENV: "development" },
  );

describe("Recipe tag routes", () => {
  it("未ログインではRecipeのタグを置き換えない", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(null),
      recipeRepository: createRecipeRepositoryStub(async () => {
        throw new Error("should not get a recipe without a session");
      }),
      tagRepository: createTagRepositoryStub(),
    });

    const response = await putRecipeTags(testApp, { names: ["作り置き"] });

    expect(response.status).toBe(401);
  });

  it("名前を揃えて同じ名前をまとめてから、Recipeのタグを置き換える", async () => {
    const calls: ReplaceRecipeTagsParams[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: createRecipeRepositoryStub(async (userId, recipeId) =>
        savedRecipe({ id: recipeId, userId }),
      ),
      tagRepository: createTagRepositoryStub(async (params) => {
        calls.push(params);
        return [
          { id: "tag_1", name: "BBQ" },
          { id: "tag_2", name: "作り置き" },
        ];
      }),
    });

    const response = await putRecipeTags(testApp, { names: ["#BBQ", "ｂｂｑ", " 作り置き "] });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        userId: "user_123",
        recipeId: "recipe_123",
        names: [
          { name: "BBQ", normalizedName: "bbq" },
          { name: "作り置き", normalizedName: "作り置き" },
        ],
        now: expect.any(Date),
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      tags: [
        { id: "tag_1", name: "BBQ" },
        { id: "tag_2", name: "作り置き" },
      ],
    });
  });

  it("タグを空にするとRecipeからすべて外す", async () => {
    const calls: ReplaceRecipeTagsParams[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: createRecipeRepositoryStub(async () =>
        savedRecipe({ tags: [{ id: "tag_1", name: "作り置き" }] }),
      ),
      tagRepository: createTagRepositoryStub(async (params) => {
        calls.push(params);
        return [];
      }),
    });

    const response = await putRecipeTags(testApp, { names: [] });

    expect(response.status).toBe(200);
    expect(calls.map((call) => call.names)).toEqual([[]]);
    await expect(response.json()).resolves.toEqual({ tags: [] });
  });

  it("存在しないRecipeにはタグを付けない", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: createRecipeRepositoryStub(async () => null),
      tagRepository: createTagRepositoryStub(),
    });

    const response = await putRecipeTags(testApp, { names: ["作り置き"] });

    expect(response.status).toBe(404);
  });

  it("ロック中のRecipeにはタグを付けない", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: createRecipeRepositoryStub(async () => savedRecipe({ locked: true })),
      tagRepository: createTagRepositoryStub(),
    });

    const response = await putRecipeTags(testApp, { names: ["作り置き"] });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "locked_recipe" } });
  });

  it("揃えると空になる名前、長すぎる名前、多すぎるタグはvalidation_failedにする", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: createRecipeRepositoryStub(async () => savedRecipe()),
      tagRepository: createTagRepositoryStub(),
    });

    for (const body of [
      { names: ["作り置き", " # "] },
      { names: ["あ".repeat(21)] },
      { names: Array.from({ length: MAX_RECIPE_TAGS + 1 }, (_, index) => `タグ${index}`) },
      { names: "作り置き" },
    ]) {
      const response = await putRecipeTags(testApp, body);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });
    }
  });
});
