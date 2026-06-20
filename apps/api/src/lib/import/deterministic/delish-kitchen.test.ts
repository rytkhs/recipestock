import { describe, expect, it, vi } from "vitest";
import { importRecipeFromUrl } from "../../../import-url";
import { type UsageRepository } from "../../../usage";
import { type RecipeImportError } from "../types";
import { delishKitchenImportAdapter } from "./delish-kitchen";

const RECIPE_ID = "176147753863217510";
const RECIPE_URL = `https://delishkitchen.tv/recipes/${RECIPE_ID}`;
const COVER_IMAGE_URL = `https://image.delishkitchen.tv/recipe/${RECIPE_ID}/1.jpg?w=920`;
const STEP_IMAGE_URL = `https://media.delishkitchen.tv/recipe/${RECIPE_ID}/steps/1.jpg`;

describe("delishKitchenImportAdapter", () => {
  it.each([
    `https://delishkitchen.tv/recipes/${RECIPE_ID}`,
    `http://delishkitchen.tv/recipes/${RECIPE_ID}`,
    `https://www.delishkitchen.tv/recipes/${RECIPE_ID}/`,
    `https://delishkitchen.tv/recipes/${RECIPE_ID}?utm_source=share#step-video-1`,
  ])("%s をcanonical recipe URLの1ページ取得へ正規化する", (normalizedUrl) => {
    const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");

    expect(delishKitchenImportAdapter.match({ normalizedUrl, host })).toBe(true);
    expect(delishKitchenImportAdapter.resolveFetchRequests({ normalizedUrl, host })).toEqual([
      { id: "recipe", url: RECIPE_URL },
    ]);
  });

  it.each([
    "1",
    "123456789012345678",
    "123456789012345678901234567890",
  ])("数字の桁数に依存せずrecipe ID %sにmatchする", (recipeId) => {
    const normalizedUrl = `https://delishkitchen.tv/recipes/${recipeId}`;
    const host = new URL(normalizedUrl).hostname;

    expect(delishKitchenImportAdapter.match({ normalizedUrl, host })).toBe(true);
    expect(delishKitchenImportAdapter.resolveFetchRequests({ normalizedUrl, host })).toEqual([
      {
        id: "recipe",
        url: `https://delishkitchen.tv/recipes/${recipeId}`,
      },
    ]);
  });

  it("レシピ以外、非数字ID、追加pathname、非公式hostにはmatchしない", () => {
    for (const normalizedUrl of [
      "https://delishkitchen.tv/search?q=牛丼",
      "https://delishkitchen.tv/categories/19878",
      "https://delishkitchen.tv/articles/2800",
      `https://biz.delishkitchen.tv/recipes/${RECIPE_ID}`,
      `https://www.delishkitchen.tv.evil.example/recipes/${RECIPE_ID}`,
      "https://delishkitchen.tv/recipes/recipe-name",
      `${RECIPE_URL}/print`,
    ]) {
      expect(
        delishKitchenImportAdapter.match({
          normalizedUrl,
          host: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
        }),
      ).toBe(false);
    }
  });

  it.each([
    `https://user@delishkitchen.tv/recipes/${RECIPE_ID}`,
    `https://user:password@delishkitchen.tv/recipes/${RECIPE_ID}`,
    `https://delishkitchen.tv:8443/recipes/${RECIPE_ID}`,
  ])("userinfoまたは非標準portを含むURL %sにはmatchしない", (normalizedUrl) => {
    expect(
      delishKitchenImportAdapter.match({
        normalizedUrl,
        host: new URL(normalizedUrl).hostname,
      }),
    ).toBe(false);
  });

  it("表示本文とRecipe JSON-LDを合成してRecipeDraftContentへ変換する", async () => {
    const result = await importDelishKitchen();

    expect(result).toEqual({
      recipeDraftContent: {
        title: "人気の定番メニュー！ 基本の牛丼",
        servingsText: "2人分",
        coverImage: {
          type: "externalImageUrl",
          url: COVER_IMAGE_URL,
        },
        ingredientGroups: [
          {
            ingredients: [{ name: "あたたかいごはん", amount: "どんぶり2杯(400g)" }],
          },
          {
            label: "☆調味料",
            ingredients: [
              { name: "しょうゆ", amount: "大さじ2" },
              { name: "砂糖", amount: "小さじ2" },
            ],
          },
        ],
        steps: [
          {
            text: "玉ねぎを切る。\n\nポイント: 加熱する直前に切りましょう。",
            images: [
              {
                type: "externalImageUrl",
                url: STEP_IMAGE_URL,
              },
            ],
          },
          {
            text: "鍋で煮る。",
            images: [],
          },
        ],
        note: "注意事項:\n調理中は火元を離れないでください。\n高温になったら火を止めます。",
      },
      source: {
        sourceUrl: RECIPE_URL,
        sourceName: "デリッシュキッチン",
      },
      warnings: [],
    });
  });

  it("SEO向けJSON-LD名と表示タイトルが異なっても成功する", async () => {
    const result = await importDelishKitchen({
      jsonLdName: "自宅で作る！牛丼の王道レシピ",
    });

    expect(result.recipeDraftContent.title).toBe("人気の定番メニュー！ 基本の牛丼");
  });

  it("servingsTextは表示本文を正としてJSON-LDが空でも抽出する", async () => {
    const result = await importDelishKitchen({
      jsonLdServingsText: "",
    });

    expect(result.recipeDraftContent.servingsText).toBe("2人分");
  });

  it("表示本文に分量がなければJSON-LDだけに存在してもservingsTextを省略する", async () => {
    const result = await importDelishKitchen({
      htmlServingsText: "",
    });

    expect(result.recipeDraftContent).not.toHaveProperty("servingsText");
  });

  it("画像、ポイント、注意事項がなくても成功する", async () => {
    const result = await importDelishKitchen({
      coverImage: false,
      stepImages: false,
      points: [],
      attentionItems: [],
    });

    expect(result.recipeDraftContent).not.toHaveProperty("coverImage");
    expect(result.recipeDraftContent).not.toHaveProperty("note");
    expect(result.recipeDraftContent.steps).toEqual([
      { text: "玉ねぎを切る。", images: [] },
      { text: "鍋で煮る。", images: [] },
    ]);
  });

  it("制限付きで手順が取得できない場合は材料だけを部分取り込みする", async () => {
    const result = await importDelishKitchen({
      restricted: true,
      stepTexts: [],
      jsonLdStepTexts: [],
    });

    expect(result).toEqual({
      recipeDraftContent: {
        title: "人気の定番メニュー！ 基本の牛丼",
        servingsText: "2人分",
        coverImage: {
          type: "externalImageUrl",
          url: COVER_IMAGE_URL,
        },
        ingredientGroups: [
          {
            ingredients: [{ name: "あたたかいごはん", amount: "どんぶり2杯(400g)" }],
          },
          {
            label: "☆調味料",
            ingredients: [
              { name: "しょうゆ", amount: "大さじ2" },
              { name: "砂糖", amount: "小さじ2" },
            ],
          },
        ],
        steps: [],
        note: [
          "デリッシュキッチンの制限付きレシピのため、手順は取り込まれていません。",
          "",
          "注意事項:",
          "調理中は火元を離れないでください。",
          "高温になったら火を止めます。",
        ].join("\n"),
      },
      source: {
        sourceUrl: RECIPE_URL,
        sourceName: "デリッシュキッチン",
      },
      warnings: [],
    });
  });

  it("制限表示があっても手順を取得できる場合は完全取り込みする", async () => {
    const result = await importDelishKitchen({ restricted: true });

    expect(result.recipeDraftContent.steps).toHaveLength(2);
    expect(result.recipeDraftContent.note).toBe(
      "注意事項:\n調理中は火元を離れないでください。\n高温になったら火を止めます。",
    );
  });

  it("制限付きでも材料がJSON-LDと一致しない場合は失敗する", async () => {
    await expect(
      importDelishKitchen({
        restricted: true,
        stepTexts: [],
        jsonLdStepTexts: [],
        jsonLdIngredients: ["あたたかいごはん 1杯"],
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it.each([
    {
      name: "final URLのrecipe ID",
      finalUrl: "https://delishkitchen.tv/recipes/999999999999999999",
    },
    {
      name: "canonical URL",
      canonicalUrl: "https://delishkitchen.tv/recipes/999999999999999999",
    },
    {
      name: "JSON-LD mainEntityOfPage",
      jsonLdCanonicalUrl: "https://delishkitchen.tv/recipes/999999999999999999",
    },
    {
      name: "材料内容",
      jsonLdIngredients: ["あたたかいごはん 1杯", "しょうゆ 大さじ2", "砂糖 小さじ2"],
    },
    {
      name: "材料順序",
      jsonLdIngredients: ["しょうゆ 大さじ2", "あたたかいごはん どんぶり2杯(400g)", "砂糖 小さじ2"],
    },
    {
      name: "手順本文",
      jsonLdStepTexts: ["玉ねぎを薄切りにする。", "鍋で煮る。"],
    },
    {
      name: "手順数",
      jsonLdStepTexts: ["玉ねぎを切る。"],
    },
    {
      name: "分量",
      jsonLdServingsText: "4人分",
    },
  ])("$nameが一致しない場合は失敗する", async ({ name: _name, ...options }) => {
    await expect(importDelishKitchen(options)).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it.each([
    {
      name: "Recipe JSON-LDがない",
      options: { includeJsonLd: false },
    },
    {
      name: "同じRecipe JSON-LDが複数ある",
      options: { duplicateJsonLd: true },
    },
    {
      name: "HTML材料がない",
      options: { ingredients: [] },
    },
    {
      name: "HTML手順がない",
      options: { stepTexts: [] },
    },
  ])("$nameの場合は失敗する", async ({ options }) => {
    await expect(importDelishKitchen(options)).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("成功時はAI providerとAI usageを使わない", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: RECIPE_URL,
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepositoryStub(consumeAiUsage),
        fetcher: async (url) => createFetchedPage(url, createDelishKitchenHtml()),
        aiProvider: { normalize: aiNormalize },
      }),
    ).resolves.toMatchObject({
      source: {
        sourceUrl: RECIPE_URL,
        sourceName: "デリッシュキッチン",
      },
    });

    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });

  it("制限付きの部分取り込み時もAI providerとAI usageを使わない", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: RECIPE_URL,
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepositoryStub(consumeAiUsage),
        fetcher: async (url) =>
          createFetchedPage(
            url,
            createDelishKitchenHtml({
              restricted: true,
              stepTexts: [],
              jsonLdStepTexts: [],
            }),
          ),
        aiProvider: { normalize: aiNormalize },
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        steps: [],
      },
    });

    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });

  it("match後の抽出失敗時はAIへfallbackしない", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: RECIPE_URL,
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepositoryStub(consumeAiUsage),
        fetcher: async (url) =>
          createFetchedPage(url, createDelishKitchenHtml({ stepTexts: [], jsonLdStepTexts: [] })),
        aiProvider: { normalize: aiNormalize },
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });
});

