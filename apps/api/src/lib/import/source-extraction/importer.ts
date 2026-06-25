import { assertFetchedPageIsHtml, assertImportUrlAllowed } from "../policy";
import { RecipeImportError, type RecipeImportFetcher } from "../types";
import {
  parseSourceExtractionResult,
  type SourceExtractionAdapter,
  type SourceExtractionResult,
} from "./types";

type SourceExtractionFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
};

export type SourceExtractor = {
  tryExtract(input: {
    normalizedUrl: string;
    fetcher: RecipeImportFetcher;
    fetchOptions: SourceExtractionFetchOptions;
  }): Promise<SourceExtractionResult | null>;
};

export const createSourceExtractor = (
  adapters: readonly SourceExtractionAdapter[] = [],
): SourceExtractor => ({
  async tryExtract({ normalizedUrl, fetcher, fetchOptions }) {
    const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");
    const matchInput = { normalizedUrl, host };
    const adapter = adapters.find((candidate) => candidate.match(matchInput));
    if (!adapter) return null;

    const request = adapter.resolveFetchRequest(matchInput);
    assertImportUrlAllowed(request.url);

    const page = await fetcher(request.url, fetchOptions);
    await assertFetchedPageIsHtml(page);
    const result = await adapter.convert({ normalizedUrl, page });

    try {
      return parseSourceExtractionResult(result);
    } catch (error) {
      if (error instanceof RecipeImportError) {
        throw error;
      }

      throw new RecipeImportError("extraction_failed", "Source extraction result was invalid.");
    }
  },
});
