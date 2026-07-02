import { describe, expect, it, vi } from "vitest";
import { type RecipeImportError } from "../types";
import { createSourceExtractor } from "./importer";
import { type SourceExtractionAdapter } from "./types";

const NORMALIZED_URL = "https://www.example.com/watch?v=abc123";
const FETCH_OPTIONS = { timeoutMs: 1000, maxBytes: 1024 };

describe("createSourceExtractor", () => {
  it("対応するAdapterがない場合はfetchせずnullを返す", async () => {
    const match = vi.fn(() => false);
    const fetcher = vi.fn();
    const extractor = createSourceExtractor([createAdapter({ match })]);

    await expect(
      extractor.tryExtract({
        normalizedUrl: NORMALIZED_URL,
        fetcher,
        fetchOptions: FETCH_OPTIONS,
      }),
    ).resolves.toBeNull();

    expect(match).toHaveBeenCalledWith({
      normalizedUrl: NORMALIZED_URL,
      host: "example.com",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("対応Adapterへcontextを渡して変換する", async () => {
    const extract = vi.fn(async ({ normalizedUrl, host, timeoutMs, fetchHtml }) => {
      expect(normalizedUrl).toBe(NORMALIZED_URL);
      expect(host).toBe("example.com");
      expect(timeoutMs).toBe(FETCH_OPTIONS.timeoutMs);
      const page = await fetchHtml("https://www.example.com/canonical");
      expect(page).toEqual(createPage("https://www.example.com/canonical"));
      return createResult();
    });
    const extractor = createSourceExtractor([
      createAdapter({
        extract,
      }),
    ]);
    const fetcher = vi.fn(async (url) => createPage(url));

    await expect(
      extractor.tryExtract({
        normalizedUrl: NORMALIZED_URL,
        fetcher,
        fetchOptions: FETCH_OPTIONS,
      }),
    ).resolves.toEqual(createResult());

    expect(fetcher).toHaveBeenCalledWith("https://www.example.com/canonical", FETCH_OPTIONS);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("ytdlp metadata clientをAdapterのcontextへ渡す", async () => {
    const ytdlpMetadataClient = {
      extract: vi.fn(),
    };
    const extract = vi.fn(async ({ ytdlpMetadataClient: contextClient }) => {
      expect(contextClient).toBe(ytdlpMetadataClient);
      return createResult();
    });
    const extractor = createSourceExtractor([createAdapter({ extract })]);

    await expect(
      extractor.tryExtract({
        normalizedUrl: NORMALIZED_URL,
        fetcher: async (url) => createPage(url),
        fetchOptions: FETCH_OPTIONS,
        ytdlpMetadataClient,
      }),
    ).resolves.toEqual(createResult());

    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("unsafeな取得URLを拒否する", async () => {
    const fetcher = vi.fn();
    const extractor = createSourceExtractor([
      createAdapter({
        async extract({ fetchHtml }) {
          await fetchHtml("http://127.0.0.1/watch?v=abc123");
          return createResult();
        },
      }),
    ]);

    await expect(
      extractor.tryExtract({
        normalizedUrl: NORMALIZED_URL,
        fetcher,
        fetchOptions: FETCH_OPTIONS,
      }),
    ).rejects.toMatchObject({
      code: "invalid_url",
    } satisfies Partial<RecipeImportError>);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("不正なSourceExtractionResultをextraction_failedにする", async () => {
    const extractor = createSourceExtractor([
      createAdapter({
        async extract() {
          return {
            ...createResult(),
            source: {
              sourceUrl: "not-a-url",
              sourceName: "Example",
            },
          };
        },
      }),
    ]);

    await expect(
      extractor.tryExtract({
        normalizedUrl: NORMALIZED_URL,
        fetcher: async (url) => createPage(url),
        fetchOptions: FETCH_OPTIONS,
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("Adapter選択後の変換エラーをそのまま返す", async () => {
    const expectedError = new Error("Site structure changed.");
    const extractor = createSourceExtractor([
      createAdapter({
        async extract() {
          throw expectedError;
        },
      }),
    ]);

    await expect(
      extractor.tryExtract({
        normalizedUrl: NORMALIZED_URL,
        fetcher: async (url) => createPage(url),
        fetchOptions: FETCH_OPTIONS,
      }),
    ).rejects.toBe(expectedError);
  });
});

const createAdapter = (
  overrides: Partial<SourceExtractionAdapter> = {},
): SourceExtractionAdapter => ({
  id: "example",
  match: () => true,
  async extract() {
    return createResult();
  },
  ...overrides,
});

const createPage = (url: string) => ({
  finalUrl: url,
  contentType: "text/html; charset=utf-8",
  body: "<html><body>Recipe</body></html>",
});

const createResult = () => ({
  promptProfile: "social" as const,
  input: {
    source: {
      finalUrl: "https://www.example.com/watch?v=abc123",
      host: "example.com",
    },
    markdownContent: "# Example",
  },
  imageCandidates: [],
  source: {
    sourceUrl: "https://www.example.com/watch?v=abc123",
    sourceName: "Example",
  },
  warnings: [],
});
