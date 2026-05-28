import { describe, expect, it } from "vitest";
import { createApp } from "../index";
import { InvalidRecipeListCursorError } from "../recipes";
import { unusedListRecipes } from "./test-helpers";

describe("Recipe list routes", () => {
  it("レシピ一覧取得で未ログイン時にunauthorizedを返す", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => null,
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
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
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
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
                updatedAt: new Date("2026-05-26T00:00:00.000Z"),
              },
            ],
            nextCursor: "next_cursor",
          };
        },
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
        limit: 10,
        cursor: null,
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
          updatedAt: "2026-05-26T00:00:00.000Z",
          locked: false,
        },
      ],
      nextCursor: "next_cursor",
    });
  });

  it("一覧cursorが不正な場合はinvalid_recipe_list_cursorを返す", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => null,
        listRecipes: async () => {
          throw new InvalidRecipeListCursorError();
        },
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
});
