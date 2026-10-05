import { type RecipeDraftContent, recipeSourceDraftSchema } from "@recipestock/schemas";
import { z } from "zod";
import { trimRecipeDraftContent } from "../draft-limits";
import { assertFetchedPageIsHtml, assertImportUrlAllowed } from "../policy";
import { RecipeImportError, type RecipeImportFetcher, type RecipeImportResult } from "../types";
import {
  type DeterministicDraftContent,
  type DeterministicFetchRequest,
  type DeterministicImportAdapter,
  type DeterministicTextSection,
} from "./types";

type DeterministicFetchOptions = {
  timeoutMs: number;
  maxBytes: number;
};

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
    const matchInput = { normalizedUrl };
    const adapter = adapters.find((candidate) => candidate.match(matchInput));
    if (!adapter) return null;

    const requests = adapter.resolveFetchRequests(matchInput);
    const pages = await fetchPages(requests, fetcher, fetchOptions);
    const { draftContent, sourceUrl } = await adapter.convert({ normalizedUrl, pages });

    try {
      return {
        recipeDraftContent: trimRecipeDraftContent(toRecipeDraftContent(draftContent)),
        source: recipeSourceDraftSchema.parse({ sourceUrl, sourceName: adapter.sourceName }),
      };
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

/**
 * 手順の補足とnoteは、どのサイトでも同じ書式にする。まとまりごとに見出しの行と本文で書き、
 * まとまりの間は空行で区切る。本文が空のまとまりは書かない。アプリが書く告知は見出しを付けずに
 * noteの先頭に置く。
 */
const toRecipeDraftContent = (content: DeterministicDraftContent): RecipeDraftContent => {
  const note = joinBlocks([content.notice, ...formatSections(content.noteSections)]);

  return {
    title: content.title,
    ...(content.yieldText ? { yieldText: content.yieldText } : {}),
    ...(content.coverImageUrl ? { coverImage: toExternalImage(content.coverImageUrl) } : {}),
    referenceImages: [],
    ingredientGroups: content.ingredientGroups,
    steps: content.steps.map((step) => {
      const text = joinBlocks([step.text, ...formatSections(step.supplements)]);
      return {
        ...(text ? { text } : {}),
        images: step.imageUrls.map(toExternalImage),
      };
    }),
    ...(note ? { note } : {}),
  };
};

const formatSections = (sections: readonly DeterministicTextSection[] = []) =>
  sections
    .filter((section) => section.body)
    .map((section) => `${section.heading}\n${section.body}`);

const joinBlocks = (blocks: ReadonlyArray<string | undefined>) =>
  blocks.filter(Boolean).join("\n\n");

const toExternalImage = (url: string) => ({ type: "externalImageUrl" as const, url });

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
      await assertFetchedPageIsHtml(page);

      return [request.id, page] as const;
    }),
  );

  return new Map(fetchedPages);
};
