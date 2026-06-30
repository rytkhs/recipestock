import {
  MAX_RECIPE_SOURCE_MEDIA_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_TOTAL_IMAGES,
} from "@recipestock/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertImportUrlAllowed,
  fetchImportPage,
  importRecipeFromUrl,
  normalizeImportableUrl,
  type RecipeImportAINormalizeRequest,
  RecipeImportError,
} from "./import-url";
import { type DeterministicImporter } from "./lib/import/deterministic";
import { type SourceExtractor } from "./lib/import/source-extraction";
import { type UsageRepository } from "./usage";
import { type YtDlpMetadata, type YtDlpMetadataClient, YtDlpMetadataError } from "./ytdlp-metadata";

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
      "http://[::ffff:127.0.0.1]/recipe",
      "http://[::ffff:10.0.0.1]/recipe",
      "http://[::ffff:172.16.0.1]/recipe",
      "http://[::ffff:192.168.0.1]/recipe",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::ffff:8.8.8.8]/recipe",
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

  it("明確な非HTMLは本文サイズの確認前に拒否する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("{}".repeat(1024), {
          headers: {
            "content-type": "application/json",
            "content-length": "2048",
          },
        });
      }),
    );

    await expect(
      fetchImportPage("https://example.com/recipe", { timeoutMs: 1000, maxBytes: 16 }),
    ).rejects.toMatchObject({
      code: "unsupported_page",
      message: "Import URL is not an HTML page.",
    } satisfies Partial<RecipeImportError>);
  });

  it("text/plainでもHTMLらしい本文なら取得する", async () => {
    const body = "<!doctype html><html><body>Tomato pasta</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(body, {
          headers: { "content-type": "text/plain" },
        });
      }),
    );

    await expect(
      fetchImportPage("https://example.com/recipe", { timeoutMs: 1000, maxBytes: 1024 }),
    ).resolves.toMatchObject({
      contentType: "text/plain",
      body,
    });
  });
});

describe("assertImportUrlAllowed", () => {
  it("URL importで許可するprotocolとhostだけを通す", () => {
    expect(() => assertImportUrlAllowed("https://example.com/recipe")).not.toThrow();
    expect(() => assertImportUrlAllowed("ftp://example.com/recipe")).toThrow("Import URL");
    expect(() => assertImportUrlAllowed("http://localhost/recipe")).toThrow("Import URL");
    expect(() => assertImportUrlAllowed("http://[::ffff:8.8.8.8]/recipe")).toThrow("Import URL");
  });
});

describe("normalizeImportableUrl", () => {
  it("raw URLを正規化してURL import policyを適用する", () => {
    expect(normalizeImportableUrl("https://www.example.com/recipe?b=2&a=1")).toBe(
      "https://www.example.com/recipe?b=2&a=1",
    );
    expect(() => normalizeImportableUrl("ftp://example.com/recipe")).toThrow("Import URL");
    expect(() => normalizeImportableUrl("http://localhost/recipe")).toThrow("Import URL");
  });
});

