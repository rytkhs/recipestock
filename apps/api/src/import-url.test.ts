import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertImportUrlAllowed,
  fetchImportPage,
  importRecipeFromUrl,
  normalizeImportableUrl,
  RecipeImportError,
} from "./import-url";
import { createDeterministicImportRegistry } from "./lib/import/deterministic";
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
  it("deterministic adapterがmatchしない場合は既存どおりAI normalizationへ進む", async () => {
    const usageRepository = createUsageRepositoryStub();
    const aiNormalize = vi.fn(async () => ({
      title: "Fallback tomato pasta",
      ingredientGroups: [{ ingredients: [{ name: "Tomato", amount: "1" }] }],
      steps: [{ text: "Cook.", imageIds: [] }],
    }));
    const match = vi.fn(() => false);

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/fallback",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/fallback",
          contentType: "text/html",
          body: `
            <article>
              <h1>Fallback tomato pasta</h1>
              <p>Enough visible recipe content for extraction and import conversion.</p>
            </article>
          `,
        }),
        deterministicImportRegistry: createDeterministicImportRegistry([
          {
            id: "no-match",
            match,
            async convert() {
              throw new Error("should not convert");
            },
          },
        ]),
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "Fallback tomato pasta",
      },
    });

    expect(match).toHaveBeenCalledWith({
      finalUrl: "https://example.com/recipes/fallback",
      normalizedUrl: "https://example.com/recipes/fallback",
      host: "example.com",
    });
    expect(aiNormalize).toHaveBeenCalledTimes(1);
  });

  it("deterministic adapterが成功した場合はAI providerとAI usageを使わない", async () => {
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

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://www.example.com/recipes/deterministic",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher: async () => ({
          finalUrl: "https://www.example.com/recipes/deterministic",
          contentType: "text/html",
          body: `
            <html>
              <head>
                <meta property="og:site_name" content="Example Kitchen">
              </head>
              <body>
                <article>
                  <h1>Deterministic soup</h1>
                  <p>Enough visible recipe content for extraction and import conversion.</p>
                </article>
              </body>
            </html>
          `,
        }),
        deterministicImportRegistry: createDeterministicImportRegistry([
          {
            id: "example",
            match: ({ host }) => host === "example.com",
            async convert(context) {
              expect(context).toMatchObject({
                finalUrl: "https://www.example.com/recipes/deterministic",
                normalizedUrl: "https://www.example.com/recipes/deterministic",
                host: "example.com",
              });
              expect(context.evidence.markdownContent).toContain("Deterministic soup");

              return {
                recipeDraftContent: {
                  title: "Deterministic soup",
                  ingredientGroups: [{ ingredients: [{ name: "Salt", amount: "1 tsp" }] }],
                  steps: [{ text: "Simmer.", images: [] }],
                },
                source: {
                  sourceUrl: context.normalizedUrl,
                  sourceName: "Example Kitchen",
                },
                warnings: ["deterministic warning"],
              };
            },
          },
        ]),
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
  });

  it("deterministic adapterが失敗した場合はAI fallbackしない", async () => {
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
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/failing-deterministic",
          contentType: "text/html",
          body: `
            <article>
              <h1>Failing deterministic recipe</h1>
              <p>Enough visible recipe content for extraction and import conversion.</p>
            </article>
          `,
        }),
        deterministicImportRegistry: createDeterministicImportRegistry([
          {
            id: "example",
            match: () => true,
            async convert() {
              throw new RecipeImportError("extraction_failed", "Site structure changed.");
            },
          },
        ]),
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(aiNormalize).not.toHaveBeenCalled();
  });

  it("deterministic adapterのRecipeDraftContentをschema validationする", async () => {
    const usageRepository = createUsageRepositoryStub();
    const aiNormalize = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/invalid-deterministic-result",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/invalid-deterministic-result",
          contentType: "text/html",
          body: `
            <article>
              <h1>Invalid deterministic result</h1>
              <p>Enough visible recipe content for extraction and import conversion.</p>
            </article>
          `,
        }),
        deterministicImportRegistry: createDeterministicImportRegistry([
          {
            id: "example",
            match: () => true,
            async convert() {
              return {
                recipeDraftContent: {
                  title: "",
                  ingredientGroups: [],
                  steps: [],
                },
                source: {
                  sourceUrl: "https://example.com/recipes/invalid-deterministic-result",
                  sourceName: "Example",
                },
                warnings: [],
              };
            },
          },
        ]),
        aiProvider: {
          normalize: aiNormalize,
        },
      }),
    ).rejects.toThrow();

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
              coverImageId: "img_001",
              ingredientGroups: [{ ingredients: [{ name: "Tomato", amount: "1" }] }],
              steps: [{ text: "Cook.", imageIds: [] }],
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
              expect.objectContaining({ imageIds: ["img_001"] }),
            );
            expect(JSON.stringify(input.recipeStructuredEvidence)).not.toContain(
              "https://example.com/structured.jpg",
            );

            return {
              title: "Structured image recipe",
              coverImageId: "img_001",
              ingredientGroups: [{ ingredients: [{ name: "Flour", amount: "100g" }] }],
              steps: [{ text: "Mix and bake.", imageIds: [] }],
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
              '"imageIds":["img_001"]',
            );
            expect(JSON.stringify(input.recipeStructuredEvidence)).not.toContain(
              "https://example.com/step.jpg",
            );

            return {
              title: "Structured step image recipe",
              ingredientGroups: [{ ingredients: [{ name: "Flour", amount: "100g" }] }],
              steps: [
                {
                  text: "Mix and bake.",
                  imageIds: ["img_001"],
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

  it("AIが不明な画像IDを返した場合は画像を破棄してwarningを返す", async () => {
    const usageRepository = createUsageRepositoryStub();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://example.com/recipes/unknown-image-id",
        userId: "user_123",
        env: {
          AI_TEXT_MODEL: "@cf/test",
          IMPORT_RECIPE_SYSTEM_PROMPT: "Normalize recipe.",
        },
        usageRepository,
        fetcher: async () => ({
          finalUrl: "https://example.com/recipes/unknown-image-id",
          contentType: "text/html",
          body: `
            <article>
              <h1>Unknown image ID recipe</h1>
              <p>Enough visible recipe content for extraction and import conversion.</p>
              <img src="/known.jpg" alt="Known">
            </article>
          `,
        }),
        aiProvider: {
          async normalize() {
            return {
              title: "Unknown image ID recipe",
              coverImageId: "img_999",
              ingredientGroups: [],
              steps: [
                {
                  text: "Serve.",
                  imageIds: ["img_001"],
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
            images: [{ type: "externalImageUrl", url: "https://example.com/known.jpg" }],
          },
        ],
      },
      warnings: ["AI returned unknown image ID: img_999"],
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
