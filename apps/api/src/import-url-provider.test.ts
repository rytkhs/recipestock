import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultRecipeImportAIProvider,
  type RecipeImportAINormalizeRequest,
  type RecipeImportError,
  type RecipeImportGenericAIInput,
  type RecipeImportSocialAIInput,
} from "./import-url";

const mocks = vi.hoisted(() => {
  const workersAiModel = { provider: "workers-ai", modelId: "@cf/zai-org/glm-4.7-flash" };
  const groqModel = { provider: "groq.chat", modelId: "openai/gpt-oss-120b" };

  return {
    generateObject: vi.fn(),
    workersai: vi.fn(() => workersAiModel),
    createGroq: vi.fn(() => vi.fn(() => groqModel)),
    createWorkersAI: vi.fn(() => vi.fn(() => workersAiModel)),
  };
});

vi.mock("ai", () => ({
  generateObject: mocks.generateObject,
}));

vi.mock("workers-ai-provider", () => ({
  createWorkersAI: mocks.createWorkersAI,
}));

vi.mock("@ai-sdk/groq", () => ({
  createGroq: mocks.createGroq,
}));

const genericInput: RecipeImportGenericAIInput = {
  source: {
    finalUrl: "https://example.com/recipes/tomato",
    host: "example.com",
  },
  markdownContent:
    "# Tomato pasta\n\nトマト缶とオリーブオイルで作るパスタです。\n\n![Tomato pasta](<https://example.com/cover.jpg>)",
  recipeStructuredEvidence: [
    {
      format: "jsonLd",
      name: "Tomato pasta",
      imageUrls: [],
      rawIngredients: ["トマト缶 1缶"],
      rawInstructions: ["煮詰める"],
      structuredInstructions: [],
    },
  ],
};

const socialInput: RecipeImportSocialAIInput = {
  source: {
    finalUrl: "https://example.com/social/tomato",
    host: "example.com",
  },
  markdownContent: "# Tomato pasta\n\nトマト缶とオリーブオイルで作るパスタです。",
};

const genericRequest = {
  promptProfile: "generic",
  input: genericInput,
} satisfies RecipeImportAINormalizeRequest;

const socialRequest = {
  promptProfile: "social",
  input: socialInput,
} satisfies RecipeImportAINormalizeRequest;

const createEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    AI: { run: vi.fn() } as unknown as Ai,
    AI_GATEWAY_NAME: "recipestock",
    AI_TEXT_MODEL: "@cf/zai-org/glm-4.7-flash",
    IMPORT_RECIPE_SYSTEM_PROMPT:
      "URLから抽出した情報をRecipeDraftContentに正規化してください。入力にない内容は推測しない。",
    IMPORT_RECIPE_SOCIAL_SYSTEM_PROMPT:
      "SNS投稿から抽出した情報をRecipeDraftContentに正規化してください。",
    ...overrides,
  }) as never;

const createStrictAiDraft = (overrides: Record<string, unknown> = {}) => ({
  title: "Tomato pasta",
  yieldText: null,
  coverImageUrl: null,
  ingredientGroups: [
    {
      label: null,
      ingredients: [{ name: "トマト缶", amount: "1缶" }],
    },
  ],
  steps: [{ text: "煮詰める", imageUrls: [] }],
  note: null,
  ...overrides,
});