type FixtureOptions = {
  finalUrl?: string;
  canonicalUrl?: string;
  jsonLdCanonicalUrl?: string;
  jsonLdName?: string;
  ingredients?: Array<{ group?: string; name?: string; amount?: string }>;
  jsonLdIngredients?: string[];
  stepTexts?: string[];
  jsonLdStepTexts?: string[];
  points?: Array<string | undefined>;
  attentionItems?: string[];
  htmlServingsText?: string;
  jsonLdServingsText?: string;
  coverImage?: boolean;
  stepImages?: boolean;
  includeJsonLd?: boolean;
  duplicateJsonLd?: boolean;
  restricted?: boolean;
};

const DEFAULT_INGREDIENTS = [
  { name: "あたたかいごはん", amount: "どんぶり2杯(400g)" },
  { group: "☆調味料" },
  { name: "しょうゆ", amount: "大さじ2" },
  { name: "砂糖", amount: "小さじ2" },
];
const DEFAULT_JSON_LD_INGREDIENTS = [
  "あたたかいごはん どんぶり2杯(400g)",
  "しょうゆ 大さじ2",
  "砂糖 小さじ2",
];
const DEFAULT_STEP_TEXTS = ["玉ねぎを切る。", "鍋で煮る。"];

const importDelishKitchen = (options: FixtureOptions = {}) =>
  delishKitchenImportAdapter.convert({
    normalizedUrl: RECIPE_URL,
    pages: new Map([
      [
        "recipe",
        createFetchedPage(options.finalUrl ?? RECIPE_URL, createDelishKitchenHtml(options)),
      ],
    ]),
  });

