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

  it("対応Adapterのfetch requestを取得して変換する", async () => {
    const convert = vi.fn(async ({ normalizedUrl, page }) => {
      expect(normalizedUrl).toBe(NORMALIZED_URL);
      expect(page).toEqual(createPage("https://www.example.com/canonical"));
      return createResult();
    });
    const extractor = createSourceExtractor([
      createAdapter({
        resolveFetchRequest: () => ({ url: "https://www.example.com/canonical" }),
        convert,
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
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("unsafeな取得URLを拒否する", async () => {
    const fetcher = vi.fn();
    const extractor = createSourceExtractor([
      createAdapter({
        resolveFetchRequest: () => ({ url: "http://127.0.0.1/watch?v=abc123" }),
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
        async convert() {
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
        async convert() {
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
  resolveFetchRequest: ({ normalizedUrl }) => ({ url: normalizedUrl }),
  async convert() {
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
  input: {
    source: {
      finalUrl: "https://www.example.com/watch?v=abc123",
      host: "example.com",
    },
    markdownContent: "# Example",
    recipeStructuredEvidence: [],
  },
  imageCandidates: [],
  source: {
    sourceUrl: "https://www.example.com/watch?v=abc123",
    sourceName: "Example",
  },
  warnings: [],
});