describe("default recipe import AI provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("Workers AI bindingとAI Gateway経由でRecipeDraftContentを生成する", async () => {
    const draft = createStrictAiDraft();
    mocks.generateObject.mockResolvedValueOnce({ object: draft });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).resolves.toEqual({
      title: "Tomato pasta",
      ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [{ text: "煮詰める", imageUrls: [] }],
    });
    expect(mocks.createWorkersAI).toHaveBeenCalledWith({
      binding: expect.objectContaining({ run: expect.any(Function) }),
      gateway: { id: "recipestock" },
    });
    expect(mocks.createWorkersAI.mock.results[0]?.value).toHaveBeenCalledWith(
      "@cf/zai-org/glm-4.7-flash",
      {
        extraHeaders: { "cf-aig-request-timeout": "180000" },
      },
    );
    expect(mocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "workers-ai", modelId: "@cf/zai-org/glm-4.7-flash" },
        schema: expect.any(Object),
        system: expect.stringContaining("RecipeDraftContent"),
        prompt: expect.not.stringContaining("metadataCandidates"),
        temperature: 0,
        maxOutputTokens: 8192,
        maxRetries: 0,
        timeout: 180000,
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.generateObject.mock.calls[0]?.[0]?.prompt).toContain(
      "https://example.com/recipes/tomato",
    );
    expect(mocks.generateObject.mock.calls[0]?.[0]?.prompt).toContain("markdownContent");
    expect(mocks.generateObject.mock.calls[0]?.[0]?.prompt).toContain(
      "![Tomato pasta](<https://example.com/cover.jpg>)",
    );
    expect(mocks.generateObject.mock.calls[0]?.[0]?.prompt).not.toContain("imageCandidates");
    expect(mocks.generateObject.mock.calls[0]?.[0]?.prompt).toContain("recipeStructuredEvidence");
  });

  it("GroqとAI Gateway経由でRecipeDraftContentを生成する", async () => {
    const draft = createStrictAiDraft();
    mocks.generateObject.mockResolvedValueOnce({ object: draft });

    const provider = createDefaultRecipeImportAIProvider(
      createEnv({
        IMPORT_AI_PROVIDER: "groq",
        CLOUDFLARE_ACCOUNT_ID: "account-123",
        CF_AIG_TOKEN: "gateway-token",
        GROQ_API_KEY: "groq-key",
        GROQ_TEXT_MODEL: "openai/gpt-oss-120b",
      }),
    );

    await expect(provider.normalize(genericRequest)).resolves.toEqual({
      title: "Tomato pasta",
      ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [{ text: "煮詰める", imageUrls: [] }],
    });
    expect(mocks.createGroq).toHaveBeenCalledWith({
      apiKey: "groq-key",
      baseURL: "https://gateway.ai.cloudflare.com/v1/account-123/recipestock/groq",
      headers: {
        "cf-aig-authorization": "Bearer gateway-token",
      },
    });
    expect(mocks.createGroq.mock.results[0]?.value).toHaveBeenCalledWith("openai/gpt-oss-120b");
    expect(mocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "groq.chat", modelId: "openai/gpt-oss-120b" },
        providerOptions: {
          groq: {
            structuredOutputs: true,
            strictJsonSchema: true,
          },
        },
        timeout: 180000,
      }),
    );
  });

  it("social profileではSNS用system promptを使う", async () => {
    mocks.generateObject.mockResolvedValueOnce({ object: createStrictAiDraft() });

    const provider = createDefaultRecipeImportAIProvider(
      createEnv({
        IMPORT_RECIPE_SYSTEM_PROMPT: "Generic prompt.",
        IMPORT_RECIPE_SOCIAL_SYSTEM_PROMPT: "Social prompt.",
      }),
    );

    await expect(provider.normalize(socialRequest)).resolves.toMatchObject({
      title: "Tomato pasta",
    });
    expect(mocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "Social prompt.",
      }),
    );
  });

  it("AIがcoverImageUrlを返した場合は受け付ける", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: createStrictAiDraft({
        coverImageUrl: "https://example.com/cover.jpg",
      }),
    });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).resolves.toMatchObject({
      coverImageUrl: "https://example.com/cover.jpg",
    });
  });

  it("AIがURLベースのcoverImageを返した場合はai_schema_invalidへ変換する", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: {
        title: "Tomato pasta",
        coverImage: { url: "https://example.com/cover.jpg" },
        ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
        steps: [{ text: "煮詰める" }],
      },
    });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_schema_invalid",
    } satisfies Partial<RecipeImportError>);
  });

  it("AIがstepsの画像URLを返した場合は受け付ける", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: createStrictAiDraft({
        steps: [
          {
            text: "煮詰める",
            imageUrls: ["https://example.com/step-2.jpg", "https://example.com/step-3.jpg"],
          },
        ],
      }),
    });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).resolves.toMatchObject({
      steps: [
        {
          imageUrls: ["https://example.com/step-2.jpg", "https://example.com/step-3.jpg"],
        },
      ],
    });
  });

  it("AI出力のnullを既存のoptional形式へ正規化する", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: createStrictAiDraft({
        yieldText: null,
        coverImageUrl: null,
        ingredientGroups: [
          {
            label: null,
            ingredients: [{ name: "トマト缶", amount: "1缶" }],
          },
        ],
        steps: [{ text: null, imageUrls: ["https://example.com/step-2.jpg"] }],
        note: null,
      }),
    });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).resolves.toEqual({
      title: "Tomato pasta",
      ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [{ imageUrls: ["https://example.com/step-2.jpg"] }],
    });
  });

  it("AI出力のtitleがnullでも受け付ける", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: createStrictAiDraft({
        title: null,
      }),
    });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).resolves.toMatchObject({
      title: null,
      ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [{ text: "煮詰める", imageUrls: [] }],
    });
  });

  it("AI出力のtitleが空白でもnull相当に正規化する", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: createStrictAiDraft({
        title: "   ",
      }),
    });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).resolves.toMatchObject({
      title: null,
      ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
      steps: [{ text: "煮詰める", imageUrls: [] }],
    });
  });

  it("AIがURL typeの画像を返した場合はai_schema_invalidへ変換する", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: {
        title: "Tomato pasta",
        coverImage: { type: "url", url: "ftp://example.com/cover.jpg" },
        ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
        steps: [{ text: "煮詰める" }],
      },
    });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_schema_invalid",
    } satisfies Partial<RecipeImportError>);
  });

  it("AIがkeyベースの画像参照を返した場合はai_schema_invalidへ変換する", async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: {
        title: "Tomato pasta",
        coverImage: { type: "tmpObjectKey", key: "tmp/user_123/cover.webp" },
        ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
        steps: [{ text: "煮詰める" }],
      },
    });

    const provider = createDefaultRecipeImportAIProvider(createEnv());

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_schema_invalid",
    } satisfies Partial<RecipeImportError>);
  });

  it("AI SDKのschema失敗をai_schema_invalidへ変換する", async () => {
    const schemaError = Object.assign(new Error("No object generated: schema validation failed"), {
      name: "NoObjectGeneratedError",
    });
    mocks.generateObject.mockRejectedValueOnce(schemaError);

    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_AI_TIMEOUT_MS: "1000" }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_schema_invalid",
    } satisfies Partial<RecipeImportError>);
  });

  it("AI SDK v6のschema失敗名をai_schema_invalidへ変換する", async () => {
    const schemaError = Object.assign(new Error("No object generated"), {
      name: "AI_NoObjectGeneratedError",
    });
    mocks.generateObject.mockRejectedValueOnce(schemaError);

    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_AI_TIMEOUT_MS: "1000" }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
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

    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_AI_TIMEOUT_MS: "1000" }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_schema_invalid",
    } satisfies Partial<RecipeImportError>);
  });

  it("AI_TEXT_MODELが未設定の場合はunknownへ変換しAI呼び出しをしない", async () => {
    const provider = createDefaultRecipeImportAIProvider(createEnv({ AI_TEXT_MODEL: "" }));

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "unknown",
      message: "AI text model is not configured.",
    } satisfies Partial<RecipeImportError>);
    expect(mocks.createWorkersAI).not.toHaveBeenCalled();
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it("GROQ_API_KEYが未設定の場合はunknownへ変換しAI呼び出しをしない", async () => {
    const provider = createDefaultRecipeImportAIProvider(
      createEnv({
        IMPORT_AI_PROVIDER: "groq",
        CLOUDFLARE_ACCOUNT_ID: "account-123",
        CF_AIG_TOKEN: "gateway-token",
        GROQ_API_KEY: "",
        GROQ_TEXT_MODEL: "openai/gpt-oss-120b",
      }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "unknown",
      message: "Groq API key is not configured.",
    } satisfies Partial<RecipeImportError>);
    expect(mocks.createGroq).not.toHaveBeenCalled();
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it("GROQ_TEXT_MODELが未設定の場合はunknownへ変換しAI呼び出しをしない", async () => {
    const provider = createDefaultRecipeImportAIProvider(
      createEnv({
        IMPORT_AI_PROVIDER: "groq",
        CLOUDFLARE_ACCOUNT_ID: "account-123",
        CF_AIG_TOKEN: "gateway-token",
        GROQ_API_KEY: "groq-key",
        GROQ_TEXT_MODEL: "",
      }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "unknown",
      message: "Groq text model is not configured.",
    } satisfies Partial<RecipeImportError>);
    expect(mocks.createGroq).not.toHaveBeenCalled();
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it("IMPORT_RECIPE_SYSTEM_PROMPTが未設定の場合はunknownへ変換しAI呼び出しをしない", async () => {
    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_RECIPE_SYSTEM_PROMPT: "" }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "unknown",
      message: "Import recipe system prompt is not configured.",
    } satisfies Partial<RecipeImportError>);
    expect(mocks.createWorkersAI).not.toHaveBeenCalled();
    expect(mocks.generateObject).not.toHaveBeenCalled();
  });

  it("IMPORT_RECIPE_SOCIAL_SYSTEM_PROMPTが未設定の場合はunknownへ変換しAI呼び出しをしない", async () => {
    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_RECIPE_SOCIAL_SYSTEM_PROMPT: "" }),
    );

    await expect(provider.normalize(socialRequest)).rejects.toMatchObject({
      code: "unknown",
      message: "Import recipe social system prompt is not configured.",
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

    const provider = createDefaultRecipeImportAIProvider(createEnv({ IMPORT_AI_TIMEOUT_MS: "10" }));

    const result = expect(provider.normalize(genericRequest)).rejects.toMatchObject({
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

    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_AI_TIMEOUT_MS: "1000" }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_timeout",
    } satisfies Partial<RecipeImportError>);
  });

  it("GatewayのHTML 504 Time-outをai_timeoutへ変換する", async () => {
    const gatewayError = Object.assign(
      new Error(`<html>
<head><title>504 Gateway Time-out</title></head>
<body>
<center><h1>504 Gateway Time-out</h1></center>
<hr><center>cloudflare</center>
</body>
</html>`),
      {
        name: "InferenceUpstreamError",
      },
    );
    mocks.generateObject.mockRejectedValueOnce(gatewayError);

    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_AI_TIMEOUT_MS: "1000" }),
      { logger },
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_timeout",
    } satisfies Partial<RecipeImportError>);
    expect(logger.error).toHaveBeenCalledWith(
      "recipe_import_ai_normalization_failed",
      expect.objectContaining({
        markdownContentLength: genericInput.markdownContent.length,
        structuredEvidenceCount: genericInput.recipeStructuredEvidence.length,
      }),
    );
  });

  it("statusが504の場合はstatusCodeがなくてもai_timeoutへ変換する", async () => {
    const timeoutError = Object.assign(new Error("upstream failed"), {
      name: "AI_APICallError",
      status: 504,
    });
    mocks.generateObject.mockRejectedValueOnce(timeoutError);

    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_AI_TIMEOUT_MS: "1000" }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_timeout",
    } satisfies Partial<RecipeImportError>);
  });

  it("cause内のGateway Time-outもai_timeoutへ変換する", async () => {
    const timeoutCause = Object.assign(new Error("504 Gateway Time-out"), {
      name: "InferenceUpstreamError",
    });
    const wrappedError = Object.assign(new Error("provider failed"), {
      name: "AI_APICallError",
      cause: timeoutCause,
    });
    mocks.generateObject.mockRejectedValueOnce(wrappedError);

    const provider = createDefaultRecipeImportAIProvider(
      createEnv({ IMPORT_AI_TIMEOUT_MS: "1000" }),
    );

    await expect(provider.normalize(genericRequest)).rejects.toMatchObject({
      code: "ai_timeout",
    } satisfies Partial<RecipeImportError>);
  });
});
