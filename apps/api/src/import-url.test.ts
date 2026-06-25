import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertImportUrlAllowed,
  fetchImportPage,
  importRecipeFromUrl,
  normalizeImportableUrl,
  type RecipeImportAIInput,
  RecipeImportError,
} from "./import-url";
import { type DeterministicImporter } from "./lib/import/deterministic";
import { type SourceExtractor } from "./lib/import/source-extraction";
import { type UsageRepository } from "./usage";

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
    expect(aiNormalize).toHaveBeenCalledTimes(1);
  });

  it("YouTube URLはsource extraction結果をAI normalizationへ渡す", async () => {
    const usageRepository = createUsageRepositoryStub();
    const aiNormalize = vi.fn(async (_input: RecipeImportAIInput) => ({
      title: "鶏むねキャベツ鍋",
      coverImageUrl: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
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
        source: {
          finalUrl: "https://www.youtube.com/watch?v=FyLCRXMANAM",
          host: "youtube.com",
        },
        markdownContent: expect.stringContaining("## Description\n\n材料\nキャベツ 500g"),
        recipeStructuredEvidence: [],
      }),
    );
    const aiInput = aiNormalize.mock.calls[0]?.[0];
    expect(aiInput?.markdownContent).toContain(
      "![YouTube thumbnail](<https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg>)",
    );
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
          async normalize(input) {
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
          async normalize(input) {
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
          async normalize(input) {
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
