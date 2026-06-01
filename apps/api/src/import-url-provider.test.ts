import { recipeDraftContentSchema } from "@recipestock/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultRecipeImportAIProvider, type RecipeImportAIInput } from "./import-url";

const mocks = vi.hoisted(() => {
  const model = { provider: "workers-ai", modelId: "@cf/openai/gpt-oss-120b" };

  return {
    generateObject: vi.fn(),
    workersai: vi.fn(() => model),
    createWorkersAI: vi.fn(() => vi.fn(() => model)),
  };
});

vi.mock("ai", () => ({
  generateObject: mocks.generateObject,
}));

vi.mock("workers-ai-provider", () => ({
  createWorkersAI: mocks.createWorkersAI,
}));

const input: RecipeImportAIInput = {
  sourceUrl: "https://example.com/recipes/tomato",
  sourceName: "Example Kitchen",
  title: "Tomato pasta",
  description: "Simple tomato pasta",
  text: "トマト缶とオリーブオイルで作るパスタです。",
  jsonLd: ['{"@type":"Recipe","name":"Tomato pasta"}'],
  imageCandidates: [
    {
      url: "https://example.com/cover.jpg",
      kind: "cover",
      alt: "Tomato pasta",
      position: 0,
    },
  ],
};

describe("default recipe import AI provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Workers AI bindingとAI Gateway経由でRecipeDraftContentを生成する", async () => {
    const draft = {
      title: "Tomato pasta",
      ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [{ text: "煮詰める" }],
    };
    mocks.generateObject.mockResolvedValueOnce({ object: draft });

    const provider = createDefaultRecipeImportAIProvider({
      AI: { run: vi.fn() } as unknown as Ai,
      AI_GATEWAY_NAME: "recipestock",
      AI_TEXT_MODEL: "@cf/openai/gpt-oss-120b",
    } as never);

    await expect(provider.normalize(input)).resolves.toEqual(draft);
    expect(mocks.createWorkersAI).toHaveBeenCalledWith({
      binding: expect.objectContaining({ run: expect.any(Function) }),
      gateway: { id: "recipestock" },
    });
    expect(mocks.createWorkersAI.mock.results[0]?.value).toHaveBeenCalledWith(
      "@cf/openai/gpt-oss-120b",
    );
    expect(mocks.generateObject).toHaveBeenCalledWith({
      model: { provider: "workers-ai", modelId: "@cf/openai/gpt-oss-120b" },
      schema: recipeDraftContentSchema,
      prompt: expect.stringContaining("https://example.com/recipes/tomato"),
      temperature: 0,
      maxRetries: 0,
    });
  });
});
