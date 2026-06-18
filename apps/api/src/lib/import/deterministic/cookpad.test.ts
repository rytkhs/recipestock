import { describe, expect, it, vi } from "vitest";
import { importRecipeFromUrl, type RecipeImportError } from "../../../import-url";
import { type UsageRepository } from "../../../usage";
import { cookpadImportAdapter } from "./cookpad";

const RECIPE_ID = "25844291";
const RECIPE_URL = `https://cookpad.com/jp/recipes/${RECIPE_ID}`;
const PRINT_URL = `${RECIPE_URL}/print`;
const TITLE = "簡単ノンフライヤーで揚げポテト（お弁当）";
const STEP_TEXTS = [
  "じゃがいもを切る。",
  "水にさらす。",
  "片栗粉をまぶす。",
  "オイルをかける。",
  "加熱する。",
  "盛り付ける。",
];
const STEP_IMAGE_IDS = [
  ["step-1-a", "step-1-b"],
  ["step-2-a"],
  ["step-3-a", "step-3-b"],
  ["step-4-a"],
  ["step-5-a", "step-5-b"],
  ["step-6-a", "step-6-b"],
];
const PREMIUM_RECIPE_ID = "25877246";
const PREMIUM_TITLE = "夏！ささみのバンバンジー冷やし麺簡単タレ";
const PREMIUM_STEP_TEXTS = [
  "材料。",
  "タレを混ぜて冷やす。",
  "ささみを下ごしらえする。",
  "ささみを加熱する。",
  "ささみをほぐす。",
  "きゅうりを切る。",
  "トマトを切る。",
  "麺を茹でる。",
  "麺を冷水でしめる。",
  "盛り付ける。",
  "使用した味噌。",
];
const PREMIUM_STEP_IMAGE_IDS = [
  ["premium-step-1"],
  ["premium-step-2"],
  ["premium-step-3"],
  ["premium-step-4"],
  ["premium-step-5"],
  ["premium-step-6"],
  [],
  [],
  [],
  ["premium-step-10"],
  ["premium-step-11"],
];

