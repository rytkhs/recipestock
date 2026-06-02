import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@recipestock/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecipeImageService } from "./images";

const createTestImageService = () => {
  const puts: unknown[] = [];
  const env = {
    RECIPE_IMAGES: {
      put: async (key: string, body: unknown, options: unknown) => {
        puts.push({ key, body, options });
      },
    },
  };

  return {
    puts,
    service: createRecipeImageService(
      env as unknown as Parameters<typeof createRecipeImageService>[0],
    ),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecipeImageService", () => {
  it("外部画像URLを取得してcontent-typeに応じた確定objectKeyでR2へ保存する", async () => {
    const { puts, service } = createTestImageService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "image/jpeg",
            "content-length": "3",
          },
        });
      }),
    );

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).resolves.toEqual({
      objectKey: "recipes/user_123/recipe_123/cover.jpg",
    });

    expect(puts).toEqual([
      {
        key: "recipes/user_123/recipe_123/cover.jpg",
        body: expect.any(Uint8Array),
        options: { httpMetadata: { contentType: "image/jpeg" } },
      },
    ]);
  });

  it("外部画像URLのcontent-typeが対応外ならR2へ保存しない", async () => {
    const { puts, service } = createTestImageService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/gif" },
        });
      }),
    );

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover.gif",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).rejects.toThrow("External image content type is not supported.");
    expect(puts).toEqual([]);
  });

  it("外部画像URLのContent-Lengthが上限超過なら取得本文を保存しない", async () => {
    const { puts, service } = createTestImageService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "image/webp",
            "content-length": String(MAX_IMAGE_UPLOAD_SIZE_BYTES + 1),
          },
        });
      }),
    );

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover.webp",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).rejects.toThrow("External image is too large.");
    expect(puts).toEqual([]);
  });

  it("外部画像URLの実読込サイズが上限超過ならR2へ保存しない", async () => {
    const { puts, service } = createTestImageService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array(MAX_IMAGE_UPLOAD_SIZE_BYTES + 1), {
          headers: { "content-type": "image/png" },
        });
      }),
    );

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover.png",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).rejects.toThrow("External image is too large.");
    expect(puts).toEqual([]);
  });

  it("localhostやprivate IP literalの外部画像URLはfetchしない", async () => {
    const { service } = createTestImageService();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const sourceUrl of [
      "http://localhost/image.jpg",
      "http://127.0.0.1/image.jpg",
      "http://10.0.0.1/image.jpg",
      "http://172.16.0.1/image.jpg",
      "http://192.168.0.1/image.jpg",
      "http://[::1]/image.jpg",
    ]) {
      await expect(
        service.copyExternalImageUrl?.({
          sourceUrl,
          destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
        }),
      ).rejects.toThrow("External image URL is not allowed.");
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
