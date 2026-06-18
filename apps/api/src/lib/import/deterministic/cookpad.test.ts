import { describe, expect, it, vi } from "vitest";
import { importRecipeFromUrl, type RecipeImportError } from "../../../import-url";
import { type UsageRepository } from "../../../usage";
import { cookpadImportAdapter } from "./cookpad";

describe("cookpadImportAdapter", () => {
  it.each([
    [
      "https://cookpad.com/jp/recipes/25877246?from=share#steps",
      "https://cookpad.com/jp/recipes/25877246/print",
    ],
    [
      "https://cookpad.com/jp/recipes/25877246/print",
      "https://cookpad.com/jp/recipes/25877246/print",
    ],
    [
      "https://www.cookpad.com/jp/recipes/25877246",
      "https://cookpad.com/jp/recipes/25877246/print",
    ],
  ])("%s の取得先を %s にする", (normalizedUrl, expected) => {
    const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");
    expect(cookpadImportAdapter.match({ normalizedUrl, host })).toBe(true);
    expect(cookpadImportAdapter.resolveFetchUrl?.({ normalizedUrl, host })).toBe(expected);
  });

  it("旧形式やレシピ以外のCookpad URLにはmatchしない", () => {
    for (const normalizedUrl of [
      "https://cookpad.com/recipe/25877246",
      "https://cookpad.com/jp/search/tomato",
      "https://example.com/jp/recipes/25877246",
    ]) {
      expect(
        cookpadImportAdapter.match({
          normalizedUrl,
          host: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
        }),
      ).toBe(false);
    }
  });

  it("print DOMからRecipeDraftContentを決定的に抽出する", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();
    const fetchedUrls: string[] = [];

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://www.cookpad.com/jp/recipes/25877246?utm_source=share#steps",
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepositoryStub(consumeAiUsage),
        fetcher: async (url) => {
          fetchedUrls.push(url);
          return {
            finalUrl: url,
            contentType: "text/html; charset=utf-8",
            body: createCookpadPrintHtml(),
          };
        },
        aiProvider: { normalize: aiNormalize },
      }),
    ).resolves.toEqual({
      recipeDraftContent: {
        title: "夏！ささみのバンバンジー冷やし麺簡単タレ",
        servingsText: "2人分",
        coverImage: {
          type: "externalImageUrl",
          url: "https://img.example/cover.jpg",
        },
        ingredientGroups: [
          {
            ingredients: [
              { name: "中華麺", amount: "2袋" },
              { name: "△塩", amount: "1g" },
            ],
          },
          {
            label: "バンバンジータレ",
            ingredients: [{ name: "◎白すりごま", amount: "20g" }],
          },
        ],
        steps: [
          {
            text: "材料を用意する。",
            images: [
              {
                type: "externalImageUrl",
                url: "https://cookpad.com/images/step-1.jpg",
              },
            ],
          },
          {
            text: "盛り付ける。",
            images: [],
          },
        ],
        note: "水気をしっかり切ります。",
      },
      source: {
        sourceUrl: "https://cookpad.com/jp/recipes/25877246",
        sourceName: "クックパッド",
      },
      warnings: [],
    });

    expect(fetchedUrls).toEqual(["https://cookpad.com/jp/recipes/25877246/print"]);
    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });

  it("分量・コツ・画像がなくても抽出できる", async () => {
    await expect(
      importRecipeFromUrl({
        rawUrl: "https://cookpad.com/jp/recipes/17952999",
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepositoryStub(),
        fetcher: async (url) => ({
          finalUrl: url,
          contentType: "text/html",
          body: createCookpadPrintHtml({
            servings: "",
            note: "",
            coverImage: "",
            stepImage: "",
          }),
        }),
      }),
    ).resolves.toMatchObject({
      recipeDraftContent: {
        title: "夏！ささみのバンバンジー冷やし麺簡単タレ",
        ingredientGroups: expect.any(Array),
        steps: expect.any(Array),
      },
      source: {
        sourceUrl: "https://cookpad.com/jp/recipes/17952999",
      },
    });
  });

  it("必須DOMが欠落した場合はAI fallbackしない", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: "https://cookpad.com/jp/recipes/25877246",
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepositoryStub(consumeAiUsage),
        fetcher: async (url) => ({
          finalUrl: url,
          contentType: "text/html",
          body: '<html><body><div id="recipe-print"></div></body></html>',
        }),
        aiProvider: { normalize: aiNormalize },
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });
});

const createCookpadPrintHtml = ({
  servings = '<span class="mise-icon-text">2人分</span>',
  note = `
    <div class="mb-rg">
      <div>コツ・ポイント</div>
      <div><p>水気をしっかり切ります。</p></div>
    </div>
  `,
  coverImage = '<img class="w-full aspect-square rounded-lg" src="https://img.example/cover.jpg">',
  stepImage = '<img src="/images/step-1.jpg">',
}: {
  servings?: string;
  note?: string;
  coverImage?: string;
  stepImage?: string;
} = {}) => `
  <html>
    <body>
      <div id="recipe-print">
        <header>
          <span dir="auto">夏！ささみのバンバンジー冷やし麺簡単タレ</span>
        </header>
        <div class="grid">
          <div>
            ${coverImage}
            <div>
              <span>材料</span>
              ${servings}
              <ol dir="auto">
                <li class="justified-quantity-and-name not-headline">
                  <span>中華麺</span><bdi>2袋</bdi>
                </li>
                <li class="justified-quantity-and-name not-headline">
                  <span>△塩</span><bdi>1g</bdi>
                </li>
                <li class="justified-quantity-and-name headline">
                  <span>■バンバンジータレ</span><bdi></bdi>
                </li>
                <li class="justified-quantity-and-name not-headline">
                  <span>◎白すりごま</span><bdi>20g</bdi>
                </li>
              </ol>
            </div>
          </div>
          <div>
            ${note}
            <div>
              <span>作り方</span>
              <ol class="grid">
                <li>
                  <div>1.</div>
                  <div><p>材料を用意する。</p>${stepImage}</div>
                </li>
                <li>
                  <div>2.</div>
                  <div><p>盛り付ける。</p></div>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </body>
  </html>
`;

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
