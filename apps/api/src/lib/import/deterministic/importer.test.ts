import {
  MAX_RECIPE_SOURCE_MEDIA_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_TOTAL_IMAGES,
} from "@recipestock/schemas";
import { describe, expect, it, vi } from "vitest";
import { type RecipeImportError } from "../types";
import { createDeterministicImporter } from "./importer";
import { type DeterministicImportAdapter } from "./types";

const NORMALIZED_URL = "https://www.example.com/recipes/test";
const FETCH_OPTIONS = { timeoutMs: 1000, maxBytes: 1024 };

describe("createDeterministicImporter", () => {
  it("対応するAdapterがない場合はfetchせずnullを返す", async () => {
    const match = vi.fn(() => false);
    const fetcher = vi.fn();
    const importer = createDeterministicImporter([
      createAdapter({
        match,
      }),
    ]);

    await expect(
      importer.tryImport({
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

  it("宣言された全ページを並列取得してAdapterへ渡す", async () => {
    const fetchedUrls: string[] = [];
    const resolvers = new Map<string, (page: ReturnType<typeof createPage>) => void>();
    const convert = vi.fn(async ({ normalizedUrl, pages }) => {
      expect(normalizedUrl).toBe(NORMALIZED_URL);
      expect(pages.get("recipe")).toEqual(createPage(NORMALIZED_URL));
      expect(pages.get("print")).toEqual(createPage(`${NORMALIZED_URL}/print`));
      return createResult();
    });
    const importer = createDeterministicImporter([
      createAdapter({
        resolveFetchRequests: () => [
          { id: "recipe", url: NORMALIZED_URL },
          { id: "print", url: `${NORMALIZED_URL}/print` },
        ],
        convert,
      }),
    ]);

    const importPromise = importer.tryImport({
      normalizedUrl: NORMALIZED_URL,
      fetcher: (url) => {
        fetchedUrls.push(url);
        return new Promise((resolve) => resolvers.set(url, resolve));
      },
      fetchOptions: FETCH_OPTIONS,
    });

    await vi.waitFor(() => expect(fetchedUrls).toHaveLength(2));
    resolvers.get(NORMALIZED_URL)?.(createPage(NORMALIZED_URL));
    resolvers.get(`${NORMALIZED_URL}/print`)?.(createPage(`${NORMALIZED_URL}/print`));

    await expect(importPromise).resolves.toEqual(createResult());
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "空のrequest ID",
      requests: [{ id: "", url: NORMALIZED_URL }],
    },
    {
      name: "重複したrequest ID",
      requests: [
        { id: "recipe", url: NORMALIZED_URL },
        { id: "recipe", url: `${NORMALIZED_URL}/print` },
      ],
    },
    {
      name: "空の取得計画",
      requests: [],
    },
  ])("$nameを拒否する", async ({ requests }) => {
    const fetcher = vi.fn();
    const importer = createDeterministicImporter([
      createAdapter({ resolveFetchRequests: () => requests }),
    ]);

    await expect(
      importer.tryImport({
        normalizedUrl: NORMALIZED_URL,
        fetcher,
        fetchOptions: FETCH_OPTIONS,
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("unsafeな取得URLを拒否する", async () => {
    const fetcher = vi.fn();
    const importer = createDeterministicImporter([
      createAdapter({
        resolveFetchRequests: () => [{ id: "recipe", url: "http://127.0.0.1/recipe" }],
      }),
    ]);

    await expect(
      importer.tryImport({
        normalizedUrl: NORMALIZED_URL,
        fetcher,
        fetchOptions: FETCH_OPTIONS,
      }),
    ).rejects.toMatchObject({
      code: "invalid_url",
    } satisfies Partial<RecipeImportError>);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("取得ページがHTMLでなければ変換しない", async () => {
    const convert = vi.fn();
    const importer = createDeterministicImporter([createAdapter({ convert })]);

    await expect(
      importer.tryImport({
        normalizedUrl: NORMALIZED_URL,
        fetcher: async (url) => ({
          finalUrl: url,
          contentType: "application/json",
          body: "{}",
        }),
        fetchOptions: FETCH_OPTIONS,
      }),
    ).rejects.toMatchObject({
      code: "unsupported_page",
    } satisfies Partial<RecipeImportError>);

    expect(convert).not.toHaveBeenCalled();
  });

  it("不正なRecipeDraftContentをextraction_failedにする", async () => {
    const importer = createDeterministicImporter([
      createAdapter({
        async convert() {
          return {
            recipeDraftContent: {
              title: "",
              sourceMedia: [],
              ingredientGroups: [],
              steps: [],
            },
            source: {
              sourceUrl: NORMALIZED_URL,
              sourceName: "Example",
            },
            warnings: [],
          };
        },
      }),
    ]);

    await expect(
      importer.tryImport({
        normalizedUrl: NORMALIZED_URL,
        fetcher: async (url) => createPage(url),
        fetchOptions: FETCH_OPTIONS,
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("画像上限を超えたAdapter結果は切り詰めて返す", async () => {
    const importer = createDeterministicImporter([
      createAdapter({
        async convert() {
          return {
            recipeDraftContent: {
              title: "Tomato soup",
              coverImage: createDraftImage("cover"),
              sourceMedia: createDraftImages(MAX_RECIPE_SOURCE_MEDIA_IMAGES + 1, "source"),
              ingredientGroups: [],
              steps: createStepsWithImages(
                MAX_RECIPE_TOTAL_IMAGES - MAX_RECIPE_SOURCE_MEDIA_IMAGES,
              ),
            },
            source: {
              sourceUrl: NORMALIZED_URL,
              sourceName: "Example",
            },
            warnings: [],
          };
        },
      }),
    ]);

    const result = await importer.tryImport({
      normalizedUrl: NORMALIZED_URL,
      fetcher: async (url) => createPage(url),
      fetchOptions: FETCH_OPTIONS,
    });

    expect(result?.recipeDraftContent.sourceMedia).toEqual(
      createDraftImages(MAX_RECIPE_SOURCE_MEDIA_IMAGES, "source"),
    );
    expect(
      result?.recipeDraftContent.steps.every(
        (step) => step.images.length <= MAX_RECIPE_STEP_IMAGES,
      ),
    ).toBe(true);
    expect(countDraftImages(result?.recipeDraftContent)).toBe(MAX_RECIPE_TOTAL_IMAGES);
  });

  it("Adapter選択後の変換エラーをそのまま返す", async () => {
    const expectedError = new Error("Site structure changed.");
    const importer = createDeterministicImporter([
      createAdapter({
        async convert() {
          throw expectedError;
        },
      }),
    ]);

    await expect(
      importer.tryImport({
        normalizedUrl: NORMALIZED_URL,
        fetcher: async (url) => createPage(url),
        fetchOptions: FETCH_OPTIONS,
      }),
    ).rejects.toBe(expectedError);
  });
});

const createAdapter = (
  overrides: Partial<DeterministicImportAdapter> = {},
): DeterministicImportAdapter => ({
  id: "example",
  match: () => true,
  resolveFetchRequests: ({ normalizedUrl }) => [{ id: "recipe", url: normalizedUrl }],
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
  recipeDraftContent: {
    title: "Tomato soup",
    sourceMedia: [],
    ingredientGroups: [{ ingredients: [{ name: "Tomato", amount: "1" }] }],
    steps: [{ text: "Cook.", images: [] }],
  },
  source: {
    sourceUrl: NORMALIZED_URL,
    sourceName: "Example",
  },
  warnings: [],
});

const createDraftImage = (id: string) => ({
  type: "externalImageUrl" as const,
  url: `https://images.example/${id}.jpg`,
});

const createDraftImages = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => createDraftImage(`${prefix}-${index}`));

const createStepsWithImages = (imageCount: number) =>
  Array.from({ length: Math.ceil(imageCount / MAX_RECIPE_STEP_IMAGES) }, (_, stepIndex) => ({
    text: `Step ${stepIndex + 1}`,
    images: createDraftImages(MAX_RECIPE_STEP_IMAGES + 1, `step-${stepIndex}`),
  }));

const countDraftImages = (
  content:
    | {
        sourceMedia?: unknown[];
        steps?: { images?: unknown[] }[];
      }
    | undefined,
) =>
  (content?.sourceMedia?.length ?? 0) +
  (content?.steps ?? []).reduce((count, step) => count + (step.images?.length ?? 0), 0);
