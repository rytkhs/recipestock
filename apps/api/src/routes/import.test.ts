import { describe, expect, it } from "vitest";
import { type RecipeImportAIProvider, RecipeImportError } from "../import-url";
import { createApp } from "../index";
import { type UsageRepository } from "../usage";

const auth = {
  getSession: async () => ({
    user: { id: "user_123" },
  }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const htmlPage = `<!doctype html>
<html>
  <head>
    <title>Tomato pasta</title>
    <meta property="og:site_name" content="Example Kitchen">
    <meta property="og:image" content="/cover.jpg">
    <script type="application/ld+json">{"@type":"Recipe","name":"Tomato pasta"}</script>
  </head>
  <body>
    <main>
      <h1>Tomato pasta</h1>
      <p>トマト缶とオリーブオイルで作るパスタです。材料を煮詰めて麺と合わせます。</p>
      <img src="/step.jpg" alt="煮詰める">
    </main>
  </body>
</html>`;

const createUsageRepository = (calls: string[] = []): UsageRepository => ({
  getOrCreateAppUser: async (userId) => {
    calls.push(`ensure:${userId}`);
    return { userId, plan: "free" };
  },
  getAiUsage: async () => null,
  consumeAiUsage: async ({ userId, month, limit }) => {
    calls.push(`consume:${userId}:${month}:${limit}`);
    return { status: "consumed", usage: { month, used: 1 } };
  },
});

describe("Import routes", () => {
  it("URLからRecipeDraftContentとsource metadataを生成する", async () => {
    const usageCalls: string[] = [];
    const providerInputs: unknown[] = [];
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(usageCalls),
      importFetcher: async (url) => ({
        finalUrl: url,
        contentType: "text/html; charset=utf-8",
        html: htmlPage,
      }),
      importAIProvider: {
        normalize: async (input) => {
          providerInputs.push(input);
          return {
            title: "Tomato pasta",
            coverImage: { type: "externalImageUrl", url: "https://example.com/cover.jpg" },
            ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
            steps: [
              {
                text: "煮詰める",
                image: { type: "externalImageUrl", url: "https://example.com/step.jpg" },
              },
            ],
          };
        },
      },
      getCurrentDate: () => new Date("2026-05-15T00:00:00.000Z"),
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com:443/recipes/tomato?utm_source=x#steps",
        }),
      },
      {
        APP_ENV: "development",
        FREE_AI_MONTHLY_LIMIT: "10",
        IMPORT_TIMEOUT_MS: "1000",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recipeDraftContent: {
        title: "Tomato pasta",
        coverImage: { type: "externalImageUrl", url: "https://example.com/cover.jpg" },
        ingredientGroups: [{ ingredients: [{ name: "トマト缶", amount: "1缶" }] }],
        steps: [
          {
            text: "煮詰める",
            image: { type: "externalImageUrl", url: "https://example.com/step.jpg" },
          },
        ],
      },
      source: {
        sourceType: "web",
        sourcePlatform: "other",
        sourceUrl: "https://example.com/recipes/tomato",
        sourceName: "Example Kitchen",
      },
      warnings: [],
    });
    expect(usageCalls).toEqual(["ensure:user_123", "consume:user_123:2026-05:10"]);
    expect(providerInputs).toEqual([
      expect.objectContaining({
        sourceUrl: "https://example.com/recipes/tomato",
        sourceName: "Example Kitchen",
        imageCandidates: expect.arrayContaining([
          expect.objectContaining({ url: "https://example.com/cover.jpg", kind: "cover" }),
          expect.objectContaining({ url: "https://example.com/step.jpg", kind: "content" }),
        ]),
      }),
    ]);
  });

  it("URL形式が不正な場合はinvalid_urlを返す", async () => {
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(),
      importAIProvider: unusedProvider,
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "ftp://example.com/recipe" }),
      },
      { APP_ENV: "development" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_url" },
    });
  });

  it("取得失敗はfetch_failedを返しAI利用回数を消費しない", async () => {
    const usageCalls: string[] = [];
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(usageCalls),
      importAIProvider: unusedProvider,
      importFetcher: async () => {
        throw new RecipeImportError("fetch_failed", "failed");
      },
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/recipe" }),
      },
      { APP_ENV: "development", IMPORT_TIMEOUT_MS: "1000" },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "fetch_failed" },
    });
    expect(usageCalls).toEqual([]);
  });

  it("非HTMLページはunsupported_pageを返しAI利用回数を消費しない", async () => {
    const usageCalls: string[] = [];
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(usageCalls),
      importAIProvider: unusedProvider,
      importFetcher: async (url) => ({
        finalUrl: url,
        contentType: "application/pdf",
        html: "%PDF",
      }),
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/recipe.pdf" }),
      },
      { APP_ENV: "development", IMPORT_TIMEOUT_MS: "1000" },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_page" },
    });
    expect(usageCalls).toEqual([]);
  });

  it("本文候補が不足するHTMLはextraction_failedを返しAI利用回数を消費しない", async () => {
    const usageCalls: string[] = [];
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(usageCalls),
      importAIProvider: unusedProvider,
      importFetcher: async (url) => ({
        finalUrl: url,
        contentType: "text/html",
        html: "<html><body><nav>menu</nav></body></html>",
      }),
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/empty" }),
      },
      { APP_ENV: "development", IMPORT_TIMEOUT_MS: "1000" },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "extraction_failed" },
    });
    expect(usageCalls).toEqual([]);
  });

  it("AI利用上限に達した場合はai_usage_limit_exceededを返す", async () => {
    const testApp = createApp({
      auth,
      usageRepository: {
        ...createUsageRepository(),
        consumeAiUsage: async () => ({ status: "limitExceeded" }),
      },
      importAIProvider: unusedProvider,
      importFetcher: async (url) => ({
        finalUrl: url,
        contentType: "text/html",
        html: htmlPage,
      }),
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/recipe" }),
      },
      { APP_ENV: "development", FREE_AI_MONTHLY_LIMIT: "10", IMPORT_TIMEOUT_MS: "1000" },
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ai_usage_limit_exceeded" },
    });
  });

  it("AIが候補外画像URLを返した場合は画像を落としてwarningを返す", async () => {
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(),
      importFetcher: async (url) => ({
        finalUrl: url,
        contentType: "text/html",
        html: htmlPage,
      }),
      importAIProvider: {
        normalize: async () => ({
          title: "Tomato pasta",
          coverImage: { type: "externalImageUrl", url: "https://cdn.example.net/outside.jpg" },
          ingredientGroups: [],
          steps: [{ text: "煮る" }],
        }),
      },
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/recipe" }),
      },
      { APP_ENV: "development", FREE_AI_MONTHLY_LIMIT: "10", IMPORT_TIMEOUT_MS: "1000" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recipeDraftContent: {
        title: "Tomato pasta",
        ingredientGroups: [],
        steps: [{ text: "煮る" }],
      },
      warnings: [
        "AI returned image URL outside extracted candidates: https://cdn.example.net/outside.jpg",
      ],
    });
  });

  it("AI失敗を段階別エラーに変換する", async () => {
    const cases = [
      { error: new RecipeImportError("ai_timeout", "timeout"), status: 504, code: "ai_timeout" },
      { error: { title: "" }, status: 502, code: "ai_schema_invalid" },
      { error: new Error("boom"), status: 500, code: "unknown" },
    ];

    for (const testCase of cases) {
      const testApp = createApp({
        auth,
        usageRepository: createUsageRepository(),
        importFetcher: async (url) => ({
          finalUrl: url,
          contentType: "text/html",
          html: htmlPage,
        }),
        importAIProvider: {
          normalize: async () => {
            if (testCase.error instanceof Error) {
              throw testCase.error;
            }

            return testCase.error;
          },
        } as unknown as RecipeImportAIProvider,
      });

      const response = await testApp.request(
        "/api/import/url",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://example.com/recipe" }),
        },
        { APP_ENV: "development", FREE_AI_MONTHLY_LIMIT: "10", IMPORT_TIMEOUT_MS: "1000" },
      );

      expect(response.status).toBe(testCase.status);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: testCase.code },
      });
    }
  });
});

const unusedProvider: RecipeImportAIProvider = {
  normalize: async () => {
    throw new Error("should not normalize");
  },
};
