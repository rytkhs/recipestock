import { describe, expect, it, vi } from "vitest";
import {
  importRecipeFromUrl,
  type RecipeImportAIProvider,
  type RecipeImportError,
} from "../../../import-url";
import { type UsageRepository } from "../../../usage";
import { kurashiruImportAdapter } from "./kurashiru";

const RECIPE_ID = "ea9e1038-d78a-468b-b08e-7456fc3fd038";
const RECIPE_URL = `https://www.kurashiru.com/recipes/${RECIPE_ID}`;
const COVER_IMAGE_URL = `https://video.kurashiru.com/production/videos/${RECIPE_ID}/compressed_thumbnail_square_large.jpg?123`;

describe("kurashiruImportAdapter", () => {
  it.each([
    RECIPE_URL,
    `https://www.kurashiru.com/recipes/${RECIPE_ID}/`,
    `https://www.kurashiru.com/recipes/${RECIPE_ID}/print`,
    `http://kurashiru.com/recipes/${RECIPE_ID}`,
    `https://www.kurashiru.com/recipes/${RECIPE_ID.toUpperCase()}?utm_source=share#steps`,
  ])("%s をcanonical recipe URLの1ページ取得へ正規化する", (normalizedUrl) => {
    const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");

    expect(kurashiruImportAdapter.match({ normalizedUrl, host })).toBe(true);
    expect(kurashiruImportAdapter.resolveFetchRequests({ normalizedUrl, host })).toEqual([
      { id: "recipe", url: RECIPE_URL },
    ]);
  });

  it("レシピ以外、不正UUID、未知suffix、非公式hostにはmatchしない", () => {
    for (const normalizedUrl of [
      "https://www.kurashiru.com/recipes",
      "https://www.kurashiru.com/recipes/not-a-uuid",
      `${RECIPE_URL}/extra`,
      `https://www.kurashiru.com/recipe_cards/${RECIPE_ID}`,
      `https://search.kurashiru.com/recipes/${RECIPE_ID}`,
      `https://www.kurashiru.com.evil.example/recipes/${RECIPE_ID}`,
    ]) {
      expect(
        kurashiruImportAdapter.match({
          normalizedUrl,
          host: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
        }),
      ).toBe(false);
    }
  });

  it.each([
    `https://user@www.kurashiru.com/recipes/${RECIPE_ID}`,
    `https://user:password@www.kurashiru.com/recipes/${RECIPE_ID}`,
    `https://www.kurashiru.com:8443/recipes/${RECIPE_ID}`,
  ])("userinfoまたは非標準portを含むURL %sにはmatchしない", (normalizedUrl) => {
    expect(
      kurashiruImportAdapter.match({
        normalizedUrl,
        host: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
      }),
    ).toBe(false);
  });

  it("SSR状態からRecipeDraftContentへ変換する", async () => {
    const result = await importKurashiru();

    expect(result).toEqual({
      recipeDraftContent: {
        title: "お弁当の定番 卵焼き",
        yieldText: "2人前",
        coverImage: {
          type: "externalImageUrl",
          url: COVER_IMAGE_URL,
        },
        sourceMedia: [],
        ingredientGroups: [
          {
            ingredients: [{ name: "卵", amount: "2個" }],
          },
          {
            label: "(A)",
            ingredients: [
              { name: "砂糖", amount: "小さじ1" },
              { name: "塩", amount: "少々" },
            ],
          },
          {
            ingredients: [{ name: "サラダ油", amount: "適量" }],
          },
          {
            label: "トッピング",
            ingredients: [{ name: "大葉", amount: "1枚" }],
          },
        ],
        steps: [
          {
            text: "卵を溶きほぐします。\n調味料を加えます。\n\nポイント: 白身を切るように混ぜます。",
            images: [],
          },
          {
            text: "卵焼き器で焼きます。",
            images: [],
          },
        ],
        note: [
          "コツ・ポイント",
          "半熟の状態で巻いてください。",
          "",
          "材料のポイント",
          "- 卵: Mサイズを使用しています。",
        ].join("\n"),
      },
      source: {
        sourceUrl: RECIPE_URL,
        sourceName: "クラシル",
      },
      warnings: [],
    });
  });

  it.each([
    {
      name: "JSON-LDがない",
      html: createKurashiruHtml({ includeJsonLd: false }),
    },
    {
      name: "JSON-LDが不正",
      html: createKurashiruHtml({ jsonLdDocument: "{" }),
    },
    {
      name: "JSON-LDが@graph",
      html: createKurashiruHtml({
        jsonLdDocument: JSON.stringify({
          "@graph": [
            { "@type": "BreadcrumbList" },
            {
              "@type": "Recipe",
              mainEntityOfPage: { "@id": RECIPE_URL },
              image: "https://example.com/graph.jpg",
            },
          ],
        }),
      }),
    },
  ])("$nameでもSSR状態から取り込む", async ({ html }) => {
    await expect(importKurashiru({ html })).resolves.toMatchObject({
      recipeDraftContent: {
        title: "お弁当の定番 卵焼き",
      },
      warnings: [],
    });
  });

  it("large thumbnailがなければOG imageを使用する", async () => {
    const result = await importKurashiru({
      html: createKurashiruHtml({
        attributeOverrides: {
          "thumbnail-square-large-url": null,
          "thumbnail-square-normal-url": "https://example.com/normal.jpg",
        },
      }),
    });

    expect(result.recipeDraftContent.coverImage).toEqual({
      type: "externalImageUrl",
      url: "https://example.com/og.jpg",
    });
  });

  it("既知keyがなくても同一IDのvideosデータを一意に特定する", async () => {
    const result = await importKurashiru({
      html: createKurashiruHtml({ ssrKey: "/wapi/changed/path" }),
    });

    expect(result.recipeDraftContent.title).toBe("お弁当の定番 卵焼き");
  });

  it.each([
    {
      name: "final URL",
      finalUrl: "https://www.kurashiru.com/recipes/6c656bdf-d8c9-427a-b669-f6e1d9f81fcd",
    },
    {
      name: "canonical URL",
      html: createKurashiruHtml({
        canonicalUrl: "https://www.kurashiru.com/recipes/6c656bdf-d8c9-427a-b669-f6e1d9f81fcd",
      }),
    },
    {
      name: "SSR ID",
      html: createKurashiruHtml({
        dataId: "6c656bdf-d8c9-427a-b669-f6e1d9f81fcd",
      }),
    },
    {
      name: "JSON-LD mainEntityOfPage",
      html: createKurashiruHtml({
        jsonLdRecipeId: "6c656bdf-d8c9-427a-b669-f6e1d9f81fcd",
      }),
    },
  ])("$nameが要求recipeと一致しなければ失敗する", async ({ name: _name, ...options }) => {
    await expect(importKurashiru(options)).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it.each([
    {
      name: "SSR JSONがない",
      html: createKurashiruHtml({ environmentScript: "window.otherEnvironment = {};" }),
    },
    {
      name: "SSR JSONが壊れている",
      html: createKurashiruHtml({
        environmentScript: "Object.assign(window.__delyKurashiruEnvironment, { broken: true );",
      }),
    },
    {
      name: "titleが空",
      html: createKurashiruHtml({ attributeOverrides: { title: "" } }),
    },
    {
      name: "材料がない",
      html: createKurashiruHtml({ attributeOverrides: { ingredients: [] } }),
    },
    {
      name: "手順がない",
      html: createKurashiruHtml({ attributeOverrides: { instructions: [] } }),
    },
    {
      name: "非公開",
      html: createKurashiruHtml({
        attributeOverrides: { "publish-status": "draft" },
      }),
    },
    {
      name: "未知content-type",
      html: createKurashiruHtml({
        attributeOverrides: { "content-type": "premium" },
      }),
    },
  ])("$nameの場合は失敗する", async ({ html }) => {
    await expect(importKurashiru({ html })).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("成功時はAI providerとAI usageを使わない", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();

    await expect(
      importKurashiru({
        aiNormalize,
        consumeAiUsage,
      }),
    ).resolves.toMatchObject({
      source: {
        sourceUrl: RECIPE_URL,
        sourceName: "クラシル",
      },
    });

    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });

  it("抽出失敗時もAI providerとAI usageを使わない", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();

    await expect(
      importKurashiru({
        html: createKurashiruHtml({ attributeOverrides: { title: "" } }),
        aiNormalize,
        consumeAiUsage,
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });
});

const importKurashiru = ({
  html = createKurashiruHtml(),
  finalUrl = RECIPE_URL,
  aiNormalize,
  consumeAiUsage,
}: {
  html?: string;
  finalUrl?: string;
  aiNormalize?: RecipeImportAIProvider["normalize"];
  consumeAiUsage?: UsageRepository["consumeAiUsage"];
} = {}) =>
  importRecipeFromUrl({
    rawUrl: RECIPE_URL,
    userId: "user_123",
    env: {},
    usageRepository: createUsageRepositoryStub(consumeAiUsage),
    fetcher: async () => createFetchedPage(finalUrl, html),
    ...(aiNormalize ? { aiProvider: { normalize: aiNormalize } } : {}),
  });

const createFetchedPage = (url: string, body: string) => ({
  finalUrl: url,
  contentType: "text/html; charset=utf-8",
  body,
});

const createKurashiruHtml = ({
  recipeId = RECIPE_ID,
  dataId = recipeId,
  ssrKey = `/wapi/videos/${recipeId}`,
  canonicalUrl = RECIPE_URL,
  includeJsonLd = true,
  jsonLdDocument,
  jsonLdRecipeId = RECIPE_ID,
  attributeOverrides = {},
  environmentScript,
}: {
  recipeId?: string;
  dataId?: string;
  ssrKey?: string;
  canonicalUrl?: string;
  includeJsonLd?: boolean;
  jsonLdDocument?: string;
  jsonLdRecipeId?: string;
  attributeOverrides?: Record<string, unknown>;
  environmentScript?: string;
} = {}) => {
  const attributes = {
    title: "お弁当の定番 卵焼き",
    "publish-status": "published",
    "content-type": "normal",
    servings: "2人前",
    introduction: "甘めの卵焼きです。",
    memo: "半熟の状態で巻いてください。",
    "thumbnail-square-large-url": COVER_IMAGE_URL,
    ingredients: [
      {
        id: 1,
        type: "ingredients",
        name: "卵",
        "actual-name": "卵",
        "group-id": null,
        "group-name": null,
        "quantity-amount": "2個",
      },
      {
        id: 2,
        type: "ingredients",
        name: "(A)砂糖",
        "actual-name": "砂糖",
        "group-id": null,
        "group-name": "(A)",
        "quantity-amount": "小さじ1",
      },
      {
        id: 3,
        type: "ingredients",
        name: "(A)塩",
        "actual-name": "塩",
        "group-id": null,
        "group-name": "(A)",
        "quantity-amount": "少々",
      },
      {
        id: 4,
        type: "heading",
        title: "つなぎ",
      },
      {
        id: 5,
        type: "ingredients",
        name: "サラダ油",
        "actual-name": "サラダ油",
        "group-id": null,
        "group-name": null,
        "quantity-amount": "適量",
      },
      {
        id: 6,
        type: "heading",
        title: "トッピング",
      },
      {
        id: 7,
        type: "ingredients",
        name: "大葉",
        "actual-name": "大葉",
        "group-id": 6,
        "group-name": "トッピング",
        "quantity-amount": "1枚",
      },
    ],
    instructions: [
      {
        id: 101,
        body: "卵を溶きほぐします。\r\n調味料を加えます。",
        "sort-order": 1,
      },
      {
        id: 102,
        body: "卵焼き器で焼きます。",
        "sort-order": 2,
      },
    ],
    points: [
      {
        type: "instructions",
        "instruction-id": 101,
        text: "白身を切るように混ぜます。",
      },
      {
        type: "ingredients",
        "ingredient-id": 1,
        text: "Mサイズを使用しています。",
      },
    ],
    ...attributeOverrides,
  };
  const state = {
    env: "production",
    ssrContext: {
      [ssrKey]: {
        data: {
          id: dataId,
          type: "videos",
          attributes,
        },
      },
    },
  };
  const resolvedJsonLdDocument =
    jsonLdDocument ??
    JSON.stringify({
      "@type": "Recipe",
      mainEntityOfPage: {
        "@id": `https://www.kurashiru.com/recipes/${jsonLdRecipeId}`,
      },
      image: "https://example.com/json-ld.jpg",
    });
  const resolvedEnvironmentScript =
    environmentScript ??
    `Object.assign(
      window.__delyKurashiruEnvironment,
      ${JSON.stringify(state)}
    );`;

  return `
    <html>
      <head>
        <link rel="canonical" href="${canonicalUrl}">
        <meta property="og:image" content="https://example.com/og.jpg">
        ${
          includeJsonLd
            ? `<script type="application/ld+json">${resolvedJsonLdDocument}</script>`
            : ""
        }
      </head>
      <body>
        <script>${resolvedEnvironmentScript}</script>
      </body>
    </html>
  `;
};

const createUsageRepositoryStub = (
  consumeAiUsage: UsageRepository["consumeAiUsage"] = vi.fn(
    async ({ month }: { month: string }) => ({
      status: "consumed" as const,
      usage: { month, used: 1 },
    }),
  ),
): UsageRepository => ({
  async getOrCreateAppUser(userId) {
    return { userId, plan: "free" };
  },
  async getAiUsage(_userId, month) {
    return { month, used: 0 };
  },
  consumeAiUsage,
});
