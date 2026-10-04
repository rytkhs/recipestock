import { type RecipeDraftContent, recipeSourceDraftSchema } from "@recipestock/schemas";
import { z } from "zod";
import { trimRecipeDraftContent } from "../draft-limits";
import { assertFetchedPageIsHtml, assertImportUrlAllowed } from "../policy";
import { RecipeImportError, type RecipeImportFetcher, type RecipeImportResult } from "../types";
import {
  type DeterministicFetchRequest,
  type DeterministicImportAdapter,
  type DeterministicRecipe,
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
    const { recipe, sourceUrl } = await adapter.convert({ normalizedUrl, pages });

    try {
      return {
        recipeDraftContent: trimRecipeDraftContent(toRecipeDraftContent(recipe)),
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
 * まとまりの間は空行で区切る。アプリが書く告知は見出しを付けずにnoteの先頭に置く。
 */
const toRecipeDraftContent = (recipe: DeterministicRecipe): RecipeDraftContent => {
  const note = joinBlocks([recipe.notice, ...formatSections(recipe.noteSections)]);

  return {
    title: recipe.title,
    ...(recipe.yieldText ? { yieldText: recipe.yieldText } : {}),
    ...(recipe.coverImageUrl ? { coverImage: toExternalImage(recipe.coverImageUrl) } : {}),
    referenceImages: [],
    ingredientGroups: recipe.ingredientGroups,
    steps: recipe.steps.map((step) => {
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
