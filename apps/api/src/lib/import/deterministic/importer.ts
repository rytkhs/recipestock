import { recipeDraftContentSchema, recipeSourceDraftSchema } from "@recipestock/schemas";
import { z } from "zod";
import { assertFetchedPageIsHtml, assertImportUrlAllowed } from "../policy";
import { RecipeImportError, type RecipeImportFetcher, type RecipeImportResult } from "../types";
import { type DeterministicFetchRequest, type DeterministicImportAdapter } from "./types";

type DeterministicFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
};

const deterministicImportResultSchema = z.object({
  recipeDraftContent: recipeDraftContentSchema,
  source: recipeSourceDraftSchema,
  warnings: z.array(z.string()),
});

export type DeterministicImporter = {
  tryImport(input: {
    normalizedUrl: string;
    fetcher: RecipeImportFetcher;
    fetchOptions: DeterministicFetchOptions;
  }): Promise<RecipeImportResult | null>;
};

export const createDeterministicImporter = (
  adapters: readonly DeterministicImportAdapter[] = [],
): DeterministicImporter => ({
  async tryImport({ normalizedUrl, fetcher, fetchOptions }) {
    const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");
    const matchInput = { normalizedUrl, host };
    const adapter = adapters.find((candidate) => candidate.match(matchInput));
    if (!adapter) return null;

    const requests = adapter.resolveFetchRequests(matchInput);
    const pages = await fetchPages(requests, fetcher, fetchOptions);
    const result = await adapter.convert({ normalizedUrl, pages });

    try {
      return deterministicImportResultSchema.parse(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new RecipeImportError(
          "extraction_failed",
          "Deterministic import result was invalid.",
        );
      }

      throw error;
    }
  },
});

const fetchPages = async (
  requests: readonly DeterministicFetchRequest[],
  fetcher: RecipeImportFetcher,
  options: DeterministicFetchOptions,
) => {
  if (requests.length === 0) {
    throw new RecipeImportError(
      "extraction_failed",
      "Deterministic import adapter did not declare any pages.",
    );
  }

  const requestIds = new Set<string>();
  for (const request of requests) {
    if (!request.id || requestIds.has(request.id)) {
      throw new RecipeImportError(
        "extraction_failed",
        "Deterministic import adapter declared duplicate page IDs.",
      );
    }
    requestIds.add(request.id);
    assertImportUrlAllowed(request.url);
  }

  const fetchedPages = await Promise.all(
    requests.map(async (request) => {
      const page = await fetcher(request.url, options);
      assertFetchedPageIsHtml(page);

      return [request.id, page] as const;
    }),
  );

  return new Map(fetchedPages);
};
