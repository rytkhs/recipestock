import { describe, expect, it } from "vitest";
import { createApp } from "../index";
import { type RecipeRecord } from "../recipes";
import { unusedDeleteRecipe, unusedListRecipes, unusedUpdateRecipe } from "./test-helpers";

const baseRecipe = (overrides: Partial<RecipeRecord> = {}): RecipeRecord => ({
  id: "recipe_123",
  userId: "user_123",
  title: "Tomato pasta",
  content: {
    title: "Tomato pasta",
    ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
    steps: [{ text: "煮詰める" }],
  },
  sourceType: "web",
  sourcePlatform: null,
  sourceUrl: "https://example.com/recipes/tomato",
  normalizedSourceUrl: "https://example.com/recipes/tomato",
  sourceName: "Example Kitchen",
  searchText: "tomato pasta example kitchen トマト缶",
  createdAt: new Date("2026-05-26T00:00:00.000Z"),
  updatedAt: new Date("2026-05-26T00:00:00.000Z"),
  ...overrides,
});

describe("Recipe mutation routes", () => {
  it("ログイン済みユーザーがレシピ本文全体を更新できる", async () => {
    const updates: unknown[] = [];
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
        getRecipe: async (userId, recipeId) => baseRecipe({ id: recipeId, userId }),
        listRecipes: unusedListRecipes,
        updateRecipe: async (recipe) => {
          updates.push(recipe);
          return baseRecipe({
            id: recipe.recipeId,
            userId: recipe.userId,
            title: recipe.title,
            content: recipe.content,
            searchText: recipe.searchText,
            updatedAt: new Date("2026-05-27T00:00:00.000Z"),
          });
        },
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Potato salad",
            servingsText: "3人分",
            ingredientGroups: [{ ingredients: [{ name: "じゃがいも", amount: "2個" }] }],
            steps: [{ text: "つぶす" }],
            note: "冷やす。",
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(200);
    expect(updates).toEqual([
      expect.objectContaining({
        userId: "user_123",
        recipeId: "recipe_123",
        title: "Potato salad",
        content: expect.objectContaining({
          title: "Potato salad",
          servingsText: "3人分",
        }),
        searchText: expect.stringContaining("potato salad"),
      }),
    ]);
    expect(updates[0]).toEqual(
      expect.objectContaining({
        searchText: expect.stringContaining("example kitchen"),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      recipe: {
        id: "recipe_123",
        title: "Potato salad",
        content: {
          title: "Potato salad",
          servingsText: "3人分",
        },
        source: {
          sourceName: "Example Kitchen",
          sourceUrl: "https://example.com/recipes/tomato",
        },
      },
    });
  });

  it("レシピ更新で対象が存在しない場合はnot_foundを返す", async () => {
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
      "/api/recipes/missing_recipe",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: { title: "Potato salad" } }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(404);
  });

  it("レシピ更新で所有者が違う場合はnot_foundを返す", async () => {
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
        getRecipe: async (userId, recipeId) => {
          calls.push({ userId, recipeId });
          return null;
        },
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request(
      "/api/recipes/other_user_recipe",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: { title: "Potato salad" } }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(404);
    expect(calls).toEqual([{ userId: "user_123", recipeId: "other_user_recipe" }]);
  });

  it("レシピ更新リクエストが不正な場合はvalidation_failedを返す", async () => {
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
        getRecipe: async () => {
          throw new Error("should not get a recipe");
        },
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: { title: "" } }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "validation_failed",
      },
    });
  });

  it("ログイン済みユーザーが自分のレシピを物理削除できる", async () => {
    const deletes: unknown[] = [];
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
        deleteRecipe: async (userId, recipeId) => {
          deletes.push({ userId, recipeId });
          return true;
        },
      },
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "DELETE",
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(200);
    expect(deletes).toEqual([{ userId: "user_123", recipeId: "recipe_123" }]);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("レシピ削除で対象が存在しない場合はnot_foundを返す", async () => {
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
        deleteRecipe: async () => false,
      },
    });

    const response = await testApp.request(
      "/api/recipes/missing_recipe",
      {
        method: "DELETE",
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(404);
  });

  it("レシピ削除で所有者が違う場合はnot_foundを返す", async () => {
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
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: async (userId, recipeId) => {
          calls.push({ userId, recipeId });
          return false;
        },
      },
    });

    const response = await testApp.request(
      "/api/recipes/other_user_recipe",
      {
        method: "DELETE",
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(404);
    expect(calls).toEqual([{ userId: "user_123", recipeId: "other_user_recipe" }]);
  });
});
