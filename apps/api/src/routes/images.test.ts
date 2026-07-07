import { describe, expect, it } from "vitest";
import { createSilentTestApp } from "../test-helpers";

const auth = {
  getSession: async () => ({
    user: { id: "user_123", email: "user@example.com" },
  }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const imageBytes = new TextEncoder().encode("image bytes");

const createR2ObjectBody = (key: string) =>
  ({
    key,
    version: "version_123",
    size: imageBytes.byteLength,
    etag: "etag_123",
    httpEtag: '"etag_123"',
    uploaded: new Date("2026-05-31T00:00:00.000Z"),
    checksums: {},
    httpMetadata: { contentType: "image/webp" },
    customMetadata: {},
    storageClass: "Standard",
    writeHttpMetadata: (headers: Headers) => {
      headers.set("content-type", "image/webp");
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(imageBytes);
        controller.close();
      },
    }),
    bodyUsed: false,
    arrayBuffer: async () => imageBytes.buffer.slice(0),
    bytes: async () => imageBytes,
    text: async () => "image bytes",
    json: async () => ({}),
    blob: async () => new Blob([imageBytes], { type: "image/webp" }),
  }) as R2ObjectBody;

describe("Image routes", () => {
  it("ログイン済みユーザーが画像アップロード用URLを取得できる", async () => {
    const testApp = createSilentTestApp({
      auth,
      imageService: {
        createUploadUrl: async ({ objectKey }) => ({
          url: `https://upload.example/${objectKey}`,
          expiresAt: new Date("2026-05-31T00:15:00.000Z"),
        }),
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
    const testApp = createSilentTestApp({
      auth,
      imageService: {
        createUploadUrl: async () => {
          throw new Error("signing failed");
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
    const testApp = createSilentTestApp({
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
    const testApp = createSilentTestApp({ auth });

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

  it("ログイン済みユーザーが自分のレシピ画像を取得できる", async () => {
    const calls: unknown[] = [];
    const testApp = createSilentTestApp({
      auth,
    });

    const response = await testApp.request(
      "/api/images/object/recipes/user_123/recipe_123/step.webp",
      undefined,
      {
        APP_ENV: "development",
        RECIPE_IMAGES: {
          get: async (key: string, options: unknown) => {
            calls.push({ key, options });
            return createR2ObjectBody(key);
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, max-age=604800");
    expect(response.headers.get("etag")).toBe('"etag_123"');
    expect(calls).toEqual([
      {
        key: "recipes/user_123/recipe_123/step.webp",
        options: { onlyIf: expect.any(Headers) },
      },
    ]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes);
  });

  it("他ユーザーのレシピ画像は取得できない", async () => {
    const testApp = createSilentTestApp({
      auth,
    });

    const response = await testApp.request(
      "/api/images/object/recipes/user_999/recipe_123/step.webp",
      undefined,
      { APP_ENV: "development" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });
});
