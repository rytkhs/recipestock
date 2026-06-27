import { describe, expect, it } from "vitest";
import { createApp } from "../index";
import { unusedDeleteRecipe, unusedListRecipes, unusedUpdateRecipe } from "./test-helpers";

describe("Recipe detail routes", () => {
  it("レシピ詳細取得で未ログイン時にunauthorizedを返す", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => null,
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("should not create a recipe");
        },
        getRecipe: async () => {
          throw new Error("should not get a recipe without a session");
        },
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request("/api/recipes/recipe_123", undefined, {
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

  it("保存済みレシピを詳細画面用に取得できる", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
            sourceMedia: [],
            ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
            steps: [{ text: "煮詰める", images: [] }],
            note: "仕上げにオリーブオイル。",
          },
          originType: "manual",
          sourceUrl: "https://example.com/recipes/tomato",
          normalizedSourceUrl: "https://example.com/recipes/tomato",
          sourceName: "Example Kitchen",
          searchText: "tomato pasta",
          createdAt: new Date("2026-05-26T00:00:00.000Z"),
          updatedAt: new Date("2026-05-26T00:00:00.000Z"),
        }),
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
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
          sourceName: "Example Kitchen",
        },
        locked: false,
      },
    });
  });

  it("保存済みレシピの画像に表示用URLを付与する", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
            coverImage: {
              objectKey: "recipes/user_123/recipe_123/cover.webp",
              width: 1200,
              height: 800,
            },
            sourceMedia: [
              {
                objectKey: "recipes/user_123/recipe_123/source.webp",
                width: 1080,
                height: 1080,
              },
            ],
            ingredientGroups: [],
            steps: [
              {
                text: "煮詰める",
                images: [
                  {
                    objectKey: "recipes/user_123/recipe_123/step.webp",
                    width: 800,
                    height: 1200,
                  },
                ],
              },
            ],
          },
          originType: "manual",
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
          searchText: "tomato pasta",
          createdAt: new Date("2026-05-26T00:00:00.000Z"),
          updatedAt: new Date("2026-05-26T00:00:00.000Z"),
        }),
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async ({ objectKey }) => ({
          url: `https://images.example/${objectKey}`,
          expiresAt: new Date("2026-05-31T00:15:00.000Z"),
        }),
        copyObject: async () => {
          throw new Error("should not copy an object");
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
    });

    const response = await testApp.request("/api/recipes/recipe_123", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recipe: {
        content: {
          coverImage: {
            objectKey: "recipes/user_123/recipe_123/cover.webp",
            width: 1200,
            height: 800,
            url: "https://images.example/recipes/user_123/recipe_123/cover.webp",
          },
          sourceMedia: [
            {
              objectKey: "recipes/user_123/recipe_123/source.webp",
              width: 1080,
              height: 1080,
              url: "https://images.example/recipes/user_123/recipe_123/source.webp",
            },
          ],
          steps: [
            {
              text: "煮詰める",
              images: [
                {
                  objectKey: "recipes/user_123/recipe_123/step.webp",
                  width: 800,
                  height: 1200,
                  url: "https://images.example/recipes/user_123/recipe_123/step.webp",
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("一部の手順画像URL作成に失敗しても画像情報と対応関係を保持する", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
            sourceMedia: [],
            ingredientGroups: [],
            steps: [
              {
                text: "煮詰める",
                images: [
                  {
                    objectKey: "recipes/user_123/recipe_123/step-a.webp",
                    width: 1200,
                    height: 800,
                  },
                  {
                    objectKey: "recipes/user_123/recipe_123/step-b.webp",
                    width: 800,
                    height: 1200,
                  },
                ],
              },
            ],
          },
          originType: "manual",
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
          searchText: "tomato pasta",
          createdAt: new Date("2026-05-26T00:00:00.000Z"),
          updatedAt: new Date("2026-05-26T00:00:00.000Z"),
        }),
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async ({ objectKey }) => {
          if (objectKey.endsWith("step-a.webp")) {
            throw new Error("signed URL failed");
          }

          return {
            url: `https://images.example/${objectKey}`,
            expiresAt: new Date("2026-05-31T00:15:00.000Z"),
          };
        },
        copyObject: async () => {
          throw new Error("should not copy an object");
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
    });

    const response = await testApp.request("/api/recipes/recipe_123", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recipe: {
        content: {
          steps: [
            {
              images: [
                {
                  objectKey: "recipes/user_123/recipe_123/step-a.webp",
                  width: 1200,
                  height: 800,
                },
                {
                  objectKey: "recipes/user_123/recipe_123/step-b.webp",
                  width: 800,
                  height: 1200,
                  url: "https://images.example/recipes/user_123/recipe_123/step-b.webp",
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("ロック中Recipe詳細は本文を返さない", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
          title: "Locked pasta",
          content: {
            title: "Locked pasta",
            sourceMedia: [],
            ingredientGroups: [{ ingredients: [{ name: "秘密の材料", amount: "1つ" }] }],
            steps: [{ text: "煮る", images: [] }],
          },
          originType: "manual",
          sourceUrl: "https://example.com/locked",
          normalizedSourceUrl: "https://example.com/locked",
          sourceName: "Example Kitchen",
          searchText: "locked pasta",
          createdAt: new Date("2026-05-20T00:00:00.000Z"),
          updatedAt: new Date("2026-05-20T00:00:00.000Z"),
          locked: true,
        }),
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL for locked recipe");
        },
        copyObject: async () => {
          throw new Error("should not copy an object");
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
    });

    const response = await testApp.request("/api/recipes/recipe_locked", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recipe: {
        id: "recipe_locked",
        locked: true,
      },
    });
  });

  it("保存済みレシピが存在しない場合はnot_foundを返す", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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

    const response = await testApp.request("/api/recipes/missing_recipe", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Recipe was not found.",
      },
    });
  });
});
