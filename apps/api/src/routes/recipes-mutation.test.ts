import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { type RecipeRecord } from "../recipes";
import { createSilentTestApp } from "../test-helpers";
import { unusedDeleteRecipe, unusedListRecipes, unusedUpdateRecipe } from "./test-helpers";

const recipeImage = (objectKey: string, width = 1200, height = 800) => ({
  objectKey,
  width,
  height,
});

const baseRecipe = (overrides: Partial<RecipeRecord> = {}): RecipeRecord => ({
  id: "recipe_123",
  userId: "user_123",
  title: "Tomato pasta",
  content: {
    title: "Tomato pasta",
    referenceImages: [],
    ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
    steps: [{ text: "煮詰める", images: [] }],
  },
  originType: "manual",
  sourceUrl: "https://example.com/recipes/tomato",
  normalizedSourceUrl: "https://example.com/recipes/tomato",
  sourceName: "Example Kitchen",
  searchText: "tomato pasta example kitchen トマト缶",
  createdAt: new Date("2026-05-26T00:00:00.000Z"),
  updatedAt: new Date("2026-05-26T00:00:00.000Z"),
  ...overrides,
});

const sameOriginHeaders = {
  origin: "https://app.example.com",
  "sec-fetch-site": "same-origin",
};

describe("Recipe mutation routes", () => {
  it("ログイン済みユーザーがレシピ本文全体を更新できる", async () => {
    const updates: unknown[] = [];
    const testApp = createSilentTestApp({
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
            yieldText: "3人分",
            ingredientGroups: [{ ingredients: [{ name: "じゃがいも", amount: "2個" }] }],
            steps: [{ text: "つぶす", images: [] }],
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
          yieldText: "3人分",
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
          yieldText: "3人分",
        },
        source: {
          sourceName: "Example Kitchen",
          sourceUrl: "https://example.com/recipes/tomato",
        },
      },
    });
  });

  it("レシピ更新で対象が存在しない場合はnot_foundを返す", async () => {
    const testApp = createSilentTestApp({
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
    const testApp = createSilentTestApp({
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
    const testApp = createSilentTestApp({
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

  it("ロック中Recipeは更新できず画像確定もDB更新も実行しない", async () => {
    const updates: unknown[] = [];
    const testApp = createSilentTestApp({
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
        getRecipe: async (userId, recipeId) =>
          baseRecipe({
            id: recipeId,
            userId,
            locked: true,
          }),
        listRecipes: unusedListRecipes,
        updateRecipe: async (recipe) => {
          updates.push(recipe);
          return baseRecipe();
        },
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        getObjectSize: async () => {
          throw new Error("should not inspect an object");
        },
        copyObject: async () => {
          throw new Error("should not copy an object");
        },
        deleteObject: async () => {
          throw new Error("should not delete an object");
        },
        deletePrefixBestEffort: async () => undefined,
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
            steps: [
              {
                text: "盛り付ける",
                images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
              },
            ],
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(403);
    expect(updates).toEqual([]);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "locked_recipe",
        message: "Recipe is locked.",
      },
    });
  });

  it("レシピ更新で既存画像を保持し、新しいtmp画像を確定し、不要画像を削除対象にする", async () => {
    const copies: unknown[] = [];
    const deletes: unknown[] = [];
    const updates: unknown[] = [];
    const existing = baseRecipe({
      content: {
        title: "Tomato pasta",
        coverImage: recipeImage("recipes/user_123/recipe_123/old-cover.webp"),
        referenceImages: [recipeImage("recipes/user_123/recipe_123/old-source.webp")],
        ingredientGroups: [],
        steps: [
          {
            text: "煮詰める",
            images: [recipeImage("recipes/user_123/recipe_123/old-step.webp", 800, 1200)],
          },
        ],
      },
    });
    const testApp = createSilentTestApp({
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
        getRecipe: async () => existing,
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
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        getObjectSize: async () => 1024,
        copyObject: async (sourceKey, destinationKey) => {
          copies.push({ sourceKey, destinationKey });
          return { width: 900, height: 1200 };
        },
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
          throw new Error("delete failed");
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createImageId: () => "new-step",
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: {
              type: "existingObjectKey",
              key: "recipes/user_123/recipe_123/old-cover.webp",
            },
            steps: [
              {
                text: "盛り付ける",
                images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
              },
            ],
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(200);
    expect(copies).toEqual([
      {
        sourceKey: "tmp/user_123/step.webp",
        destinationKey: "recipes/user_123/recipe_123/new-step.webp",
      },
    ]);
    expect(deletes).toEqual([
      "tmp/user_123/step.webp",
      "recipes/user_123/recipe_123/old-source.webp",
      "recipes/user_123/recipe_123/old-step.webp",
    ]);
    expect(updates).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({
          coverImage: recipeImage("recipes/user_123/recipe_123/old-cover.webp"),
          steps: [
            {
              text: "盛り付ける",
              images: [recipeImage("recipes/user_123/recipe_123/new-step.webp", 900, 1200)],
            },
          ],
        }),
      }),
    ]);
  });

  it("レシピ更新で外部画像URLを確定し、不要な既存画像を削除対象にする", async () => {
    const externalCopies: unknown[] = [];
    const deletes: unknown[] = [];
    const updates: unknown[] = [];
    const existing = baseRecipe({
      content: {
        title: "Tomato pasta",
        coverImage: recipeImage("recipes/user_123/recipe_123/old-cover.webp"),
        referenceImages: [],
        ingredientGroups: [],
        steps: [
          {
            text: "煮詰める",
            images: [recipeImage("recipes/user_123/recipe_123/old-step.webp", 800, 1200)],
          },
        ],
      },
    });
    const testApp = createSilentTestApp({
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
        getRecipe: async () => existing,
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
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        copyObject: async () => {
          throw new Error("should not copy a tmp object");
        },
        copyExternalImageUrl: async (params) => {
          externalCopies.push(params);
          return { objectKey: `${params.destinationKeyPrefix}.png`, width: 900, height: 1200 };
        },
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createImageId: () => "new-step",
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: {
              type: "existingObjectKey",
              key: "recipes/user_123/recipe_123/old-cover.webp",
            },
            steps: [
              {
                text: "盛り付ける",
                images: [
                  {
                    type: "externalImageUrl",
                    url: "https://cdn.example.com/step.png",
                  },
                ],
              },
            ],
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(200);
    expect(externalCopies).toEqual([
      {
        sourceUrl: "https://cdn.example.com/step.png",
        destinationKeyPrefix: "recipes/user_123/recipe_123/new-step",
      },
    ]);
    expect(deletes).toEqual(["recipes/user_123/recipe_123/old-step.webp"]);
    expect(updates).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({
          coverImage: recipeImage("recipes/user_123/recipe_123/old-cover.webp"),
          steps: [
            {
              text: "盛り付ける",
              images: [recipeImage("recipes/user_123/recipe_123/new-step.png", 900, 1200)],
            },
          ],
        }),
      }),
    ]);
  });

  it("レシピ更新が例外で失敗したらcopy済み確定画像を削除対象にする", async () => {
    const deletes: unknown[] = [];
    const existing = baseRecipe();
    const testApp = createSilentTestApp({
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
        getRecipe: async () => existing,
        listRecipes: unusedListRecipes,
        updateRecipe: async () => {
          throw new Error("database failed");
        },
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        getObjectSize: async () => 1024,
        copyObject: async () => ({ width: 1200, height: 800 }),
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createImageId: () => "new-step",
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            steps: [
              {
                text: "盛り付ける",
                images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
              },
            ],
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(500);
    expect(deletes).toEqual(["recipes/user_123/recipe_123/new-step.webp"]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown" },
    });
  });

  it("tmp画像の確定に失敗したらレシピを更新しない", async () => {
    const updates: unknown[] = [];
    const existing = baseRecipe();
    const testApp = createSilentTestApp({
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
        getRecipe: async () => existing,
        listRecipes: unusedListRecipes,
        updateRecipe: async (recipe) => {
          updates.push(recipe);
          return existing;
        },
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        getObjectSize: async () => 1024,
        copyObject: async () => {
          throw new Error("copy failed");
        },
        deleteObject: async () => {
          throw new Error("should not delete an object");
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createImageId: () => "new-step",
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            steps: [
              {
                text: "盛り付ける",
                images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
              },
            ],
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(422);
    expect(updates).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "image_finalize_failed" },
    });
  });

  it("複数tmp画像の確定途中で失敗したらcopy済み確定画像を削除対象にする", async () => {
    const updates: unknown[] = [];
    const copies: unknown[] = [];
    const deletes: unknown[] = [];
    const existing = baseRecipe();
    const imageIds = ["cover", "step"];
    const testApp = createSilentTestApp({
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
        getRecipe: async () => existing,
        listRecipes: unusedListRecipes,
        updateRecipe: async (recipe) => {
          updates.push(recipe);
          return existing;
        },
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        getObjectSize: async (objectKey) =>
          objectKey === "tmp/user_123/step.webp" ? MAX_IMAGE_UPLOAD_SIZE_BYTES + 1 : 1024,
        copyObject: async (sourceKey, destinationKey) => {
          copies.push({ sourceKey, destinationKey });
          return { width: 1200, height: 800 };
        },
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createImageId: () => imageIds.shift() ?? "extra",
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: { type: "tmpObjectKey", key: "tmp/user_123/cover.webp" },
            steps: [
              {
                text: "盛り付ける",
                images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
              },
            ],
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(422);
    expect(copies).toEqual([
      {
        sourceKey: "tmp/user_123/cover.webp",
        destinationKey: "recipes/user_123/recipe_123/cover.webp",
      },
    ]);
    expect(deletes).toEqual(["recipes/user_123/recipe_123/cover.webp"]);
    expect(updates).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "image_finalize_failed" },
    });
  });

  it("tmp画像の実サイズが上限を超える場合はレシピを更新しない", async () => {
    const updates: unknown[] = [];
    const copies: unknown[] = [];
    const existing = baseRecipe();
    const testApp = createSilentTestApp({
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
        getRecipe: async () => existing,
        listRecipes: unusedListRecipes,
        updateRecipe: async (recipe) => {
          updates.push(recipe);
          return existing;
        },
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        getObjectSize: async () => MAX_IMAGE_UPLOAD_SIZE_BYTES + 1,
        copyObject: async (sourceKey, destinationKey) => {
          copies.push({ sourceKey, destinationKey });
          return { width: 1200, height: 800 };
        },
        deleteObject: async () => {
          throw new Error("should not delete an object");
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createImageId: () => "new-step",
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            steps: [
              {
                text: "盛り付ける",
                images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
              },
            ],
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(422);
    expect(copies).toEqual([]);
    expect(updates).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "image_finalize_failed" },
    });
  });

  it("更新対象に含まれない既存画像keyは保持しない", async () => {
    const updates: unknown[] = [];
    const existing = baseRecipe();
    const testApp = createSilentTestApp({
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
        getRecipe: async () => existing,
        listRecipes: unusedListRecipes,
        updateRecipe: async (recipe) => {
          updates.push(recipe);
          return existing;
        },
        deleteRecipe: unusedDeleteRecipe,
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        copyObject: async () => {
          throw new Error("should not copy an object");
        },
        deleteObject: async () => {
          throw new Error("should not delete an object");
        },
        deletePrefixBestEffort: async () => undefined,
      },
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: {
              type: "existingObjectKey",
              key: "recipes/user_123/recipe_other/cover.webp",
            },
          },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(422);
    expect(updates).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "image_finalize_failed" },
    });
  });

  it("ログイン済みユーザーが自分のレシピを物理削除できる", async () => {
    const deletes: unknown[] = [];
    const deletedPrefixes: string[] = [];
    const testApp = createSilentTestApp({
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
        deleteRecipe: async (userId, recipeId) => {
          deletes.push({ userId, recipeId });
          return true;
        },
      },
      imageService: {
        createUploadUrl: async () => {
          throw new Error("should not create an upload URL");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        copyObject: async () => {
          throw new Error("should not copy an object");
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async (prefix) => {
          deletedPrefixes.push(prefix);
          throw new Error("prefix delete failed");
        },
      },
    });

    const response = await testApp.request(
      "/api/recipes/recipe_123",
      {
        method: "DELETE",
        headers: sameOriginHeaders,
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(200);
    expect(deletes).toEqual([{ userId: "user_123", recipeId: "recipe_123" }]);
    expect(deletedPrefixes).toEqual(["recipes/user_123/recipe_123/"]);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("レシピ削除で対象が存在しない場合はnot_foundを返す", async () => {
    const testApp = createSilentTestApp({
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
        deleteRecipe: async () => false,
      },
    });

    const response = await testApp.request(
      "/api/recipes/missing_recipe",
      {
        method: "DELETE",
        headers: sameOriginHeaders,
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(404);
  });

  it("レシピ削除で所有者が違う場合はnot_foundを返す", async () => {
    const calls: unknown[] = [];
    const testApp = createSilentTestApp({
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
        headers: sameOriginHeaders,
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(404);
    expect(calls).toEqual([{ userId: "user_123", recipeId: "other_user_recipe" }]);
  });
});