const createFetchedPage = (url: string, body: string) => ({
  finalUrl: url,
  contentType: "text/html; charset=utf-8",
  body,
});

const createDelishKitchenHtml = ({
  canonicalUrl = RECIPE_URL,
  jsonLdCanonicalUrl = RECIPE_URL,
  jsonLdName = "自宅で作る！牛丼の王道レシピ",
  ingredients = DEFAULT_INGREDIENTS,
  jsonLdIngredients = DEFAULT_JSON_LD_INGREDIENTS,
  stepTexts = DEFAULT_STEP_TEXTS,
  jsonLdStepTexts = stepTexts,
  points = ["加熱する直前に切りましょう。"],
  attentionItems = ["調理中は火元を離れないでください。", "高温になったら火を止めます。"],
  htmlServingsText = "2人分",
  jsonLdServingsText = "2人分",
  coverImage = true,
  stepImages = true,
  includeJsonLd = true,
  duplicateJsonLd = false,
  restricted = false,
}: FixtureOptions = {}) => {
  const recipeJsonLd = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: jsonLdName,
    recipeYield: jsonLdServingsText,
    recipeIngredient: jsonLdIngredients,
    recipeInstructions: jsonLdStepTexts.map((text, index) => ({
      "@type": "HowToStep",
      text,
      ...(stepImages && index === 0 ? { image: STEP_IMAGE_URL } : {}),
    })),
    ...(coverImage ? { image: COVER_IMAGE_URL } : {}),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": jsonLdCanonicalUrl,
    },
  };
  const jsonLdScript = `<script type="application/ld+json">${JSON.stringify(
    recipeJsonLd,
  )}</script>`;

  return `
    <html>
      <head>
        <link rel="canonical" href="${canonicalUrl}">
        ${includeJsonLd ? jsonLdScript : ""}
        ${includeJsonLd && duplicateJsonLd ? jsonLdScript : ""}
      </head>
      <body>
        <main class="recipe-content__main">
          ${
            restricted
              ? '<div class="premium-service-section">こちらはプレミアムサービスのレシピです。</div>'
              : ""
          }
          <div class="title-box">
            <h1>
              <span class="lead">人気の定番メニュー！</span>
              <span class="title">基本の牛丼</span>
            </h1>
          </div>
        </main>
        <div class="delish-recipe-ingredients">
          <h2>
            <span class="recipe-serving">
              材料
              ${htmlServingsText ? `<span>【${htmlServingsText}】</span>` : ""}
            </span>
          </h2>
          <ul class="ingredient-list">
            ${ingredients
              .map((ingredient) =>
                ingredient.group
                  ? `<li class="ingredient-group__header">${ingredient.group}</li>`
                  : `
                    <li class="ingredient">
                      <span class="ingredient-name">${ingredient.name}</span>
                      <span class="ingredient-serving">${ingredient.amount}</span>
                    </li>
                  `,
              )
              .join("")}
          </ul>
        </div>
        <div class="delish-recipe-steps">
          <ol class="steps">
            ${stepTexts
              .map(
                (text, index) => `
                  <li class="step">
                    <div class="step-text-wrap">
                      <p class="step-desc">${text}</p>
                      ${
                        points[index]
                          ? `<div class="point-wrap"><p class="point">${points[index]}</p></div>`
                          : ""
                      }
                    </div>
                  </li>
                `,
              )
              .join("")}
          </ol>
        </div>
        ${
          attentionItems.length > 0
            ? `
              <div class="delish-recipe-attention">
                <div class="attention-item-wrap">
                  ${attentionItems.map((item) => `<p>${item}</p>`).join("")}
                </div>
              </div>
            `
            : ""
        }
      </body>
    </html>
  `;
};

const createUsageRepositoryStub = (
  consumeAiUsage = vi.fn(async ({ month }: { month: string }) => ({
    status: "consumed" as const,
    usage: { month, used: 1 },
  })),
): UsageRepository => ({
  async getOrCreateAppUser(userId) {
    return { userId, plan: "free" };
  },
  async getAiUsage(_userId, month) {
    return { month, used: 0 };
  },
  consumeAiUsage,
});
