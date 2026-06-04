import { afterEach, describe, expect, it, vi } from "vitest";
import { assertImportUrlAllowed, fetchImportPage, type RecipeImportError } from "./import-url";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("URL import fetcher", () => {
  it("localhostやprivate IP literalのURLはfetchしない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const sourceUrl of [
      "http://localhost/recipe",
      "http://127.0.0.1/recipe",
      "http://10.0.0.1/recipe",
      "http://172.16.0.1/recipe",
      "http://192.168.0.1/recipe",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/recipe",
    ]) {
      await expect(
        fetchImportPage(sourceUrl, { timeoutMs: 1000, maxBytes: 1024 }),
      ).rejects.toMatchObject({
        code: "invalid_url",
      } satisfies Partial<RecipeImportError>);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirect先がblocked hostなら本文を取得しない", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchImportPage("https://example.com/recipe", { timeoutMs: 1000, maxBytes: 1024 }),
    ).rejects.toMatchObject({
      code: "invalid_url",
    } satisfies Partial<RecipeImportError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/recipe",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("許可されたredirectは追跡しfinalUrlへ反映する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/recipes/tomato" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html><body>Tomato pasta</body></html>", {
          headers: { "content-type": "text/html" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchImportPage("https://example.com/start", { timeoutMs: 1000, maxBytes: 1024 }),
    ).resolves.toMatchObject({
      finalUrl: "https://example.com/recipes/tomato",
      contentType: "text/html",
      body: "<html><body>Tomato pasta</body></html>",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.com/recipes/tomato",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});

describe("assertImportUrlAllowed", () => {
  it("URL importで許可するprotocolとhostだけを通す", () => {
    expect(() => assertImportUrlAllowed("https://example.com/recipe")).not.toThrow();
    expect(() => assertImportUrlAllowed("ftp://example.com/recipe")).toThrow("Import URL");
    expect(() => assertImportUrlAllowed("http://localhost/recipe")).toThrow("Import URL");
  });
});
