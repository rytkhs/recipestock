import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertImportUrlAllowed,
  fetchImportPage,
  genericHtmlImportConverter,
  importRecipeFromUrl,
  type RecipeImportError,
} from "./import-url";
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

describe("generic HTML import converter", () => {
  it("本文画像をMarkdown内のIDマーカーに置換し、画像URLをAI入力から除外する", async () => {
    const conversion = await convertRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Tomato pasta",
              "image": "/cover.jpg",
              "recipeIngredient": ["Tomato 1 can"],
              "recipeInstructions": ["Simmer the tomato sauce."]
            }
          </script>
        </head>
        <body>
          <article>
            <h1>Tomato pasta</h1>
            <p>Enough visible recipe content for extraction.</p>
            <img src="/cover.jpg" alt="Tomato pasta cover">
          </article>
        </body>
      </html>
    `);

    expect(conversion.input.markdownContent).toContain("Tomato pasta");
    expect(conversion.input.markdownContent).toContain(
      'RS_IMAGE id=img_001 alt="Tomato pasta cover"',
    );
    expect(conversion.input.markdownContent).not.toContain("/cover.jpg");
    expect(JSON.stringify(conversion.input.recipeStructuredEvidence)).not.toContain(
      "https://example.com/cover.jpg",
    );
    expect(conversion.input.recipeStructuredEvidence).toContainEqual(
      expect.objectContaining({
        imageIds: ["img_001"],
      }),
    );
    expect(conversion.imageCandidates).toContainEqual({
      id: "img_001",
      url: "https://example.com/cover.jpg",
      alt: "Tomato pasta cover",
      position: 0,
    });
  });

  it("JSON-LD Recipeをstructured evidenceとして抽出する", async () => {
    const conversion = await convertRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Tomato pasta",
              "recipeYield": "2 servings",
              "image": "/jsonld.jpg",
              "recipeIngredient": ["Tomato 1 can", "Olive oil 1 tbsp"],
              "recipeInstructions": [
                {
                  "@type": "HowToStep",
                  "text": "Simmer the tomato sauce.",
                  "image": "/step-1.jpg"
                },
                {
                  "@type": "HowToStep",
                  "name": "Toss with pasta.",
                  "image": ["/step-2a.jpg", { "url": "/step-2b.jpg" }]
                }
              ]
            }
          </script>
        </head>
        <body><main><h1>Tomato pasta</h1><p>Enough visible recipe content for extraction.</p></main></body>
      </html>
    `);

    expect(conversion.input.recipeStructuredEvidence).toEqual([
      {
        format: "jsonLd",
        name: "Tomato pasta",
        servingsText: "2 servings",
        imageIds: ["img_001"],
        rawIngredients: ["Tomato 1 can", "Olive oil 1 tbsp"],
        rawInstructions: ["Simmer the tomato sauce.", "Toss with pasta."],
        structuredInstructions: [
          {
            text: "Simmer the tomato sauce.",
            imageIds: ["img_002"],
          },
          {
            text: "Toss with pasta.",
            imageIds: ["img_003", "img_004"],
          },
        ],
      },
    ]);
  });

  it("JSON-LD Recipeのsection/list配下の手順画像をstructured evidenceとして抽出する", async () => {
    const conversion = await convertRecipeHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Layered pasta",
              "recipeIngredient": ["Pasta 100g"],
              "recipeInstructions": [
                {
                  "@type": "HowToSection",
                  "name": "Sauce",
                  "itemListElement": [
                    {
                      "@type": "HowToStep",
                      "text": "Warm the sauce.",
                      "image": { "url": "/section-step.jpg" }
                    }
                  ]
                },
                {
                  "@type": "ItemList",
                  "steps": [
                    {
                      "@type": "HowToStep",
                      "name": "Serve with pasta.",
                      "image": "/item-list-step.jpg"
                    }
                  ]
                }
              ]
            }
          </script>
        </head>
        <body><main><h1>Layered pasta</h1><p>Enough visible recipe content for extraction.</p></main></body>
      </html>
    `);

    expect(conversion.input.recipeStructuredEvidence).toEqual([
      {
        format: "jsonLd",
        name: "Layered pasta",
        servingsText: undefined,
        imageIds: [],
        rawIngredients: ["Pasta 100g"],
        rawInstructions: ["Warm the sauce.", "Serve with pasta."],
        structuredInstructions: [
          {
            text: "Warm the sauce.",
            imageIds: ["img_001"],
          },
          {
            text: "Serve with pasta.",
            imageIds: ["img_002"],
          },
        ],
      },
    ]);
  });

  it("Microdata RecipeをRecipe scope内だけから抽出する", async () => {
    const conversion = await convertRecipeHtml(`
      <html>
        <body>
          <span itemprop="recipeIngredient">Scope outside ingredient</span>
          <article itemscope itemtype="https://schema.org/Recipe">
            <h1 itemprop="name headline">Miso soup</h1>
            <meta itemprop="recipeYield" content="2 bowls">
            <meta itemprop="image" content="/miso.jpg">
            <ul>
              <li itemprop="recipeIngredient">Miso 2 tbsp</li>
              <li itemprop="recipeIngredient">Tofu 150g</li>
            </ul>
            <ol>
              <li itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToStep">
                <span itemprop="text">Warm the broth.</span>
              </li>
              <li itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToStep">
                <span itemprop="name">Dissolve the miso.</span>
              </li>
            </ol>
            <p>Enough visible recipe content for extraction and import conversion.</p>
          </article>
        </body>
      </html>
    `);

    expect(conversion.input.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Miso soup",
      servingsText: "2 bowls",
      imageIds: ["img_001"],
      rawIngredients: ["Miso 2 tbsp", "Tofu 150g"],
      rawInstructions: ["Warm the broth.", "Dissolve the miso."],
      structuredInstructions: [],
    });
    expect(JSON.stringify(conversion.input.recipeStructuredEvidence)).not.toContain(
      "Scope outside ingredient",
    );
  });

  it("同じMicrodata Recipe要素のtext propertyをRecipe evidenceへ反映する", async () => {
    const conversion = await convertRecipeHtml(`
      <html>
        <head>
          <meta
            name="description"
            content="Recipe page with enough metadata for import conversion."
          >
        </head>
        <body>
          <article
            itemscope
            itemtype="https://schema.org/Recipe"
            itemprop="recipeIngredient"
          >
            <meta itemprop="name" content="Same node soup">
            Same-node ingredient text for extraction and import conversion.
          </article>
        </body>
      </html>
    `);

    expect(conversion.input.recipeStructuredEvidence).toContainEqual({
      format: "microdata",
      name: "Same node soup",
      imageIds: [],
      rawIngredients: ["Same-node ingredient text for extraction and import conversion."],
      rawInstructions: [],
      structuredInstructions: [],
      servingsText: undefined,
    });
  });

  it("RDFa Recipeをschema.org表記揺れ込みで抽出する", async () => {
    const conversion = await convertRecipeHtml(`
      <html>
        <body vocab="https://schema.org/">
          <span property="recipeIngredient">Scope outside ingredient</span>
          <article typeof="schema:Recipe">
            <h1 property="schema:name headline">Rice bowl</h1>
            <meta property="https://schema.org/recipeYield" content="1 serving">
            <img property="schema:image" src="/rice.jpg" alt="Rice bowl">
            <p property="schema:recipeIngredient">Rice 200g</p>
            <p property="schema:recipeIngredient">Egg 1</p>
            <ol>
              <li property="schema:recipeInstructions">
                Steam the rice.
              </li>
              <li property="schema:recipeInstructions">
                Add the egg.
              </li>
            </ol>
            <p>Enough visible recipe content for extraction and import conversion.</p>
          </article>
        </body>
      </html>
    `);

    expect(conversion.input.recipeStructuredEvidence).toContainEqual({
      format: "rdfa",
      name: "Rice bowl",
      servingsText: "1 serving",
      imageIds: ["img_001"],
      rawIngredients: ["Rice 200g", "Egg 1"],
      rawInstructions: ["Steam the rice.", "Add the egg."],
      structuredInstructions: [],
    });
    expect(JSON.stringify(conversion.input.recipeStructuredEvidence)).not.toContain(
      "Scope outside ingredient",
    );
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
              coverImage: {
                type: "imageId",
                id: "img_001",
              },
              ingredientGroups: [{ ingredients: [{ name: "Flour", amount: "100g" }] }],
              steps: [{ text: "Mix and bake.", images: [] }],
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
                  images: [{ type: "imageId", id: "img_001" }],
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
              coverImage: { type: "imageId", id: "img_999" },
              ingredientGroups: [],
              steps: [
                {
                  text: "Serve.",
                  images: [{ type: "imageId", id: "img_001" }],
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

const convertRecipeHtml = async (body: string) => {
  const conversion = await genericHtmlImportConverter.convert({
    finalUrl: "https://example.com/recipes/test",
    contentType: "text/html",
    body,
  });

  if (conversion.type !== "requiresAi") {
    throw new Error(`Expected requiresAi conversion, received ${conversion.type}`);
  }

  return conversion;
};

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