describe("cookpadImportAdapter", () => {
  it.each([
    `https://cookpad.com/jp/recipes/${RECIPE_ID}?from=share#steps`,
    PRINT_URL,
    `https://www.cookpad.com/jp/recipes/${RECIPE_ID}`,
  ])("%s を通常ページとprintページの取得へ正規化する", (normalizedUrl) => {
    const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");
    expect(cookpadImportAdapter.match({ normalizedUrl, host })).toBe(true);
    expect(cookpadImportAdapter.resolveFetchRequests({ normalizedUrl, host })).toEqual([
      { id: "print", url: PRINT_URL },
      { id: "recipe", url: RECIPE_URL },
    ]);
  });

  it("旧形式やレシピ以外のCookpad URLにはmatchしない", () => {
    for (const normalizedUrl of [
      `https://cookpad.com/recipe/${RECIPE_ID}`,
      "https://cookpad.com/jp/search/tomato",
      `https://example.com/jp/recipes/${RECIPE_ID}`,
    ]) {
      expect(
        cookpadImportAdapter.match({
          normalizedUrl,
          host: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
        }),
      ).toBe(false);
    }
  });

  it("2ページを並列取得してprintの本文と通常ページの全画像を合成する", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();
    const fetchedUrls: string[] = [];
    const resolvers = new Map<string, (value: ReturnType<typeof createFetchedPage>) => void>();
    const importPromise = importRecipeFromUrl({
      rawUrl: `https://www.cookpad.com/jp/recipes/${RECIPE_ID}?utm_source=share#steps`,
      userId: "user_123",
      env: {},
      usageRepository: createUsageRepositoryStub(consumeAiUsage),
      fetcher: (url) => {
        fetchedUrls.push(url);
        return new Promise((resolve) => resolvers.set(url, resolve));
      },
      aiProvider: { normalize: aiNormalize },
    });

    await vi.waitFor(() => expect(fetchedUrls).toHaveLength(2));
    resolvers.get(PRINT_URL)?.(createFetchedPage(PRINT_URL, createCookpadPrintHtml()));
    resolvers.get(RECIPE_URL)?.(createFetchedPage(RECIPE_URL, createCookpadRecipeHtml()));

    await expect(importPromise).resolves.toEqual({
      recipeDraftContent: {
        title: TITLE,
        servingsText: "2人前",
        coverImage: {
          type: "externalImageUrl",
          url: cookpadCoverImageUrl(1360, 1562, 80),
        },
        ingredientGroups: [
          {
            ingredients: [
              { name: "じゃがいも", amount: "1個" },
              { name: "△塩", amount: "少々" },
            ],
          },
          {
            label: "仕上げ",
            ingredients: [{ name: "◎黒胡椒", amount: "少々" }],
          },
        ],
        steps: STEP_TEXTS.map((text, index) => ({
          text,
          images: STEP_IMAGE_IDS[index].map((imageId) => ({
            type: "externalImageUrl",
            url: cookpadStepImageUrl(imageId, 320, 256, 80),
          })),
        })),
        note: "水気をしっかり取ります。",
      },
      source: {
        sourceUrl: RECIPE_URL,
        sourceName: "クックパッド",
      },
      warnings: [],
    });

    expect(new Set(fetchedUrls)).toEqual(new Set([PRINT_URL, RECIPE_URL]));
    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });

  it("同解像度ならq80を優先し、同一手順内の重複URLを除去する", async () => {
    const imageIdsByStep = [["duplicate", "duplicate"], [], [], [], [], []];
    const recipeHtml = createCookpadRecipeHtml({
      imageIdsByStep,
      stepImageQualityCandidates: [50, 80],
    });

    const result = await importCookpad({
      printHtml: createCookpadPrintHtml({ imageIdsByStep }),
      recipeHtml,
    });

    expect(result.recipeDraftContent.steps[0].images).toEqual([
      {
        type: "externalImageUrl",
        url: cookpadStepImageUrl("duplicate", 320, 256, 80),
      },
    ]);
  });

  it("プレミアムはprintから全手順と手順画像を取り、通常ページからカバーだけを取る", async () => {
    const result = await importCookpad({
      recipeId: PREMIUM_RECIPE_ID,
      printHtml: createCookpadPrintHtml({
        title: PREMIUM_TITLE,
        stepTexts: PREMIUM_STEP_TEXTS,
        imageIdsByStep: PREMIUM_STEP_IMAGE_IDS,
        pictureStepImages: true,
      }),
      recipeHtml: createCookpadPremiumRecipeHtml(),
    });

    expect(result.recipeDraftContent).toMatchObject({
      title: PREMIUM_TITLE,
      coverImage: {
        type: "externalImageUrl",
        url: cookpadCoverImageUrl(1360, 1562, 80),
      },
      steps: PREMIUM_STEP_TEXTS.map((text, index) => ({
        text,
        images: (PREMIUM_STEP_IMAGE_IDS[index] ?? []).map((imageId) => ({
          type: "externalImageUrl",
          url: cookpadStepImageUrl(imageId, 320, 256, 80),
        })),
      })),
    });
  });

  it("プレミアムは通常ページのpreview手順を整合性検証に使わない", async () => {
    const result = await importCookpad({
      recipeId: PREMIUM_RECIPE_ID,
      printHtml: createCookpadPrintHtml({
        title: PREMIUM_TITLE,
        stepTexts: PREMIUM_STEP_TEXTS,
        imageIdsByStep: PREMIUM_STEP_IMAGE_IDS,
        pictureStepImages: true,
      }),
      recipeHtml: createCookpadPremiumRecipeHtml({
        previewStepTexts: ["異なるpreview本文"],
      }),
    });

    expect(result.recipeDraftContent.steps).toHaveLength(PREMIUM_STEP_TEXTS.length);
    expect(result.recipeDraftContent.steps[0].text).toBe(PREMIUM_STEP_TEXTS[0]);
  });

  it("プレミアムでもprintと通常ページのタイトルが一致しない場合は失敗する", async () => {
    await expect(
      importCookpad({
        recipeId: PREMIUM_RECIPE_ID,
        printHtml: createCookpadPrintHtml({
          title: PREMIUM_TITLE,
          stepTexts: PREMIUM_STEP_TEXTS,
          imageIdsByStep: PREMIUM_STEP_IMAGE_IDS,
          pictureStepImages: true,
        }),
        recipeHtml: createCookpadPremiumRecipeHtml({ title: "別のレシピ" }),
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("カバー画像・手順画像がないレシピも抽出できる", async () => {
    const result = await importCookpad({
      printHtml: createCookpadPrintHtml({
        imageIdsByStep: [[], [], [], [], [], []],
        servings: "",
        note: "",
      }),
      recipeHtml: createCookpadRecipeHtml({
        coverImage: false,
        imageIdsByStep: [[], [], [], [], [], []],
      }),
    });

    expect(result).toMatchObject({
      recipeDraftContent: {
        title: TITLE,
        steps: STEP_TEXTS.map((text) => ({ text, images: [] })),
      },
    });
    expect(result.recipeDraftContent).not.toHaveProperty("coverImage");
  });

  it.each([
    {
      name: "タイトル",
      printHtml: createCookpadPrintHtml(),
      recipeHtml: createCookpadRecipeHtml({ title: "別のレシピ" }),
    },
    {
      name: "手順数",
      printHtml: createCookpadPrintHtml(),
      recipeHtml: createCookpadRecipeHtml({ stepTexts: STEP_TEXTS.slice(0, 5) }),
    },
    {
      name: "手順本文",
      printHtml: createCookpadPrintHtml(),
      recipeHtml: createCookpadRecipeHtml({
        stepTexts: STEP_TEXTS.map((text, index) => (index === 2 ? "異なる本文" : text)),
      }),
    },
    {
      name: "先頭画像ID",
      printHtml: createCookpadPrintHtml(),
      recipeHtml: createCookpadRecipeHtml({
        imageIdsByStep: STEP_IMAGE_IDS.map((ids, index) =>
          index === 0 ? ["different", ...ids.slice(1)] : ids,
        ),
      }),
    },
  ])("$nameが一致しない場合は失敗する", async ({ printHtml, recipeHtml }) => {
    await expect(importCookpad({ printHtml, recipeHtml })).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("片方が非HTMLの場合はAI fallbackしない", async () => {
    const aiNormalize = vi.fn();
    const consumeAiUsage = vi.fn();

    await expect(
      importRecipeFromUrl({
        rawUrl: RECIPE_URL,
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepositoryStub(consumeAiUsage),
        fetcher: async (url) =>
          url === PRINT_URL
            ? createFetchedPage(url, createCookpadPrintHtml())
            : {
                finalUrl: url,
                contentType: "application/json",
                body: "{}",
              },
        aiProvider: { normalize: aiNormalize },
      }),
    ).rejects.toMatchObject({
      code: "unsupported_page",
    } satisfies Partial<RecipeImportError>);

    expect(aiNormalize).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });
});

const importCookpad = ({
  recipeId = RECIPE_ID,
  printHtml = createCookpadPrintHtml(),
  recipeHtml = createCookpadRecipeHtml(),
}: {
  recipeId?: string;
  printHtml?: string;
  recipeHtml?: string;
} = {}) =>
  importRecipeFromUrl({
    rawUrl: `https://cookpad.com/jp/recipes/${recipeId}`,
    userId: "user_123",
    env: {},
    usageRepository: createUsageRepositoryStub(),
    fetcher: async (url) => createFetchedPage(url, url.endsWith("/print") ? printHtml : recipeHtml),
  });

const createFetchedPage = (url: string, body: string) => ({
  finalUrl: url,
  contentType: "text/html; charset=utf-8",
  body,
});

const createCookpadPrintHtml = ({
  title = TITLE,
  stepTexts = STEP_TEXTS,
  imageIdsByStep = STEP_IMAGE_IDS,
  pictureStepImages = false,
  servings = '<span class="mise-icon-text">2人前</span>',
  note = `
    <div class="mb-rg">
      <div>コツ・ポイント</div>
      <div><p>水気をしっかり取ります。</p></div>
    </div>
  `,
}: {
  title?: string;
  stepTexts?: string[];
  imageIdsByStep?: string[][];
  pictureStepImages?: boolean;
  servings?: string;
  note?: string;
} = {}) => `
  <html>
    <body>
      <div id="recipe-print">
        <header><span dir="auto">${title}</span></header>
        <div class="grid">
          <div>
            <span>材料</span>
            ${servings}
            <ol dir="auto">
              <li class="justified-quantity-and-name not-headline">
                <span>じゃがいも</span><bdi>1個</bdi>
              </li>
              <li class="justified-quantity-and-name not-headline">
                <span>△塩</span><bdi>少々</bdi>
              </li>
              <li class="justified-quantity-and-name headline">
                <span>■仕上げ</span><bdi></bdi>
              </li>
              <li class="justified-quantity-and-name not-headline">
                <span>◎黒胡椒</span><bdi>少々</bdi>
              </li>
            </ol>
          </div>
          <div>
            ${note}
            <ol class="grid">
              ${stepTexts
                .map(
                  (text, index) => `
                    <li>
                      <div>${index + 1}.</div>
                      <div>
                        <p>${text}</p>
                        ${
                          imageIdsByStep[index]?.[0]
                            ? pictureStepImages
                              ? `
                                <picture>
                                  <source type="image/jpeg" srcset="
                                    ${cookpadStepImageUrl(
                                      imageIdsByStep[index][0],
                                      160,
                                      128,
                                      50,
                                    )} 1x,
                                    ${cookpadStepImageUrl(
                                      imageIdsByStep[index][0],
                                      320,
                                      256,
                                      80,
                                    )} 2x
                                  ">
                                  <img src="${cookpadStepImageUrl(
                                    imageIdsByStep[index][0],
                                    160,
                                    128,
                                    80,
                                  )}">
                                </picture>
                              `
                              : `<img src="${cookpadStepImageUrl(
                                  imageIdsByStep[index][0],
                                  160,
                                  128,
                                  80,
                                )}">`
                            : ""
                        }
                      </div>
                    </li>
                  `,
                )
                .join("")}
            </ol>
          </div>
        </div>
      </div>
    </body>
  </html>
`;

const createCookpadPremiumRecipeHtml = ({
  title = PREMIUM_TITLE,
  previewStepTexts = PREMIUM_STEP_TEXTS.slice(0, 4),
}: {
  title?: string;
  previewStepTexts?: string[];
} = {}) => `
  <html>
    <body>
      <div class="tofu_image">
        <picture>
          <source type="image/jpeg" srcset="
            ${cookpadCoverImageUrl(680, 781, 80)} 1x,
            ${cookpadCoverImageUrl(1360, 1562, 80)} 2x
          ">
          <img src="${cookpadCoverImageUrl(680, 781, 80)}">
        </picture>
      </div>
      <h1 dir="auto">${title}</h1>
      <div id="premium-recipe-label">プレミアムレシピ</div>
      <div data-controller="premium_recipe_preview">
        ${previewStepTexts
          .map(
            (text, index) => `
              <div id="step_${90243165 + index}">
                <p>${text}</p>
                <picture>
                  <source type="image/jpeg" srcset="
                    ${cookpadStepImageUrl(`preview-${index}`, 160, 160, 80)} 1x,
                    ${cookpadStepImageUrl(`preview-${index}`, 320, 320, 80)} 2x
                  ">
                  <img src="${cookpadStepImageUrl(`preview-${index}`, 160, 160, 80)}">
                </picture>
              </div>
            `,
          )
          .join("")}
      </div>
    </body>
  </html>
`;

const createCookpadRecipeHtml = ({
  title = TITLE,
  stepTexts = STEP_TEXTS,
  imageIdsByStep = STEP_IMAGE_IDS,
  coverImage = true,
  stepImageQualityCandidates = [50, 80],
}: {
  title?: string;
  stepTexts?: string[];
  imageIdsByStep?: string[][];
  coverImage?: boolean;
  stepImageQualityCandidates?: number[];
} = {}) => `
  <html>
    <body>
      ${
        coverImage
          ? `
            <div class="tofu_image">
              <picture>
                <source type="image/jpeg" srcset="
                  ${cookpadCoverImageUrl(680, 781, 80)} 1x,
                  ${cookpadCoverImageUrl(1360, 1562, 80)} 2x
                ">
                <img src="${cookpadCoverImageUrl(680, 781, 80)}">
              </picture>
            </div>
          `
          : ""
      }
      <h1 dir="auto">${title}</h1>
      <ol id="steps">
        ${stepTexts
          .map(
            (text, index) => `
              <li id="step_${90072264 + index}">
                <div><p>${text}</p></div>
                <ul class="step-attachments-list">
                  ${(imageIdsByStep[index] ?? [])
                    .map(
                      (imageId) => `
                        <li>
                          <picture>
                            ${stepImageQualityCandidates
                              .map(
                                (quality) => `
                                  <source type="image/jpeg" srcset="
                                    ${cookpadStepImageUrl(imageId, 160, 128, quality)} 1x,
                                    ${cookpadStepImageUrl(imageId, 320, 256, quality)} 2x
                                  ">
                                `,
                              )
                              .join("")}
                            <img src="${cookpadStepImageUrl(imageId, 160, 128, 80)}">
                          </picture>
                        </li>
                      `,
                    )
                    .join("")}
                </ul>
              </li>
            `,
          )
          .join("")}
      </ol>
    </body>
  </html>
`;

const cookpadCoverImageUrl = (width: number, height: number, quality: number) =>
  `https://img-global-jp.cpcdn.com/recipes/cover/${width}x${height}f0.5_0.5_1.0q${quality}/photo.jpg`;

const cookpadStepImageUrl = (imageId: string, width: number, height: number, quality: number) =>
  `https://img-global-jp.cpcdn.com/steps/${imageId}/${width}x${height}cq${quality}/photo.jpg`;

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
