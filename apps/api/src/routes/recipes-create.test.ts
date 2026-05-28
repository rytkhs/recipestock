import { describe, expect, it } from "vitest";
import { createApp } from "../index";
import { unusedDeleteRecipe, unusedListRecipes, unusedUpdateRecipe } from "./test-helpers";

describe("Recipe create routes", () => {
  it("ログイン済みユーザーがタイトルだけでレシピを保存できる", async () => {
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      meRepository: {
        getOrCreateAppUser: async (userId) => ({ userId, plan: "free" }),
        countRecipes: async () => 0,
        getAiUsage: async () => null,
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async (recipe) => {
          savedRecipes.push(recipe);
          return {
            status: "created",
            recipe: {
              ...recipe,
              createdAt: new Date("2026-05-26T00:00:00.000Z"),
              updatedAt: new Date("2026-05-26T00:00:00.000Z"),
            },
          };
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
      createRecipeId: () => "recipe_123",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { title: "Tomato pasta" },
          source: { sourceType: "manual" },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          ingredientGroups: [],
          steps: [],
        },
        source: {
          sourceType: "manual",
          sourcePlatform: null,
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
        },
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
        locked: false,
      },
    });
    expect(savedRecipes).toEqual([
      expect.objectContaining({
        id: "recipe_123",
        userId: "user_123",
        title: "Tomato pasta",
        searchText: "tomato pasta",
      }),
    ]);
  });

  it("レシピ保存リクエストが不正な場合はvalidation_failedとdetailsを返す", async () => {
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
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { title: "" },
          source: { sourceType: "manual" },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        message: "Request validation failed.",
        details: {
          fieldErrors: {},
          formErrors: [],
        },
      },
    });
  });

  it("任意項目と出典情報をRecipeContentとSource metadataとして保存する", async () => {
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      meRepository: {
        getOrCreateAppUser: async (userId) => ({ userId, plan: "free" }),
        countRecipes: async () => 0,
        getAiUsage: async () => null,
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async (recipe) => {
          savedRecipes.push(recipe);
          return {
            status: "created",
            recipe: {
              ...recipe,
              createdAt: new Date("2026-05-26T00:00:00.000Z"),
              updatedAt: new Date("2026-05-26T00:00:00.000Z"),
            },
          };
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
      createRecipeId: () => "recipe_123",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            servingsText: "2人分",
            ingredientGroups: [
              { label: "ソース", ingredients: [{ name: "トマト缶", amount: "1缶" }] },
            ],
            steps: [{ text: "煮詰める" }],
            note: "仕上げにオリーブオイル。",
          },
          source: {
            sourceType: "web",
            sourceName: "Example Kitchen",
            sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(201);
    expect(savedRecipes).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({
          servingsText: "2人分",
          note: "仕上げにオリーブオイル。",
        }),
        sourceType: "web",
        sourceName: "Example Kitchen",
        sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
        normalizedSourceUrl: "https://example.com/recipes/tomato",
        searchText: expect.stringContaining("example kitchen"),
      }),
    ]);
    expect(savedRecipes[0]).toEqual(
      expect.objectContaining({
        searchText: expect.stringContaining("トマト缶"),
      }),
    );
    expect(savedRecipes[0]).toEqual(
      expect.objectContaining({
        searchText: expect.not.stringContaining("1缶"),
      }),
    );
  });

  it("正規化済み出典URLが送られてもsourceUrlから再計算して保存する", async () => {
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async (recipe) => {
          savedRecipes.push(recipe);
          return {
            status: "created",
            recipe: {
              ...recipe,
              createdAt: new Date("2026-05-26T00:00:00.000Z"),
              updatedAt: new Date("2026-05-26T00:00:00.000Z"),
            },
          };
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
      createRecipeId: () => "recipe_123",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { title: "Tomato pasta" },
          source: {
            sourceType: "web",
            sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
            normalizedSourceUrl: "https://attacker.example/wrong",
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(201);
    expect(savedRecipes).toEqual([
      expect.objectContaining({
        sourceUrl: "https://example.com/recipes/tomato?utm_source=newsletter#steps",
        normalizedSourceUrl: "https://example.com/recipes/tomato",
      }),
    ]);
    await expect(response.json()).resolves.toMatchObject({
      recipe: {
        source: {
          normalizedSourceUrl: "https://example.com/recipes/tomato",
        },
      },
    });
  });

  it("Freeユーザーが保存上限到達済みならレシピを保存しない", async () => {
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => ({ status: "limitExceeded" }),
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
      createRecipeId: () => "recipe_123",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { title: "Tomato pasta" },
          source: { sourceType: "manual" },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "recipe_limit_exceeded",
        message: "Recipe limit exceeded.",
      },
    });
    expect(savedRecipes).toEqual([]);
  });

  it("上限付き保存処理が成功した場合は保存済みレシピを返す", async () => {
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async (recipe) => {
          savedRecipes.push(recipe);
          return {
            status: "created",
            recipe: {
              ...recipe,
              createdAt: new Date("2026-05-26T00:00:00.000Z"),
              updatedAt: new Date("2026-05-26T00:00:00.000Z"),
            },
          };
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
      createRecipeId: () => "recipe_123",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { title: "Tomato pasta" },
          source: { sourceType: "manual" },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(201);
    expect(savedRecipes).toHaveLength(1);
  });
});
