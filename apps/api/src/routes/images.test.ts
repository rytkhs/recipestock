import { describe, expect, it } from "vitest";
import { createApp } from "../index";
import { unusedDeleteRecipe, unusedListRecipes, unusedUpdateRecipe } from "./test-helpers";

const auth = {
  getSession: async () => ({
    user: { id: "user_123", email: "user@example.com" },
  }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

describe("Image routes", () => {
  it("ログイン済みユーザーが画像アップロード用URLを取得できる", async () => {
    const testApp = createApp({
      auth,
      imageService: {
        createUploadUrl: async ({ objectKey }) => ({
          url: `https://upload.example/${objectKey}`,
          expiresAt: new Date("2026-05-31T00:15:00.000Z"),
        }),
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        copyObject: async () => {
          throw new Error("should not copy an object");
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
      createImageId: () => "image_123",
    });

    const response = await testApp.request(
      "/api/images/upload-url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType: "image/webp",
          sizeBytes: 1024,
        }),
      },
      { APP_ENV: "development" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      uploadUrl: "https://upload.example/tmp/user_123/image_123.webp",
      objectKey: "tmp/user_123/image_123.webp",
      expiresAt: "2026-05-31T00:15:00.000Z",
    });
  });

  it("画像アップロード用URLの発行に失敗したらunknownエラーを返す", async () => {
    const testApp = createApp({
      auth,
      imageService: {
        createUploadUrl: async () => {
          throw new Error("signing failed");
        },
        createSignedGetUrl: async () => {
          throw new Error("should not create a signed GET URL");
        },
        copyObject: async () => {
          throw new Error("should not copy an object");
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
      createImageId: () => "image_123",
    });

    const response = await testApp.request(
      "/api/images/upload-url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType: "image/webp",
          sizeBytes: 1024,
        }),
      },
      { APP_ENV: "development" },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown" },
    });
  });

  it("画像アップロード用URLは認証を必須にする", async () => {
    const testApp = createApp({
      auth: {
        getSession: async () => null,
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
    });

    const response = await testApp.request(
      "/api/images/upload-url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType: "image/webp",
          sizeBytes: 1024,
        }),
      },
      { APP_ENV: "development" },
    );

    expect(response.status).toBe(401);
  });

  it("画像アップロード用URLは画像種別とサイズを検証する", async () => {
    const testApp = createApp({ auth });

    const invalidTypeResponse = await testApp.request(
      "/api/images/upload-url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType: "image/gif",
          sizeBytes: 1024,
        }),
      },
      { APP_ENV: "development" },
    );

    expect(invalidTypeResponse.status).toBe(400);
    await expect(invalidTypeResponse.json()).resolves.toMatchObject({
      error: { code: "invalid_image_type" },
    });

    const tooLargeResponse = await testApp.request(
      "/api/images/upload-url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType: "image/webp",
          sizeBytes: 5 * 1024 * 1024 + 1,
        }),
      },
      { APP_ENV: "development" },
    );

    expect(tooLargeResponse.status).toBe(400);
    await expect(tooLargeResponse.json()).resolves.toMatchObject({
      error: { code: "image_too_large" },
    });
  });

  it("レシピ本文に含まれる画像だけ表示用URLを取得できる", async () => {
    const testApp = createApp({
      auth,
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
            coverImageKey: "recipes/user_123/recipe_123/cover.webp",
            ingredientGroups: [],
            steps: [{ text: "煮詰める", imageKeys: ["recipes/user_123/recipe_123/step.webp"] }],
          },
          originType: "manual",
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
          searchText: "tomato pasta",
          createdAt: new Date("2026-05-31T00:00:00.000Z"),
          updatedAt: new Date("2026-05-31T00:00:00.000Z"),
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

    const response = await testApp.request(
      "/api/images/signed-url?key=recipes/user_123/recipe_123/step.webp",
      undefined,
      { APP_ENV: "development" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://images.example/recipes/user_123/recipe_123/step.webp",
      expiresAt: "2026-05-31T00:15:00.000Z",
    });
  });

  it("レシピ本文に含まれない画像は表示用URLを取得できない", async () => {
    const testApp = createApp({
      auth,
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
            ingredientGroups: [],
            steps: [],
          },
          originType: "manual",
          sourceUrl: null,
          normalizedSourceUrl: null,
          sourceName: null,
          searchText: "tomato pasta",
          createdAt: new Date("2026-05-31T00:00:00.000Z"),
          updatedAt: new Date("2026-05-31T00:00:00.000Z"),
        }),
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
        deleteRecipe: unusedDeleteRecipe,
      },
    });

    const response = await testApp.request(
      "/api/images/signed-url?key=recipes/user_123/recipe_123/missing.webp",
      undefined,
      { APP_ENV: "development" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });
});