describe("URL import flow", () => {
  it("未指定またはstandardではAI経路に標準fetchを使う", async () => {
    for (const mode of [undefined, "standard"]) {
      const fetchMock = vi.fn(async () => {
        return new Response(
          "<article><h1>Standard fetch recipe</h1><p>Enough recipe content for import.</p></article>",
          {
            headers: { "content-type": "text/html" },
          },
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/standard",
        userId: "user_123",
        env: {
          IMPORT_FETCH_MODE: mode,
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: createAiProviderStub("Standard fetch recipe"),
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });

  it("browser-runではAI経路にrendered HTMLを使う", async () => {
    const renderedHtml =
      "<article><h1>Browser Run recipe</h1><p>Enough rendered recipe content for import.</p></article>";
    const quickAction = vi.fn(async () => {
      return Response.json({
        success: true,
        result: renderedHtml,
      });
    });

    await importRecipeFromUrl({
      rawUrl: "https://example.com/recipes/browser-run",
      userId: "user_123",
      env: {
        BROWSER: { quickAction },
        IMPORT_FETCH_MODE: "browser-run",
        IMPORT_TIMEOUT_MS: "90000",
        IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
      },
      usageRepository: createUsageRepositoryStub(),
      deterministicImporter: {
        async tryImport() {
          return null;
        },
      },
      aiProvider: createAiProviderStub("Browser Run recipe"),
    });

    expect(quickAction).toHaveBeenCalledWith("content", {
      url: "https://example.com/recipes/browser-run",
      gotoOptions: {
        timeout: 60_000,
        waitUntil: "networkidle2",
      },
      userAgent: expect.stringContaining("Chrome/125"),
    });
  });

  it("browser-runでもdeterministic importerには標準fetcherを渡す", async () => {
    const quickAction = vi.fn();
    const tryImport = vi.fn(async ({ fetcher }: { fetcher: unknown }) => {
      expect(fetcher).toBe(fetchImportPage);
      return {
        recipeDraftContent: {
          title: "Deterministic recipe",
          sourceMedia: [],
          ingredientGroups: [],
          steps: [],
        },
        source: {
          sourceUrl: "https://example.com/recipes/deterministic",
          sourceName: "Example",
        },
        warnings: [],
      };
    });

    await importRecipeFromUrl({
      rawUrl: "https://example.com/recipes/deterministic",
      userId: "user_123",
      env: {
        BROWSER: { quickAction },
        IMPORT_FETCH_MODE: "browser-run",
      },
      usageRepository: createUsageRepositoryStub(),
      deterministicImporter: { tryImport },
    });

    expect(quickAction).not.toHaveBeenCalled();
  });

  it("browser-runは不正URLを呼び出さない", async () => {
    const quickAction = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: "http://127.0.0.1/recipe",
        userId: "user_123",
        env: {
          BROWSER: { quickAction },
          IMPORT_FETCH_MODE: "browser-run",
        },
        usageRepository: createUsageRepositoryStub(),
      }),
    ).rejects.toMatchObject({
      code: "invalid_url",
    } satisfies Partial<RecipeImportError>);

    expect(quickAction).not.toHaveBeenCalled();
  });

  it.each([
    ["API failure", async () => new Response("failed", { status: 500 })],
    ["timeout", async () => Promise.reject(new Error("timeout"))],
    ["invalid response", async () => ({ result: "<html></html>" }) as never],
    ["invalid JSON", async () => new Response("<html></html>")],
    ["failed payload", async () => Response.json({ success: false, result: null })],
  ])("browser-runの%sをfetch_failedへ変換する", async (_name, implementation) => {
    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/browser-run-failure",
        userId: "user_123",
        env: {
          BROWSER: { quickAction: vi.fn(implementation) },
          IMPORT_FETCH_MODE: "browser-run",
        },
        usageRepository: createUsageRepositoryStub(),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "fetch_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("browser-runのHTMLが上限を超えた場合はunsupported_pageを返す", async () => {
    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/large",
        userId: "user_123",
        env: {
          BROWSER: {
            async quickAction() {
              return Response.json({
                success: true,
                result: "<html></html>",
              });
            },
          },
          IMPORT_FETCH_MODE: "browser-run",
          IMPORT_MAX_HTML_BYTES: "4",
        },
        usageRepository: createUsageRepositoryStub(),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "unsupported_page",
    } satisfies Partial<RecipeImportError>);
  });

  it("不正なfetch modeはunknownを返す", async () => {
    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/invalid-mode",
        userId: "user_123",
        env: {
          IMPORT_FETCH_MODE: "invalid",
        },
        usageRepository: createUsageRepositoryStub(),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "unknown",
    } satisfies Partial<RecipeImportError>);
  });

  it("deterministic importerが非対応の場合は既存どおりAI normalizationへ進む", async () => {
    const usageRepository = createUsageRepositoryStub();
    const aiNormalize = vi.fn(async () => ({
      title: "Fallback tomato pasta",
      ingredientGroups: [{ ingredients: [{ name: "Tomato", amount: "1" }] }],
      steps: [{ text: "Cook.", imageUrls: [] }],
    }));
    const tryImport = vi.fn(async () => null);
    const fetcher = vi.fn(async () => ({
      finalUrl: "https://example.com/recipes/fallback",
      contentType: "text/html",
      body: `
        <article>
          <h1>Fallback tomato pasta</h1>
          <p>Enough visible recipe content for extraction and import conversion.</p>
        </article>
      `,
    }));

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/fallback",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher,
        deterministicImporter: { tryImport },
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "Fallback tomato pasta",
      },
    });

    expect(tryImport).toHaveBeenCalledWith({
      normalizedUrl: "https://example.com/recipes/fallback",
      fetcher,
      fetchOptions: expect.any(Object),
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com/recipes/fallback",
      expect.any(Object),
    );
    expect(aiNormalize).toHaveBeenCalledWith(
      expect.objectContaining({
        promptProfile: "generic",
        input: expect.objectContaining({
          source: {
            finalUrl: "https://example.com/recipes/fallback",
            host: "example.com",
          },
        }),
      }),
    );
  });

  it("AI titleがnullの場合はstructured recipe nameで補完する", async () => {
    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/structured-title",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/structured-title",
          contentType: "text/html",
          body: `
            <html>
              <head>
                <meta property="og:title" content="OG tomato pasta">
                <script type="application/ld+json">
                  ${JSON.stringify({
                    "@context": "https://schema.org",
                    "@type": "Recipe",
                    name: "Structured tomato pasta",
                  })}
                </script>
              </head>
              <body><article><p>Enough visible recipe content for extraction.</p></article></body>
            </html>
          `,
        }),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          async normalize() {
            return {
              title: null,
              ingredientGroups: [],
              steps: [],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "Structured tomato pasta",
        ingredientGroups: [],
        steps: [],
      },
    });
  });

  it.each([
    {
      name: "og:title",
      html: `
        <html>
          <head><meta property="og:title" content="OG tomato pasta"></head>
          <body><article><p>Enough visible recipe content for extraction.</p></article></body>
        </html>
      `,
      expectedTitle: "OG tomato pasta",
    },
    {
      name: "twitter:title",
      html: `
        <html>
          <head><meta name="twitter:title" content="Twitter tomato pasta"></head>
          <body><article><p>Enough visible recipe content for extraction.</p></article></body>
        </html>
      `,
      expectedTitle: "Twitter tomato pasta",
    },
    {
      name: "HTML title",
      html: `
        <html>
          <head><title>HTML tomato pasta</title></head>
          <body><article><p>Enough visible recipe content for extraction.</p></article></body>
        </html>
      `,
      expectedTitle: "HTML tomato pasta",
    },
    {
      name: "sourceName",
      html: `
        <html>
          <head><meta property="og:site_name" content="Example Kitchen"></head>
          <body><article><p>Enough visible recipe content for extraction.</p></article></body>
        </html>
      `,
      expectedTitle: "Example Kitchen",
    },
  ])("AI titleがnullの場合は$nameで補完する", async ({ html, expectedTitle }) => {
    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/fallback-title",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/fallback-title",
          contentType: "text/html",
          body: html,
        }),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          async normalize() {
            return {
              title: null,
              ingredientGroups: [],
              steps: [],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: expectedTitle,
      },
    });
  });

  it("sourceNameも空の場合はhostで補完する", async () => {
    const sourceExtractor: SourceExtractor = {
      async tryExtract() {
        return {
          promptProfile: "social",
          input: {
            source: {
              finalUrl: "https://example.com/recipes/host-title",
              host: "example.com",
            },
            markdownContent: "Enough extracted content for host fallback.",
            recipeStructuredEvidence: [],
          },
          imageCandidates: [],
          source: {
            sourceUrl: "https://example.com/recipes/host-title",
            sourceName: null,
          },
          warnings: [],
        };
      },
    };

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/host-title",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        sourceExtractor,
        aiProvider: {
          async normalize() {
            return {
              title: null,
              ingredientGroups: [],
              steps: [],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "example.com",
      },
    });
  });

  it.each([
    { title: "", expectedTitle: "OG tomato pasta" },
    { title: "   ", expectedTitle: "OG tomato pasta" },
  ])("AI titleが空の場合はfallback titleで補完する", async ({ title, expectedTitle }) => {
    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/empty-ai-title",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/empty-ai-title",
          contentType: "text/html",
          body: `
            <html>
              <head><meta property="og:title" content="OG tomato pasta"></head>
              <body><article><p>Enough visible recipe content for extraction.</p></article></body>
            </html>
          `,
        }),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          async normalize() {
            return {
              title,
              ingredientGroups: [],
              steps: [],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: expectedTitle,
        ingredientGroups: [],
        steps: [],
      },
    });
  });

  it("AI titleが有効な場合はfallback titleで上書きしない", async () => {
    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/ai-title",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/ai-title",
          contentType: "text/html",
          body: `
            <html>
              <head><meta property="og:title" content="OG tomato pasta"></head>
              <body><article><p>Enough visible recipe content for extraction.</p></article></body>
            </html>
          `,
        }),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          async normalize() {
            return {
              title: "AI tomato pasta",
              ingredientGroups: [],
              steps: [],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "AI tomato pasta",
      },
    });
  });

  it("YouTube URLはsource extraction結果をAI normalizationへ渡す", async () => {
    const usageRepository = createUsageRepositoryStub();
    const aiNormalize = vi.fn(async (_request: RecipeImportAINormalizeRequest) => ({
      title: "鶏むねキャベツ鍋",
      ingredientGroups: [{ ingredients: [{ name: "キャベツ", amount: "500g" }] }],
      steps: [{ text: "煮る。", imageUrls: [] }],
    }));
    const fetcher = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: "text/html",
      body: createYouTubeHtml({
        videoId: "FyLCRXMANAM",
        title: "鶏むねキャベツ鍋",
        author: "Recipe Channel",
        shortDescription: "材料\nキャベツ 500g\n作り方\n煮る。",
        thumbnail: {
          thumbnails: [
            { url: "https://i.ytimg.com/vi/FyLCRXMANAM/default.jpg", width: 120, height: 90 },
            {
              url: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
              width: 1280,
              height: 720,
            },
          ],
        },
      }),
    }));

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://youtu.be/FyLCRXMANAM?si=vxf25wqv_kohdf4L",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher,
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "鶏むねキャベツ鍋",
        coverImage: {
          type: "externalImageUrl",
          url: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
        },
      },
      source: {
        sourceUrl: "https://www.youtube.com/watch?v=FyLCRXMANAM",
        sourceName: "YouTube",
      },
      warnings: [],
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=FyLCRXMANAM",
      expect.any(Object),
    );
    expect(aiNormalize).toHaveBeenCalledWith(
      expect.objectContaining({
        promptProfile: "social",
        input: expect.objectContaining({
          source: {
            finalUrl: "https://www.youtube.com/watch?v=FyLCRXMANAM",
            host: "youtube.com",
          },
          markdownContent: expect.stringContaining("## Description\n\n材料\nキャベツ 500g"),
          recipeStructuredEvidence: [],
        }),
      }),
    );
    const aiInput = aiNormalize.mock.calls[0]?.[0]?.input;
    expect(aiInput?.markdownContent).not.toContain(
      "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
    );
    expect(aiInput?.markdownContent).not.toContain("![YouTube thumbnail]");
  });

  it("YouTube source extraction失敗時はgeneric HTML conversionへfallbackしない", async () => {
    const aiNormalize = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://www.youtube.com/watch?v=FyLCRXMANAM",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher: async (url) => ({
          finalUrl: url,
          contentType: "text/html",
          body: "<html><article><h1>Generic recipe</h1><p>Enough recipe text.</p></article></html>",
        }),
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(aiNormalize).not.toHaveBeenCalled();
  });

  it("X/Twitter URLはsource extraction結果をAI normalizationへ渡し画像を決定的に配置する", async () => {
    const imageUrl = "https://pbs.twimg.com/media/HL337ewbEAIg_Ux.jpg";
    const aiNormalize = vi.fn(async ({ input }: RecipeImportAINormalizeRequest) => ({
      title: "卵焼き",
      ingredientGroups: [{ ingredients: [{ name: "卵", amount: "2個" }] }],
      steps: [
        { text: input.markdownContent.includes("焼く") ? "焼く。" : "作る。", imageUrls: [] },
      ],
    }));
    const fetcher = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: "text/html",
      body: createXTwitterHtml({
        description: "材料&#10;卵 2個&#10;作り方&#10;焼く",
        body: `<script>{"media":"${imageUrl}"}</script>`,
      }),
    }));

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://twitter.com/HG7654321/status/2071084010705727927?s=20",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher,
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "卵焼き",
        coverImage: {
          type: "externalImageUrl",
          url: imageUrl,
        },
        sourceMedia: [
          {
            type: "externalImageUrl",
            url: imageUrl,
          },
        ],
      },
      source: {
        sourceUrl: "https://x.com/HG7654321/status/2071084010705727927",
        sourceName: "X",
      },
      warnings: [],
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://x.com/HG7654321/status/2071084010705727927",
      expect.any(Object),
    );
    expect(aiNormalize).toHaveBeenCalledWith({
      promptProfile: "social",
      input: {
        source: {
          finalUrl: "https://x.com/HG7654321/status/2071084010705727927",
          host: "x.com",
        },
        markdownContent: ["材料\n卵 2個\n作り方\n焼く"].join("\n"),
        recipeStructuredEvidence: [],
      },
    });
    const aiInput = aiNormalize.mock.calls[0]?.[0]?.input;
    expect(aiInput?.markdownContent).not.toContain("Source: X");
    expect(aiInput?.markdownContent).not.toContain("https://x.com");
    expect(aiInput?.markdownContent).not.toContain(imageUrl);
  });

  it("X/Twitter source extraction失敗時はgeneric HTML conversionへfallbackしない", async () => {
    const aiNormalize = vi.fn();
    const fetcher = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: "text/html",
      body: "<html><article><h1>Generic X recipe</h1><p>Enough recipe text.</p></article></html>",
    }));

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://x.com/HG7654321/status/2071084010705727927",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher,
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(aiNormalize).not.toHaveBeenCalled();
  });

  it("Instagram source extractionではgeneric HTML conversionへfallbackしない", async () => {
    const fetcher = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: "text/html",
      body: "<html><article><h1>Generic Instagram recipe</h1></article></html>",
    }));
    const ytdlpMetadata = {
      ok: true,
      source: {
        platform: "instagram",
        canonicalUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
        shortcode: "DYsxvKyAZMg",
        mediaKind: "post",
      },
      metadata: {
        provider: "yt-dlp",
        extractor: "Instagram",
        webpageUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
        title: "Post by mizuki_31cafe",
        description: "材料\nなす 5本\n作り方\n揚げ焼きにする",
        uploader: "mizuki_31cafe",
        thumbnail: null,
        thumbnails: [],
        duration: null,
        availability: null,
      },
      images: [
        {
          url: "https://cdn.example.com/cover.jpg",
          kind: "thumbnail",
          source: "top_level",
        },
        {
          url: "https://cdn.example.com/step.jpg",
          kind: "thumbnail",
          source: "entry",
          entryIndex: 1,
        },
      ],
    } satisfies YtDlpMetadata;
    const ytdlpMetadataClient = {
      extract: vi.fn(async () => ytdlpMetadata),
    } satisfies YtDlpMetadataClient;
    const aiNormalize = vi.fn(async ({ input, promptProfile }: RecipeImportAINormalizeRequest) => {
      expect(promptProfile).toBe("social");
      expect(input.source).toEqual({
        finalUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
        host: "instagram.com",
      });
      expect(input.markdownContent).toContain("Source: Instagram");
      expect(input.markdownContent).toContain("## Caption\n\n材料\nなす 5本");
      expect(input.markdownContent).not.toContain("## Images");
      expect(input.markdownContent).not.toContain("https://cdn.example.com/cover.jpg");

      return {
        title: "Instagram recipe",
        ingredientGroups: [],
        steps: [{ text: "揚げ焼きにする。", imageUrls: [] }],
      };
    });

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://www.instagram.com/p/DYsxvKyAZMg/?hl=ja",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher,
        ytdlpMetadataClient,
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "Instagram recipe",
        coverImage: {
          type: "externalImageUrl",
          url: "https://cdn.example.com/cover.jpg",
        },
        sourceMedia: [
          { type: "externalImageUrl", url: "https://cdn.example.com/cover.jpg" },
          { type: "externalImageUrl", url: "https://cdn.example.com/step.jpg" },
        ],
        steps: [
          {
            text: "揚げ焼きにする。",
            images: [],
          },
        ],
      },
      source: {
        sourceUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
        sourceName: "Instagram",
      },
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(ytdlpMetadataClient.extract).toHaveBeenCalledWith({
      platform: "instagram",
      url: "https://www.instagram.com/p/DYsxvKyAZMg/",
      timeoutMs: 10_000,
    });
  });

  it("Instagram private/login failureはgeneric HTML conversionへfallbackしない", async () => {
    const fetcher = vi.fn(async (url: string) => ({
      finalUrl: url,
      contentType: "text/html",
      body: "<html><article><h1>Generic Instagram recipe</h1></article></html>",
    }));
    const ytdlpMetadataClient = {
      extract: vi.fn(async () => {
        throw new YtDlpMetadataError(
          "private_or_login_required",
          "Instagram post is private, unavailable, or requires login.",
        );
      }),
    } satisfies YtDlpMetadataClient;
    const aiNormalize = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://www.instagram.com/p/DYsxvKyAZMg/?hl=ja",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository: createUsageRepositoryStub(),
        fetcher,
        ytdlpMetadataClient,
        deterministicImporter: {
          async tryImport() {
            return null;
          },
        },
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).rejects.toMatchObject({
      code: "private_or_login_required",
    } satisfies Partial<RecipeImportError>);

    expect(fetcher).not.toHaveBeenCalled();
    expect(aiNormalize).not.toHaveBeenCalled();
  });

  it("AI import結果の画像上限超過は切り詰めて成功する", async () => {
    const sourceMediaUrls = createImageUrls(MAX_RECIPE_SOURCE_MEDIA_IMAGES + 1, "source");
    const stepImageUrlGroups = createStepImageUrlGroups(
      MAX_RECIPE_TOTAL_IMAGES - MAX_RECIPE_SOURCE_MEDIA_IMAGES,
      "step",
    );
    const stepImageUrls = stepImageUrlGroups.flat();
    const imageCandidates = [createImageUrl("cover"), ...sourceMediaUrls, ...stepImageUrls].map(
      (url, position) => ({
        id: `img_${position}`,
        url,
        position,
      }),
    );
    const sourceExtractor: SourceExtractor = {
      async tryExtract() {
        return {
          promptProfile: "social",
          input: {
            source: {
              finalUrl: "https://www.example.com/recipes/image-limits",
              host: "example.com",
            },
            markdownContent: "Image limit recipe",
            recipeStructuredEvidence: [],
          },
          imageCandidates,
          imagePlacement: {
            coverImageUrl: createImageUrl("cover"),
            sourceMediaUrls,
          },
          source: {
            sourceUrl: "https://www.example.com/recipes/image-limits",
            sourceName: "Example",
          },
          warnings: [],
        };
      },
    };

    const result = await importRecipeFromUrl({
      rawUrl: "https://www.example.com/recipes/image-limits",
      userId: "user_123",
      env: {
        IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
      },
      usageRepository: createUsageRepositoryStub(),
      deterministicImporter: {
        async tryImport() {
          return null;
        },
      },
      sourceExtractor,
      aiProvider: {
        async normalize() {
          return {
            title: "Image limit recipe",
            ingredientGroups: [],
            steps: stepImageUrlGroups.map((imageUrls, index) => ({
              text: `Cook ${index + 1}.`,
              imageUrls,
            })),
          };
        },
      },
    });

    expect(result.recipeDraftContent.sourceMedia).toHaveLength(MAX_RECIPE_SOURCE_MEDIA_IMAGES);
    expect(
      result.recipeDraftContent.steps.every((step) => step.images.length <= MAX_RECIPE_STEP_IMAGES),
    ).toBe(true);
    expect(countDraftImages(result.recipeDraftContent)).toBe(MAX_RECIPE_TOTAL_IMAGES);
  });

  it("deterministic importerが成功した場合はAI providerとAI usageを使わない", async () => {
    const consumeAiUsage = vi.fn(async ({ month }: { month: string }) => ({
      status: "consumed" as const,
      usage: { month, used: 1 },
    }));
    const usageRepository: UsageRepository = {
      async getOrCreateAppUser(userId) {
        return { userId, plan: "free" };
      },
      async getAiUsage(_userId, month) {
        return { month, used: 0 };
      },
      consumeAiUsage,
    };
    const aiNormalize = vi.fn();
    const sourceExtractor: SourceExtractor = {
      tryExtract: vi.fn(),
    };
    const deterministicImporter: DeterministicImporter = {
      async tryImport() {
        return {
          recipeDraftContent: {
            title: "Deterministic soup",
            sourceMedia: [],
            ingredientGroups: [{ ingredients: [{ name: "Salt", amount: "1 tsp" }] }],
            steps: [{ text: "Simmer.", images: [] }],
          },
          source: {
            sourceUrl: "https://www.example.com/recipes/deterministic",
            sourceName: "Example Kitchen",
          },
          warnings: ["deterministic warning"],
        };
      },
    };

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://www.example.com/recipes/deterministic",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        deterministicImporter,
        sourceExtractor,
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "Deterministic soup",
      },
      source: {
        sourceUrl: "https://www.example.com/recipes/deterministic",
        sourceName: "Example Kitchen",
      },
      warnings: ["deterministic warning"],
    });

    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
    expect(sourceExtractor.tryExtract).not.toHaveBeenCalled();
  });

  it("deterministic importerが失敗した場合はAI fallbackしない", async () => {
    const usageRepository = createUsageRepositoryStub();
    const aiNormalize = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/failing-deterministic",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        deterministicImporter: {
          async tryImport() {
            throw new RecipeImportError("extraction_failed", "Site structure changed.");
          },
        },
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(aiNormalize).not.toHaveBeenCalled();
  });

  it("HTML page evidenceをAI入力へ渡す", async () => {
    const usageRepository = createUsageRepositoryStub();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/test",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/test",
          contentType: "text/html",
          body: `
            <html>
              <head>
                <meta property="og:site_name" content="Example Kitchen">
              </head>
              <body>
                <article>
                  <h1>Tomato pasta</h1>
                  <p>Enough visible recipe content for extraction and import conversion.</p>
                  <img src="/cover.jpg" alt="Tomato pasta cover">
                </article>
              </body>
            </html>
          `,
        }),
        aiProvider: {
          async normalize({ input, promptProfile }) {
            expect(promptProfile).toBe("generic");
            expect(input).toMatchObject({
              source: {
                finalUrl: "https://example.com/recipes/test",
                host: "example.com",
              },
              markdownContent: expect.stringContaining("Tomato pasta"),
            });

            return {
              title: "Tomato pasta",
              coverImageUrl: "https://example.com/cover.jpg",
              ingredientGroups: [{ ingredients: [{ name: "Tomato", amount: "1" }] }],
              steps: [{ text: "Cook.", imageUrls: [] }],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "Tomato pasta",
        coverImage: {
          type: "externalImageUrl",
          url: "https://example.com/cover.jpg",
        },
      },
      source: {
        sourceUrl: "https://example.com/recipes/test",
        sourceName: "Example Kitchen",
      },
    });
  });

  it("structured evidence由来の画像URLをAI返却画像として許可する", async () => {
    const usageRepository = createUsageRepositoryStub();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/structured-image",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/structured-image",
          contentType: "text/html",
          body: `
            <article itemscope itemtype="https://schema.org/Recipe">
              <h1 itemprop="name">Structured image recipe</h1>
              <meta itemprop="image" content="/structured.jpg">
              <p itemprop="recipeIngredient">Flour 100g</p>
              <p itemprop="recipeInstructions">Mix and bake.</p>
              <p>Enough visible recipe content for extraction and import conversion.</p>
            </article>
          `,
        }),
        aiProvider: {
          async normalize({ input, promptProfile }) {
            expect(promptProfile).toBe("generic");
            expect(input.recipeStructuredEvidence).toContainEqual(
              expect.objectContaining({
                imageUrls: ["https://example.com/structured.jpg"],
              }),
            );
            expect(JSON.stringify(input.recipeStructuredEvidence)).toContain(
              "https://example.com/structured.jpg",
            );

            return {
              title: "Structured image recipe",
              coverImageUrl: "https://example.com/structured.jpg",
              ingredientGroups: [{ ingredients: [{ name: "Flour", amount: "100g" }] }],
              steps: [{ text: "Mix and bake.", imageUrls: [] }],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        coverImage: {
          type: "externalImageUrl",
          url: "https://example.com/structured.jpg",
        },
      },
      warnings: [],
    });
  });

  it("JSON-LD手順画像URLをAI返却画像として許可する", async () => {
    const usageRepository = createUsageRepositoryStub();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/structured-step-image",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/structured-step-image",
          contentType: "text/html",
          body: `
            <html>
              <head>
                <script type="application/ld+json">
                  {
                    "@context": "https://schema.org",
                    "@type": "Recipe",
                    "name": "Structured step image recipe",
                    "recipeIngredient": ["Flour 100g"],
                    "recipeInstructions": [
                      {
                        "@type": "HowToStep",
                        "text": "Mix and bake.",
                        "image": "/step.jpg"
                      }
                    ]
                  }
                </script>
              </head>
              <body>
                <main>
                  <h1>Structured step image recipe</h1>
                  <p>Enough visible recipe content for extraction and import conversion.</p>
                </main>
              </body>
            </html>
          `,
        }),
        aiProvider: {
          async normalize({ input, promptProfile }) {
            expect(promptProfile).toBe("generic");
            expect(JSON.stringify(input.recipeStructuredEvidence)).toContain(
              '"imageUrls":["https://example.com/step.jpg"]',
            );

            return {
              title: "Structured step image recipe",
              ingredientGroups: [{ ingredients: [{ name: "Flour", amount: "100g" }] }],
              steps: [
                {
                  text: "Mix and bake.",
                  imageUrls: ["https://example.com/step.jpg"],
                },
              ],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        steps: [
          {
            images: [{ type: "externalImageUrl", url: "https://example.com/step.jpg" }],
          },
        ],
      },
      warnings: [],
    });
  });

  it("AIが候補外または改変した画像URLを返した場合は画像を破棄してwarningを返す", async () => {
    const usageRepository = createUsageRepositoryStub();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/unknown-image-url",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/unknown-image-url",
          contentType: "text/html",
          body: `
            <article>
              <h1>Unknown image URL recipe</h1>
              <p>Enough visible recipe content for extraction and import conversion.</p>
              <img src="/known.jpg" alt="Known">
            </article>
          `,
        }),
        aiProvider: {
          async normalize() {
            return {
              title: "Unknown image URL recipe",
              coverImageUrl: "https://example.com/generated.jpg",
              ingredientGroups: [],
              steps: [
                {
                  text: "Serve.",
                  imageUrls: ["https://example.com/known.jpg?modified=1"],
                },
              ],
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        coverImage: undefined,
        steps: [
          {
            images: [],
          },
        ],
      },
      warnings: [
        "AI returned unknown image URL: https://example.com/generated.jpg",
        "AI returned unknown image URL: https://example.com/known.jpg?modified=1",
      ],
    });
  });
});

