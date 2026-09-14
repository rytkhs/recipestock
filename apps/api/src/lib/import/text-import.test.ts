import { describe, expect, it, vi } from "vitest";
import { type AiUsageConsumptionRepository } from "../../usage";
import { importRecipeFromText } from "./text-import";
import {
  type RecipeImportAIDraftContent,
  type RecipeImportAIProvider,
  type RecipeImportError,
} from "./types";

const sourceText = [
  "鶏むね肉のレモン煮",
  "",
  "材料（2人分）",
  "鶏むね肉 300g",
  "レモン汁 大さじ2",
  "",
  "作り方",
  "1. 鶏肉をそぎ切りにする",
  "2. レモン汁で煮る",
].join("\n");

const createUsageRepository = (
  overrides: Partial<AiUsageConsumptionRepository> = {},
): AiUsageConsumptionRepository => ({
  getOrCreateAppUser: async (userId) => ({ userId, plan: "free" }),
  consumeAiUsage: async () => ({
    status: "consumed",
    usage: { month: "2026-06", used: 1 },
  }),
  ...overrides,
});

const createAiProvider = (draft: RecipeImportAIDraftContent) => ({
  normalize: vi.fn<RecipeImportAIProvider["normalize"]>(async () => draft),
});

describe("importRecipeFromText", () => {
  it("原文をテキスト用のAI入力で渡し、画像のないRecipeDraftContentにする", async () => {
    const aiProvider = createAiProvider({
      title: "鶏むね肉のレモン煮",
      yieldText: "2人分",
      coverImageUrl: "https://example.com/cover.jpg",
      ingredientGroups: [
        {
          ingredients: [
            { name: "鶏むね肉", amount: "300g" },
            { name: "レモン汁", amount: "大さじ2" },
          ],
        },
      ],
      steps: [
        { text: "鶏肉をそぎ切りにする", imageUrls: ["https://example.com/step-1.jpg"] },
        { imageUrls: ["https://example.com/step-2.jpg"] },
        { text: "レモン汁で煮る", imageUrls: [] },
      ],
    });

    await expect(
      importRecipeFromText({
        sourceText,
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepository(),
        aiProvider,
      }),
    ).resolves.toEqual({
      recipeDraftContent: {
        title: "鶏むね肉のレモン煮",
        yieldText: "2人分",
        referenceImages: [],
        ingredientGroups: [
          {
            ingredients: [
              { name: "鶏むね肉", amount: "300g" },
              { name: "レモン汁", amount: "大さじ2" },
            ],
          },
        ],
        steps: [
          { text: "鶏肉をそぎ切りにする", images: [] },
          { text: "レモン汁で煮る", images: [] },
        ],
      },
      source: { sourceUrl: null, sourceName: null },
      warnings: [],
    });
    expect(aiProvider.normalize).toHaveBeenCalledWith({
      promptProfile: "text",
      input: { text: sourceText },
    });
  });

  it("AIがタイトルを付けなければ原文の最初の行を80文字までタイトルにする", async () => {
    const aiProvider = createAiProvider({
      title: null,
      ingredientGroups: [{ ingredients: [{ name: "鶏むね肉", amount: "300g" }] }],
      steps: [],
    });

    const result = await importRecipeFromText({
      sourceText: `\n  ${"あ".repeat(100)}  \n鶏むね肉 300g`,
      userId: "user_123",
      env: {},
      usageRepository: createUsageRepository(),
      aiProvider,
    });

    expect(result.recipeDraftContent.title).toBe("あ".repeat(80));
  });

  it("材料も手順も読み取れなければAI利用回数を消費したうえでextraction_failedにする", async () => {
    const consumeAiUsage = vi.fn<AiUsageConsumptionRepository["consumeAiUsage"]>(async () => ({
      status: "consumed",
      usage: { month: "2026-06", used: 1 },
    }));
    const aiProvider = createAiProvider({
      title: null,
      ingredientGroups: [],
      steps: [],
      note: "今日の夕飯はおいしかった",
    });

    await expect(
      importRecipeFromText({
        sourceText: "今日の夕飯はおいしかった",
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepository({ consumeAiUsage }),
        aiProvider,
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
    expect(consumeAiUsage).toHaveBeenCalledTimes(1);
  });

  it("AI利用上限に達していればAIを呼ばずにai_usage_limit_exceededにする", async () => {
    const aiProvider = createAiProvider({ title: null, ingredientGroups: [], steps: [] });

    await expect(
      importRecipeFromText({
        sourceText,
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepository({
          consumeAiUsage: async () => ({ status: "limitExceeded" }),
        }),
        aiProvider,
      }),
    ).rejects.toMatchObject({
      code: "ai_usage_limit_exceeded",
    } satisfies Partial<RecipeImportError>);
    expect(aiProvider.normalize).not.toHaveBeenCalled();
  });

  it("全体期限を過ぎていればAI利用回数を消費しない", async () => {
    const consumeAiUsage = vi.fn<AiUsageConsumptionRepository["consumeAiUsage"]>();
    const aiProvider = createAiProvider({ title: null, ingredientGroups: [], steps: [] });

    await expect(
      importRecipeFromText({
        sourceText,
        userId: "user_123",
        env: {},
        usageRepository: createUsageRepository({ consumeAiUsage }),
        aiProvider,
        deadline: new Date("2026-06-01T00:00:00.000Z"),
        getCurrentDate: () => new Date("2026-06-01T00:00:01.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "job_timeout",
    } satisfies Partial<RecipeImportError>);
    expect(consumeAiUsage).not.toHaveBeenCalled();
    expect(aiProvider.normalize).not.toHaveBeenCalled();
  });
});
