import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchImportPage, type RecipeImportAIProvider, RecipeImportError } from "../import-url";
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("URLからRecipeDraftContentとsource metadataを生成する", async () => {
    const usageCalls: string[] = [];
    const providerInputs: unknown[] = [];
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(usageCalls),
      importFetcher: async (url) => ({
        finalUrl: url,
        contentType: "text/html; charset=utf-8",
        body: htmlPage,
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
        source: {
          finalUrl: "https://example.com/recipes/tomato",
          host: "example.com",
        },
        metadataCandidates: expect.arrayContaining([
          { kind: "htmlTitle", value: "Tomato pasta" },
          { kind: "h1", value: "Tomato pasta" },
          { kind: "siteName", value: "Example Kitchen" },
          { kind: "jsonLdRecipeName", value: "Tomato pasta" },
        ]),
        structuredContent: expect.stringContaining("<h1>Tomato pasta</h1>"),
        jsonLdDocuments: ['{"@type":"Recipe","name":"Tomato pasta"}'],
        imageCandidates: expect.arrayContaining([
          expect.objectContaining({
            id: "img_1",
            url: "https://example.com/cover.jpg",
            kindHint: "cover",
          }),
          expect.objectContaining({
            id: "img_2",
            url: "https://example.com/step.jpg",
            kindHint: "content",
          }),
        ]),
      }),
    ]);
  });

  it("HTMLRewriterで属性順に依存せずmetadataと本文候補を抽出する", async () => {
    const providerInputs: unknown[] = [];
    const htmlWithReorderedAttributes = `<!doctype html>
<html>
  <head>
    <title> Chunky soup </title>
    <meta content="Swapped Kitchen" property="og:site_name">
    <meta content="具だくさんスープの説明です。" name="description">
    <meta content="/images/cover.jpg" property="og:image">
    <script type="application/ld+json">
      {"@type":"Recipe","name":"Chunky soup"}
    </script>
    <script>const noise = "このscript本文は混ざらない";</script>
    <style>.noise::before { content: "このstyle本文も混ざらない"; }</style>
  </head>
  <body>
    <main>
      <h2>材料</h2>
      <ul>
        <li>玉ねぎ 1個</li>
        <li>にんじん 1本</li>
      </ul>
      <p>玉ねぎとにんじんを炒めて、スープでじっくり煮込みます。仕上げに塩で味を調えます。</p>
      <img data-src="../steps/simmer.jpg" alt="煮込む">
    </main>
  </body>
</html>`;

    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(),
      importFetcher: async () => ({
        finalUrl: "https://example.com/recipes/soup/index.html",
        contentType: "text/html",
        body: htmlWithReorderedAttributes,
      }),
      importAIProvider: {
        normalize: async (input) => {
          providerInputs.push(input);
          return {
            title: "Chunky soup",
            ingredientGroups: [],
            steps: [{ text: "煮込む" }],
          };
        },
      },
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/recipes/soup" }),
      },
      { APP_ENV: "development", FREE_AI_MONTHLY_LIMIT: "10", IMPORT_TIMEOUT_MS: "1000" },
    );

    expect(response.status).toBe(200);
    expect(providerInputs).toEqual([
      expect.objectContaining({
        source: {
          finalUrl: "https://example.com/recipes/soup/index.html",
          host: "example.com",
        },
        metadataCandidates: expect.arrayContaining([
          { kind: "htmlTitle", value: "Chunky soup" },
          { kind: "metaDescription", value: "具だくさんスープの説明です。" },
          { kind: "siteName", value: "Swapped Kitchen" },
          { kind: "jsonLdRecipeName", value: "Chunky soup" },
        ]),
        jsonLdDocuments: ['{"@type":"Recipe","name":"Chunky soup"}'],
        imageCandidates: expect.arrayContaining([
          expect.objectContaining({
            id: "img_1",
            url: "https://example.com/images/cover.jpg",
            kindHint: "cover",
          }),
          expect.objectContaining({
            id: "img_2",
            url: "https://example.com/recipes/steps/simmer.jpg",
            kindHint: "content",
            alt: "煮込む",
            nearbyText:
              "玉ねぎとにんじんを炒めて、スープでじっくり煮込みます。仕上げに塩で味を調えます。",
          }),
        ]),
      }),
    ]);
    const [providerInput] = providerInputs as [{ structuredContent: string }];
    expect(providerInput.structuredContent).toContain("<main>");
    expect(providerInput.structuredContent).toContain("<h2>材料</h2>");
    expect(providerInput.structuredContent).toContain("<ul>");
    expect(providerInput.structuredContent).toContain("<li>玉ねぎ 1個</li>");
    expect(providerInput.structuredContent).toContain(
      "<p>玉ねぎとにんじんを炒めて、スープでじっくり煮込みます。仕上げに塩で味を調えます。</p>",
    );
    expect(providerInput.structuredContent).toContain('<img data-image-id="img_2" alt="煮込む">');
    expect(providerInput.structuredContent).not.toContain("このscript本文は混ざらない");
    expect(providerInput.structuredContent).not.toContain("このstyle本文も混ざらない");
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
        body: "%PDF",
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
        body: "<html><body><nav>menu</nav></body></html>",
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

  it("HTMLサイズ上限を超えたページはunsupported_pageを返しAI利用回数を消費しない", async () => {
    const usageCalls: string[] = [];
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(usageCalls),
      importAIProvider: unusedProvider,
      importFetcher: async (url, { maxBytes }) => {
        if (new TextEncoder().encode(htmlPage).byteLength > maxBytes) {
          throw new RecipeImportError("unsupported_page", "too large");
        }

        return {
          finalUrl: url,
          contentType: "text/html",
          body: htmlPage,
        };
      },
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/recipe" }),
      },
      {
        APP_ENV: "development",
        IMPORT_TIMEOUT_MS: "1000",
        IMPORT_MAX_HTML_BYTES: "10",
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_page" },
    });
    expect(usageCalls).toEqual([]);
  });

  it("取得したHTML本文がサイズ上限を超えた場合はunsupported_pageにする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(htmlPage, { headers: { "content-type": "text/html" } })),
    );

    await expect(
      fetchImportPage("https://example.com/recipe", { timeoutMs: 1000, maxBytes: 10 }),
    ).rejects.toMatchObject({
      code: "unsupported_page",
    });
  });

  it("content-lengthがサイズ上限を超える場合は本文を読まずにunsupported_pageにする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(htmlPage, {
            headers: { "content-type": "text/html", "content-length": "100" },
          }),
      ),
    );

    await expect(
      fetchImportPage("https://example.com/recipe", { timeoutMs: 1000, maxBytes: 10 }),
    ).rejects.toMatchObject({
      code: "unsupported_page",
    });
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
        body: htmlPage,
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
        body: htmlPage,
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

  it("AIがCookpadレスポンス相当のRecipeDraftContentを返した場合は成功する", async () => {
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(),
      importFetcher: async () => ({
        finalUrl: "https://cookpad.com/jp/recipes/25844291",
        contentType: "text/html",
        body: `<!doctype html>
<html>
  <head>
    <title>簡単ノンフライヤーで揚げポテト（お弁当）</title>
    <meta property="og:site_name" content="Cookpad">
    <meta property="og:image" content="https://og-image.cookpad.com/global/jp/recipe/25844291?t=1780359344">
  </head>
  <body>
    <main>
      <p>じゃがいもを使ったノンフライヤーの揚げポテトです。お弁当にも使える一品です。</p>
      <img src="https://img-global-jp.cpcdn.com/steps/15457bb8e196264d/160x128cq80/step-1.jpg" alt="作り方1写真">
    </main>
  </body>
</html>`,
      }),
      importAIProvider: {
        normalize: async () => ({
          title: "簡単ノンフライヤーで揚げポテト（お弁当）",
          coverImage: {
            type: "externalImageUrl",
            url: "https://og-image.cookpad.com/global/jp/recipe/25844291?t=1780359344",
          },
          ingredientGroups: [],
          steps: [
            {
              text: "じゃがいもを皮付きで食べやすい大きさにカットし、面取りする。",
              image: {
                type: "externalImageUrl",
                url: "https://img-global-jp.cpcdn.com/steps/15457bb8e196264d/160x128cq80/step-1.jpg",
              },
            },
            {
              text: "数分水にさらしてアク抜きし、キッチンペーパーで水気を取る。",
            },
          ],
          note: "面取りをすると、コロンと美味しそうに仕上がります。",
        }),
      },
    });

    const response = await testApp.request(
      "/api/import/url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://cookpad.com/jp/recipes/25844291" }),
      },
      { APP_ENV: "development", FREE_AI_MONTHLY_LIMIT: "10", IMPORT_TIMEOUT_MS: "1000" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recipeDraftContent: {
        title: "簡単ノンフライヤーで揚げポテト（お弁当）",
        ingredientGroups: [],
        steps: [
          {
            text: "じゃがいもを皮付きで食べやすい大きさにカットし、面取りする。",
          },
          {
            text: "数分水にさらしてアク抜きし、キッチンペーパーで水気を取る。",
          },
        ],
      },
    });
  });

  it("AIが候補外画像だけの手順を返した場合はai_schema_invalidを返す", async () => {
    const testApp = createApp({
      auth,
      usageRepository: createUsageRepository(),
      importFetcher: async (url) => ({
        finalUrl: url,
        contentType: "text/html",
        body: htmlPage,
      }),
      importAIProvider: {
        normalize: async () => ({
          title: "Tomato pasta",
          ingredientGroups: [],
          steps: [
            {
              image: { type: "externalImageUrl", url: "https://cdn.example.net/outside.jpg" },
            },
          ],
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

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ai_schema_invalid" },
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
          body: htmlPage,
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
