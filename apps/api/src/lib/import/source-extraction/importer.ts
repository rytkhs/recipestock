import { type YtDlpMetadataClient } from "../../../ytdlp-metadata";
import { assertFetchedPageIsHtml, assertImportUrlAllowed } from "../policy";
import { RecipeImportError, type RecipeImportFetcher } from "../types";
import {
  parseSourceExtractionResult,
  type SourceExtractionAdapter,
  type SourceExtractionContext,
  type SourceExtractionResult,
} from "./types";
import { type YouTubeDataClient } from "./youtube-data";

type SourceExtractionFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
};

export type SourceExtractor = {
  tryExtract(input: {
    normalizedUrl: string;
    fetcher: RecipeImportFetcher;
    fetchOptions: SourceExtractionFetchOptions;
    ytdlpMetadataClient?: YtDlpMetadataClient;
    youtubeDataClient?: YouTubeDataClient;
  }): Promise<SourceExtractionResult | null>;
};

export const createSourceExtractor = (
  adapters: readonly SourceExtractionAdapter[] = [],
): SourceExtractor => ({
  async tryExtract({
    normalizedUrl,
    fetcher,
    fetchOptions,
    ytdlpMetadataClient,
    youtubeDataClient,
  }) {
    const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");
    const matchInput = { normalizedUrl, host };
    const adapter = adapters.find((candidate) => candidate.match(matchInput));
    if (!adapter) return null;

    const context: SourceExtractionContext = {
      normalizedUrl,
      host,
      timeoutMs: fetchOptions.timeoutMs,
      ytdlpMetadataClient,
      youtubeDataClient,
      async fetchHtml(url) {
        assertImportUrlAllowed(url);
        const page = await fetcher(url, fetchOptions);
        await assertFetchedPageIsHtml(page);
        return page;
      },
    };
    const result = await adapter.extract(context);

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
