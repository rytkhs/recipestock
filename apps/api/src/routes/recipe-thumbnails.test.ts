import { describe, expect, it, vi } from "vitest";
import { type Bindings } from "../env";
import { createRecipeImageService } from "../images";
import { createSilentTestApp } from "../test-helpers";

const sourceKey = "recipes/user_123/recipe_123/cover.jpg";
const thumbnailKey = "recipes/user_123/recipe_123/_thumbnails/cover.jpg/v1.webp";
const url = `/api/images/thumbnail/v1/${sourceKey}`;
const auth = {
  getSession: async () => ({ user: { id: "user_123", email: "user@example.com" } }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const setup = ({ cached = false, authenticated = true } = {}) => {
  const objects = new Map<string, Uint8Array>([[sourceKey, new Uint8Array([1, 2, 3])]]);
  if (cached) objects.set(thumbnailKey, new Uint8Array([4, 5]));
  const object = (key: string): R2ObjectBody | null => {
    const bytes = objects.get(key);
    if (!bytes) return null;
    const contentType = key.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return {
      key,
      size: bytes.length,
      httpEtag: `"${bytes.join("-")}"`,
      uploaded: new Date("2026-09-06T00:00:00Z"),
      writeHttpMetadata: (headers: Headers) => headers.set("content-type", contentType),
      body: new Blob([new Uint8Array(bytes)]).stream(),
    } as R2ObjectBody;
  };
  const bucket = {
    head: vi.fn(async (key: string) => object(key)),
    get: vi.fn(async (key: string) => object(key)),
    put: vi.fn(async (key: string, bytes: ArrayBuffer, options: R2PutOptions) => {
      if (options.onlyIf && objects.has(key)) return null;
      objects.set(key, new Uint8Array(bytes));
      return object(key);
    }),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    })),
  };
  const output = vi.fn(async () => ({ response: () => new Response(new Uint8Array([4, 5])) }));
  const transform = vi.fn(() => ({ output }));
  const images = {
    input: vi.fn((stream: ReadableStream) => {
      void stream.cancel();
      return { transform };
    }),
  };
  const app = createSilentTestApp({
    auth: authenticated ? auth : { ...auth, getSession: async () => null },
  });
  const env = {
    APP_ENV: "development",
    RECIPE_IMAGES: bucket,
    IMAGES: images,
  } as unknown as Bindings;
  return {
    objects,
    bucket,
    images,
    transform,
    output,
    env,
    request: (path = url, headers?: HeadersInit) => app.request(path, { headers }, env),
  };
};

describe("Recipe thumbnails", () => {
  it("generates a fixed WebP variant, persists it, and reuses it without transforming", async () => {
    const fixture = setup();
    const response = await fixture.request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=604800");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("etag")).toBe('"4-5"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5]));
    expect(fixture.transform).toHaveBeenCalledWith({ width: 640, height: 640, fit: "scale-down" });
    expect(fixture.output).toHaveBeenCalledWith({ format: "image/webp", quality: 80, anim: false });
    expect(fixture.bucket.put).toHaveBeenCalledWith(thumbnailKey, expect.any(ArrayBuffer), {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "image/webp" },
    });
    expect(fixture.bucket.head).toHaveBeenCalledTimes(2);
    expect((await fixture.request()).status).toBe(200);
    expect(fixture.images.input).toHaveBeenCalledTimes(1);
  });

  it("returns 304 only for the derivative ETag, including weak validators", async () => {
    const fixture = setup({ cached: true });
    const response = await fixture.request(url, { "if-none-match": '"other", W/"4-5"' });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, max-age=604800");
    expect((await fixture.request(url, { "if-none-match": '"1-2-3"' })).status).toBe(200);
    expect(fixture.images.input).not.toHaveBeenCalled();
  });

  it("requires authentication before storage access", async () => {
    const fixture = setup({ authenticated: false });
    const response = await fixture.request();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.bucket.head).not.toHaveBeenCalled();
  });

  it.each([
    [url.replace("user_123", "user_999"), 403],
    [url.replace("/v1/", "/v2/"), 404],
    [`${url}?width=100`, 400],
    [url.replace("recipes/", "tmp/"), 400],
    [url.replace("cover.jpg", "folder%2Fcover.jpg"), 400],
    [url.replace("cover.jpg", "%ZZ.jpg"), 400],
    [url.replace("cover.jpg", "folder%5Ccover.jpg"), 400],
    [url.replace("cover.jpg", "_thumbnails/cover.jpg/v1.webp"), 400],
  ])("rejects invalid or unauthorized requests: %s", async (path, status) => {
    const fixture = setup();
    const response = await fixture.request(path);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.bucket.head).not.toHaveBeenCalled();
    expect(fixture.images.input).not.toHaveBeenCalled();
  });

  it("does not serve orphaned derivatives or allow direct access to their keys", async () => {
    const fixture = setup({ cached: true });
    fixture.objects.delete(sourceKey);
    const response = await fixture.request();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.bucket.get).not.toHaveBeenCalled();
    expect((await fixture.request(`/api/images/object/${thumbnailKey}`)).status).toBe(403);
  });

  it("serves the winning write's bytes and ETag when generation races", async () => {
    const fixture = setup();
    fixture.bucket.put.mockImplementationOnce(async () => {
      fixture.objects.set(thumbnailKey, new Uint8Array([9]));
      return null;
    });
    const response = await fixture.request();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"9"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9]));
  });

  it("removes generated data if the original was deleted while transforming", async () => {
    const fixture = setup();
    fixture.output.mockImplementationOnce(async () => {
      fixture.objects.delete(sourceKey);
      return { response: () => new Response(new Uint8Array([4, 5])) };
    });
    expect((await fixture.request()).status).toBe(404);
    expect(fixture.objects.has(thumbnailKey)).toBe(false);
  });

  it.each(["transform", "storage"])("returns an uncached error on %s failure", async (failure) => {
    const fixture = setup();
    if (failure === "transform")
      fixture.output.mockRejectedValueOnce(new Error("Transform failed"));
    else fixture.bucket.put.mockRejectedValueOnce(new Error("Storage failed"));
    const response = await fixture.request();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "thumbnail_unavailable" } });
    expect(fixture.objects.has(thumbnailKey)).toBe(false);
  });

  it("deletes all derivative versions along with a removed original", async () => {
    const fixture = setup({ cached: true });
    fixture.objects.set(thumbnailKey.replace("v1", "v0"), new Uint8Array([6]));
    fixture.objects.set("recipes/user_123/recipe_123/other.jpg", new Uint8Array([7]));
    await createRecipeImageService(fixture.env).deleteObject(sourceKey);
    expect([...fixture.objects.keys()]).toEqual(["recipes/user_123/recipe_123/other.jpg"]);
    expect(fixture.bucket.delete.mock.calls[0]).toEqual([sourceKey]);
  });

  it("does not list derivatives for temporary uploads", async () => {
    const fixture = setup();
    await createRecipeImageService(fixture.env).deleteObject("tmp/user_123/image.jpg");
    expect(fixture.bucket.list).not.toHaveBeenCalled();
  });
});
