import { describe, expect, it } from "vitest";
import app, { createApp } from "./index";

describe("API", () => {
  it("ヘルスチェックに応答する", async () => {
    const response = await app.request("/api/health", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      environment: "development",
    });
  });

  it("現在ユーザー取得で未ログイン時に統一形式のunauthorizedを返す", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => null,
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      meRepository: {
        getOrCreateAppUser: async () => {
          throw new Error("should not create app users without a session");
        },
        countRecipes: async () => 0,
        getAiUsage: async () => null,
      },
    });

    const response = await testApp.request("/api/me", undefined, {
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

  it("現在ユーザーの基礎情報を返しアプリユーザーを作成または再利用する", async () => {
    const calls: string[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      meRepository: {
        getOrCreateAppUser: async (userId) => {
          calls.push(`ensure:${userId}`);
          return { userId, plan: "free" };
        },
        countRecipes: async (userId) => {
          calls.push(`recipes:${userId}`);
          return 5;
        },
        getAiUsage: async (userId, month) => {
          calls.push(`ai:${userId}:${month}`);
          return { month, count: 3 };
        },
      },
      getCurrentMonth: () => "2026-05",
    });

    const response = await testApp.request("/api/me", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: "user_123",
      plan: "free",
      recipeCount: 5,
      recipeLimit: 5,
      isRecipeLimitReached: true,
      aiUsage: {
        month: "2026-05",
        count: 3,
        limit: 10,
        remaining: 7,
      },
    });
    expect(calls).toEqual(["ensure:user_123", "recipes:user_123", "ai:user_123:2026-05"]);
  });

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
        searchText: expect.stringContaining("トマト缶 1缶"),
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

  it("保存済みレシピを詳細画面用に取得できる", async () => {
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
        getRecipe: async (userId, recipeId) => ({
          id: recipeId,
          userId,
          title: "Tomato pasta",
          content: {
            title: "Tomato pasta",
            servingsText: "2人分",
            ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
            steps: [{ text: "煮詰める" }],
            note: "仕上げにオリーブオイル。",
          },
          sourceType: "web",
          sourcePlatform: null,
          sourceUrl: "https://example.com/recipes/tomato",
          normalizedSourceUrl: "https://example.com/recipes/tomato",
          sourceName: "Example Kitchen",
          searchText: "tomato pasta",
          createdAt: new Date("2026-05-26T00:00:00.000Z"),
          updatedAt: new Date("2026-05-26T00:00:00.000Z"),
        }),
      },
    });

    const response = await testApp.request("/api/recipes/recipe_123", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recipe: {
        id: "recipe_123",
        title: "Tomato pasta",
        content: {
          title: "Tomato pasta",
          servingsText: "2人分",
        },
        source: {
          sourceType: "web",
          sourceName: "Example Kitchen",
        },
        locked: false,
      },
    });
  });
});
