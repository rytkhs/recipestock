import { describe, expect, it } from "vitest";
import { InvalidRecipeListCursorError } from "../recipes";
import { createSilentTestApp, createTestAuth } from "../test-helpers";
import { unusedDeleteRecipe, unusedListRecipes, unusedUpdateRecipe } from "./test-helpers";

describe("Recipe list routes", () => {
  it("レシピ一覧取得で未ログイン時にunauthorizedを返す", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(null),
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request("/api/recipes", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    });
  });

  it("ログイン済みユーザーがレシピ一覧を検索条件付きで取得できる", async () => {
    const calls: unknown[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: async (params) => {
          calls.push(params);
          return {
            items: [
              {
                id: "recipe_123",
                title: "Tomato pasta",
                sourceName: "Example Kitchen",
                createdAt: new Date("2026-05-25T00:00:00.000Z"),
              },
            ],
            nextCursor: "next_cursor",
          };
        },
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request("/api/recipes?q=Tomato%20Kitchen&limit=10", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        userId: "user_123",
        searchTerms: ["tomato", "kitchen"],
        sort: "newest",
        limit: 10,
        cursor: null,
        tagIds: [],
        untagged: false,
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "recipe_123",
          title: "Tomato pasta",
          coverImageUrl: null,
          sourceName: "Example Kitchen",
          createdAt: "2026-05-25T00:00:00.000Z",
          locked: false,
        },
      ],
      nextCursor: "next_cursor",
    });
  });

  it("並び順を指定してレシピ一覧を取得できる", async () => {
    const calls: unknown[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: async (params) => {
          calls.push(params);
          return { items: [], nextCursor: null };
        },
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request("/api/recipes?sort=oldest", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        userId: "user_123",
        searchTerms: [],
        sort: "oldest",
        limit: 20,
        cursor: null,
        tagIds: [],
        untagged: false,
      },
    ]);
  });

  it("並び順が不正な場合はvalidation_failedを返す", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request("/api/recipes?sort=updated", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("Freeユーザーは新しく保存した5件以外のレシピがlockedとして一覧に表示される", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: async () => ({
          items: [
            {
              id: "recipe_5",
              title: "Unlocked recipe",
              sourceName: null,
              coverImageObjectKey: "recipes/user_123/recipe_5/cover.webp",
              createdAt: new Date("2026-05-25T00:00:00.000Z"),
              locked: false,
            },
            {
              id: "recipe_6",
              title: "Locked recipe",
              sourceName: "Example Kitchen",
              coverImageObjectKey: "recipes/user_123/recipe_6/cover.webp",
              createdAt: new Date("2026-05-24T00:00:00.000Z"),
              locked: true,
            },
          ],
          nextCursor: null,
        }),
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request("/api/recipes", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "recipe_5",
          title: "Unlocked recipe",
          coverImageUrl: "/api/images/thumbnail/v1/recipes/user_123/recipe_5/cover.webp",
          sourceName: null,
          createdAt: "2026-05-25T00:00:00.000Z",
          locked: false,
        },
        {
          id: "recipe_6",
          title: "Locked recipe",
          coverImageUrl: null,
          sourceName: "Example Kitchen",
          createdAt: "2026-05-24T00:00:00.000Z",
          locked: true,
        },
      ],
      nextCursor: null,
    });
  });

  it("一覧cursorが不正な場合はinvalid_recipe_list_cursorを返す", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: async () => {
          throw new InvalidRecipeListCursorError();
        },
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request("/api/recipes?cursor=not-base64", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_recipe_list_cursor",
        message: "Recipe list cursor is invalid.",
      },
    });
  });

  it("タグの指定を繰り返したクエリで受け取り、タグなしの指定も渡す", async () => {
    const calls: unknown[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: async (params) => {
          calls.push(params);
          return { items: [], nextCursor: null };
        },
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const tagResponse = await testApp.request(
      "/api/recipes?tagId=tag_1&tagId=tag_2&tagId=tag_1",
      undefined,
      { APP_ENV: "development" },
    );
    const untaggedResponse = await testApp.request("/api/recipes?untagged=true", undefined, {
      APP_ENV: "development",
    });

    expect(tagResponse.status).toBe(200);
    expect(untaggedResponse.status).toBe(200);
    expect(calls).toEqual([
      expect.objectContaining({ tagIds: ["tag_1", "tag_2"], untagged: false }),
      expect.objectContaining({ tagIds: [], untagged: true }),
    ]);
  });

  it("タグとタグなしを同時に指定したり、タグを多く指定しすぎたりするとvalidation_failedを返す", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });
    const tooManyTags = Array.from({ length: 11 }, (_, index) => `tagId=tag_${index}`).join("&");

    for (const query of ["tagId=tag_1&untagged=true", tooManyTags]) {
      const response = await testApp.request(`/api/recipes?${query}`, undefined, {
        APP_ENV: "development",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });
    }
  });
});