const createUsageRepositoryStub = (): UsageRepository => ({
  async getOrCreateAppUser(userId) {
    return { userId, plan: "free" };
  },
  async getAiUsage(_userId, month) {
    return { month, used: 0 };
  },
  async consumeAiUsage({ month }) {
    return { status: "consumed", usage: { month, used: 1 } };
  },
});

const createAiProviderStub = (title: string) => ({
  async normalize() {
    return {
      title,
      ingredientGroups: [],
      steps: [],
    };
  },
});

const createImageUrl = (id: string) => `https://images.example/${id}.jpg`;

const createImageUrls = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => createImageUrl(`${prefix}-${index}`));

const createStepImageUrlGroups = (imageCount: number, prefix: string) =>
  Array.from({ length: Math.ceil(imageCount / MAX_RECIPE_STEP_IMAGES) }, (_, stepIndex) =>
    createImageUrls(MAX_RECIPE_STEP_IMAGES + 1, `${prefix}-${stepIndex}`),
  );

const countDraftImages = (content: { sourceMedia?: unknown[]; steps?: { images?: unknown[] }[] }) =>
  (content.sourceMedia?.length ?? 0) +
  (content.steps ?? []).reduce((count, step) => count + (step.images?.length ?? 0), 0);

const createYouTubeHtml = (videoDetails: unknown) => `
  <html>
    <head>
      <script>
        var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails })};
      </script>
    </head>
    <body>
      <article>
        <h1>Generic YouTube page text should not be used.</h1>
      </article>
    </body>
  </html>
`;

const createXTwitterHtml = ({ description, body = "" }: { description: string; body?: string }) => `
  <html>
    <head>
      <meta property="og:description" content="${description}">
    </head>
    <body>${body}</body>
  </html>
`;
