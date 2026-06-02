import { recipeDraftContentSchema } from "@recipestock/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultRecipeImportAIProvider,
  type RecipeImportAIInput,
  type RecipeImportError,
} from "./import-url";

const mocks = vi.hoisted(() => {
  const model = { provider: "workers-ai", modelId: "@cf/zai-org/glm-4.7-flash" };

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
    vi.useRealTimers();
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
      AI_TEXT_MODEL: "@cf/zai-org/glm-4.7-flash",
    } as never);

    await expect(provider.normalize(input)).resolves.toEqual(draft);
    expect(mocks.createWorkersAI).toHaveBeenCalledWith({
      binding: expect.objectContaining({ run: expect.any(Function) }),
      gateway: { id: "recipestock" },
    });
    expect(mocks.createWorkersAI.mock.results[0]?.value).toHaveBeenCalledWith(
      "@cf/zai-org/glm-4.7-flash",
    );
    expect(mocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "workers-ai", modelId: "@cf/zai-org/glm-4.7-flash" },
        schema: recipeDraftContentSchema,
        prompt: expect.stringContaining("https://example.com/recipes/tomato"),
        temperature: 0,
        maxRetries: 0,
        timeout: 60000,
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("AI SDKのschema失敗をai_schema_invalidへ変換する", async () => {
    const schemaError = Object.assign(new Error("No object generated: schema validation failed"), {
      name: "NoObjectGeneratedError",
    });
    mocks.generateObject.mockRejectedValueOnce(schemaError);

    const provider = createDefaultRecipeImportAIProvider({
      AI: { run: vi.fn() } as unknown as Ai,
      AI_GATEWAY_NAME: "recipestock",
      AI_TEXT_MODEL: "@cf/zai-org/glm-4.7-flash",
      IMPORT_AI_TIMEOUT_MS: "1000",
    } as never);

    await expect(provider.normalize(input)).rejects.toMatchObject({
      code: "ai_schema_invalid",
    } satisfies Partial<RecipeImportError>);
  });

  it("AI SDK v6のschema失敗名をai_schema_invalidへ変換する", async () => {
    const schemaError = Object.assign(new Error("No object generated"), {
      name: "AI_NoObjectGeneratedError",
    });
    mocks.generateObject.mockRejectedValueOnce(schemaError);

    const provider = createDefaultRecipeImportAIProvider({
      AI: { run: vi.fn() } as unknown as Ai,
      AI_GATEWAY_NAME: "recipestock",
      AI_TEXT_MODEL: "@cf/zai-org/glm-4.7-flash",
      IMPORT_AI_TIMEOUT_MS: "1000",
    } as never);

    await expect(provider.normalize(input)).rejects.toMatchObject({
      code: "ai_schema_invalid",
    } satisfies Partial<RecipeImportError>);
  });

  it("AI SDKのschema失敗がcauseに入っていてもai_schema_invalidへ変換する", async () => {
    const schemaCause = Object.assign(new Error("type validation failed"), {
      name: "AI_TypeValidationError",
    });
    const wrappedError = Object.assign(new Error("provider failed"), {
      name: "ProviderError",
      cause: schemaCause,
    });
    mocks.generateObject.mockRejectedValueOnce(wrappedError);

    const provider = createDefaultRecipeImportAIProvider({
      AI: { run: vi.fn() } as unknown as Ai,
      AI_GATEWAY_NAME: "recipestock",
      AI_TEXT_MODEL: "@cf/zai-org/glm-4.7-flash",
      IMPORT_AI_TIMEOUT_MS: "1000",
    } as never);

    await expect(provider.normalize(input)).rejects.toMatchObject({
      code: "ai_schema_invalid",
    } satisfies Partial<RecipeImportError>);
  });

  it("AI_TEXT_MODELが未設定の場合はunknownへ変換しAI呼び出しをしない", async () => {
    const provider = createDefaultRecipeImportAIProvider({
      AI: { run: vi.fn() } as unknown as Ai,
      AI_GATEWAY_NAME: "recipestock",
      AI_TEXT_MODEL: "",
    } as never);

    await expect(provider.normalize(input)).rejects.toMatchObject({
      code: "unknown",
      message: "AI text model is not configured.",
    } satisfies Partial<RecipeImportError>);
    expect(mocks.createWorkersAI).not.toHaveBeenCalled();
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it("AI変換がタイムアウトした場合はai_timeoutへ変換する", async () => {
    vi.useFakeTimers();
    mocks.generateObject.mockImplementationOnce(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );

    const provider = createDefaultRecipeImportAIProvider({
      AI: { run: vi.fn() } as unknown as Ai,
      AI_GATEWAY_NAME: "recipestock",
      AI_TEXT_MODEL: "@cf/zai-org/glm-4.7-flash",
      IMPORT_AI_TIMEOUT_MS: "10",
    } as never);

    const result = expect(provider.normalize(input)).rejects.toMatchObject({
      code: "ai_timeout",
    } satisfies Partial<RecipeImportError>);
    await vi.advanceTimersByTimeAsync(10);
    await result;
  });

  it("AI SDKやGateway由来のtimeout系エラーをai_timeoutへ変換する", async () => {
    const timeoutError = Object.assign(new Error("request timed out"), {
      name: "AI_APICallError",
      statusCode: 504,
    });
    mocks.generateObject.mockRejectedValueOnce(timeoutError);

    const provider = createDefaultRecipeImportAIProvider({
      AI: { run: vi.fn() } as unknown as Ai,
      AI_GATEWAY_NAME: "recipestock",
      AI_TEXT_MODEL: "@cf/zai-org/glm-4.7-flash",
      IMPORT_AI_TIMEOUT_MS: "1000",
    } as never);

    await expect(provider.normalize(input)).rejects.toMatchObject({
      code: "ai_timeout",
    } satisfies Partial<RecipeImportError>);
  });
});
