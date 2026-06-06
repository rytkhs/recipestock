import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { createApp } from "../index";
import { unusedDeleteRecipe, unusedListRecipes, unusedUpdateRecipe } from "./test-helpers";

describe("Recipe create routes", () => {
  it("ログイン済みユーザーがタイトルだけでレシピを保存できる", async () => {
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
          source: {},
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
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: { title: "" },
          source: {},
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
          user: { id: "user_123", email: "user@example.com" },
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
          user: { id: "user_123", email: "user@example.com" },
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
          user: { id: "user_123", email: "user@example.com" },
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
          source: {},
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
          user: { id: "user_123", email: "user@example.com" },
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
          source: {},
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(201);
    expect(savedRecipes).toHaveLength(1);
  });

  it("tmp画像を確定objectKeyに変換して保存する", async () => {
    const copies: unknown[] = [];
    const deletes: unknown[] = [];
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
        },
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
          throw new Error("tmp delete failed");
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "image_456",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: { type: "tmpObjectKey", key: "tmp/user_123/upload.webp" },
          },
          source: {},
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(201);
    expect(copies).toEqual([
      {
        sourceKey: "tmp/user_123/upload.webp",
        destinationKey: "recipes/user_123/recipe_123/image_456.webp",
      },
    ]);
    expect(deletes).toEqual(["tmp/user_123/upload.webp"]);
    expect(savedRecipes).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({
          coverImageKey: "recipes/user_123/recipe_123/image_456.webp",
        }),
      }),
    ]);
    await expect(response.json()).resolves.toMatchObject({
      recipe: {
        content: {
          coverImageKey: "recipes/user_123/recipe_123/image_456.webp",
        },
      },
    });
  });

  it("画像だけの手順を確定objectKeyに変換して保存する", async () => {
    const copies: unknown[] = [];
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "step_image",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            steps: [
              {
                images: [{ type: "tmpObjectKey", key: "tmp/user_123/step.webp" }],
              },
            ],
          },
          source: {},
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(201);
    expect(copies).toEqual([
      {
        sourceKey: "tmp/user_123/step.webp",
        destinationKey: "recipes/user_123/recipe_123/step_image.webp",
      },
    ]);
    expect(savedRecipes).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({
          steps: [{ imageKeys: ["recipes/user_123/recipe_123/step_image.webp"] }],
        }),
      }),
    ]);
    await expect(response.json()).resolves.toMatchObject({
      recipe: {
        content: {
          steps: [{ imageKeys: ["recipes/user_123/recipe_123/step_image.webp"] }],
        },
      },
    });
  });

  it("外部cover画像URLを確定objectKeyに変換して保存する", async () => {
    const externalCopies: unknown[] = [];
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
          return { objectKey: `${params.destinationKeyPrefix}.jpg` };
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "cover",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: {
              type: "externalImageUrl",
              url: "https://cdn.example.com/cover.jpg",
            },
          },
          source: { sourceUrl: "https://example.com/recipes/tomato" },
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(201);
    expect(externalCopies).toEqual([
      {
        sourceUrl: "https://cdn.example.com/cover.jpg",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      },
    ]);
    expect(savedRecipes).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({
          coverImageKey: "recipes/user_123/recipe_123/cover.jpg",
        }),
      }),
    ]);
    await expect(response.json()).resolves.toMatchObject({
      recipe: {
        content: {
          coverImageKey: "recipes/user_123/recipe_123/cover.jpg",
        },
      },
    });
  });

  it("外部画像URLの確定に失敗しても画像を省略してレシピを保存する", async () => {
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
        copyExternalImageUrl: async () => {
          throw new Error("external image unavailable");
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "external",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: {
              type: "externalImageUrl",
              url: "https://cdn.example.com/missing.jpg",
            },
            steps: [
              {
                images: [
                  {
                    type: "externalImageUrl",
                    url: "https://cdn.example.com/missing-step.jpg",
                  },
                ],
              },
              {
                text: "盛り付ける",
                images: [
                  {
                    type: "externalImageUrl",
                    url: "https://cdn.example.com/missing-step-2.jpg",
                  },
                ],
              },
            ],
          },
          source: {},
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
          coverImageKey: undefined,
          steps: [{ text: "盛り付ける", imageKeys: [] }],
        }),
      }),
    ]);
  });

  it("レシピ保存が例外で失敗したらcopy済み確定画像を削除対象にする", async () => {
    const deletes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("database failed");
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
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
        copyObject: async () => undefined,
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "image_456",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: { type: "tmpObjectKey", key: "tmp/user_123/upload.webp" },
          },
          source: {},
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(500);
    expect(deletes).toEqual(["recipes/user_123/recipe_123/image_456.webp"]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unknown" },
    });
  });

  it("外部画像URLのcopy後にレシピ保存が失敗したら確定画像を削除対象にする", async () => {
    const deletes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      recipeRepository: {
        createRecipeEnforcingPlanLimit: async () => {
          throw new Error("database failed");
        },
        getRecipe: async () => null,
        listRecipes: unusedListRecipes,
        updateRecipe: unusedUpdateRecipe,
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
        copyExternalImageUrl: async ({ destinationKeyPrefix }) => ({
          objectKey: `${destinationKeyPrefix}.webp`,
        }),
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "cover",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: {
              type: "externalImageUrl",
              url: "https://cdn.example.com/cover.webp",
            },
          },
          source: {},
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(500);
    expect(deletes).toEqual(["recipes/user_123/recipe_123/cover.webp"]);
  });

  it("外部画像URLのcopy後に保存上限超過なら確定画像を削除対象にする", async () => {
    const deletes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
        copyExternalImageUrl: async ({ destinationKeyPrefix }) => ({
          objectKey: `${destinationKeyPrefix}.webp`,
        }),
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "cover",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: {
              type: "externalImageUrl",
              url: "https://cdn.example.com/cover.webp",
            },
          },
          source: {},
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(403);
    expect(deletes).toEqual(["recipes/user_123/recipe_123/cover.webp"]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "recipe_limit_exceeded" },
    });
  });

  it("tmp画像の確定に失敗したらレシピを保存しない", async () => {
    const savedRecipes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
      createRecipeId: () => "recipe_123",
      createImageId: () => "image_456",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: { type: "tmpObjectKey", key: "tmp/user_123/upload.webp" },
          },
          source: {},
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(422);
    expect(savedRecipes).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "image_finalize_failed" },
    });
  });

  it("複数tmp画像の確定途中で失敗したらcopy済み確定画像を削除対象にする", async () => {
    const savedRecipes: unknown[] = [];
    const copies: unknown[] = [];
    const deletes: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
        },
        deleteObject: async (objectKey) => {
          deletes.push(objectKey);
        },
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "image_456",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
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
          source: {},
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
        destinationKey: "recipes/user_123/recipe_123/image_456.webp",
      },
    ]);
    expect(deletes).toEqual(["recipes/user_123/recipe_123/image_456.webp"]);
    expect(savedRecipes).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "image_finalize_failed" },
    });
  });

  it("tmp画像の実サイズが上限を超える場合はレシピを保存しない", async () => {
    const savedRecipes: unknown[] = [];
    const copies: unknown[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
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
        },
        deleteObject: async () => undefined,
        deletePrefixBestEffort: async () => undefined,
      },
      createRecipeId: () => "recipe_123",
      createImageId: () => "image_456",
    });

    const response = await testApp.request(
      "/api/recipes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: {
            title: "Tomato pasta",
            coverImage: { type: "tmpObjectKey", key: "tmp/user_123/upload.webp" },
          },
          source: {},
        }),
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(422);
    expect(copies).toEqual([]);
    expect(savedRecipes).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "image_finalize_failed" },
    });
  });
});
