import { type RecipeDraftContent, type RecipeSourceDraft } from "@recipestock/schemas";
import { normalizeUrl } from "@recipestock/shared";
import { z } from "zod";
import { type Bindings, type BrowserRunBinding } from "./env";
import { extractRecipePageEvidence } from "./import-page-evidence";
import { normalizeRecipeWithAi } from "./lib/import/ai-normalization";
import { assertImportJobDeadline, resolveBoundedTimeoutMs } from "./lib/import/deadline";
import {
  type DeterministicImporter,
  defaultDeterministicImporter,
} from "./lib/import/deterministic";
import { trimRecipeDraftContent } from "./lib/import/draft-limits";
import {
  assertFetchedPageIsHtml,
  assertImportContentTypeMayBeHtml,
  assertImportUrlAllowed,
} from "./lib/import/policy";
import { defaultSourceExtractor, type SourceExtractor } from "./lib/import/source-extraction";
import {
  createYouTubeDataClient,
  type YouTubeDataClient,
} from "./lib/import/source-extraction/youtube-data";
import {
  type FetchedImportPage,
  type ImportErrorCode,
  type RecipeImportAIDraftContent,
  type RecipeImportAIImageUrl,
  type RecipeImportAINormalizeRequest,
  type RecipeImportAIProvider,
  RecipeImportError,
  type RecipeImportFetcher,
  type RecipeImportGenericAIInput,
  type RecipeImportImageCandidate,
  type RecipeImportImagePlacement,
  type RecipeImportResult,
  type RecipeImportUrlAINormalizeRequest,
} from "./lib/import/types";
import { createLogger, type Logger } from "./logger";
import { type AiUsageConsumptionRepository } from "./usage";

export { assertImportUrlAllowed } from "./lib/import/policy";
export {
  type FetchedImportPage,
  type ImportErrorCode,
  type RecipeImportAIDraftContent,
  type RecipeImportAIImageUrl,
  type RecipeImportAIInput,
  type RecipeImportAINormalizeRequest,
  type RecipeImportAIProvider,
  RecipeImportError,
  type RecipeImportFetcher,
  type RecipeImportGenericAIInput,
  type RecipeImportImageCandidate,
  type RecipeImportPromptProfile,
  type RecipeImportResult,
  type RecipeImportSocialAIInput,
  type RecipeImportStructuredEvidence,
  type RecipeImportUrlAINormalizeRequest,
} from "./lib/import/types";

type RecipeImportConverterResult = {
  type: "requiresAi";
  imageCandidates: RecipeImportImageCandidate[];
  imagePlacement?: RecipeImportImagePlacement;
  titleFallbackCandidates?: string[];
  source: RecipeSourceDraft;
  warnings: string[];
} & RecipeImportUrlAINormalizeRequest;

type ResolvedTitleRecipeImportAIDraftContent = RecipeImportAIDraftContent & {
  title: string;
};

const MAX_IMPORT_PAGE_REDIRECTS = 5;
const MAX_BROWSER_RUN_GOTO_TIMEOUT_MS = 60_000;
const DEFAULT_IMPORT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125.0.0.0 Safari/537.36";
const DEFAULT_IMPORT_FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.9,en;q=0.8",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
  "user-agent": DEFAULT_IMPORT_USER_AGENT,
};

const browserRunContentResponseSchema = z.object({
  success: z.literal(true),
  result: z.string(),
});

export const fetchImportPage: RecipeImportFetcher = async (url, { timeoutMs, maxBytes }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { finalUrl, response } = await fetchImportPageFollowingAllowedRedirects(
      url,
      controller.signal,
    );

    if (!response.ok) {
      throw new RecipeImportError("fetch_failed", "Import URL could not be fetched.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    assertImportContentTypeMayBeHtml(contentType);
    assertContentLengthAllowed(response, maxBytes);

    const page = {
      finalUrl,
      contentType,
      body: await readResponseTextWithLimit(response, maxBytes),
    };
    await assertFetchedPageIsHtml(page);

    return page;
  } catch (error) {
    if (error instanceof RecipeImportError) {
      throw error;
    }

    throw new RecipeImportError("fetch_failed", "Import URL could not be fetched.");
  } finally {
    clearTimeout(timeout);
  }
};

const createBrowserRunImportFetcher =
  (browser: BrowserRunBinding): RecipeImportFetcher =>
  async (url, { timeoutMs, maxBytes }) => {
    assertImportUrlAllowed(url);

    try {
      const response = await browser.quickAction("content", {
        url,
        gotoOptions: {
          timeout: Math.min(timeoutMs, MAX_BROWSER_RUN_GOTO_TIMEOUT_MS),
          waitUntil: "networkidle2",
        },
        userAgent: DEFAULT_IMPORT_USER_AGENT,
      });

      if (!(response instanceof Response) || !response.ok) {
        throw new RecipeImportError("fetch_failed", "Import URL could not be fetched.");
      }

      const payload = browserRunContentResponseSchema.parse(await response.json());
      assertTextByteLengthAllowed(payload.result, maxBytes);

      return {
        finalUrl: url,
        contentType: "text/html",
        body: payload.result,
      };
    } catch (error) {
      if (error instanceof RecipeImportError) {
        throw error;
      }

      throw new RecipeImportError("fetch_failed", "Import URL could not be fetched.");
    }
  };

const fetchImportPageFollowingAllowedRedirects = async (sourceUrl: string, signal: AbortSignal) => {
  let currentUrl = sourceUrl;

  for (let redirectCount = 0; redirectCount <= MAX_IMPORT_PAGE_REDIRECTS; redirectCount++) {
    assertImportUrlAllowed(currentUrl);

    const response = await fetch(currentUrl, {
      headers: DEFAULT_IMPORT_FETCH_HEADERS,
      redirect: "manual",
      signal,
    });

    if (!isRedirectStatus(response.status)) {
      if (response.url) {
        assertImportUrlAllowed(response.url);
      }

      return {
        finalUrl: response.url || currentUrl,
        response,
      };
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new RecipeImportError("fetch_failed", "Import URL redirect location was missing.");
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new RecipeImportError("fetch_failed", "Import URL had too many redirects.");
};

const isRedirectStatus = (status: number) =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

export const normalizeImportableUrl = (rawUrl: string) => {
  try {
    const normalizedUrl = normalizeUrl(rawUrl);
    assertImportUrlAllowed(normalizedUrl);
    return normalizedUrl;
  } catch {
    throw new RecipeImportError("invalid_url", "Import URL is invalid.");
  }
};

const convertFetchedHtmlPage = async (
  page: FetchedImportPage,
): Promise<RecipeImportConverterResult> => {
  await assertFetchedPageIsHtml(page);

  const normalizedFinalUrl = normalizeUrl(page.finalUrl);
  const finalHost = new URL(normalizedFinalUrl).hostname.replace(/^www\./, "");
  const evidence = await extractRecipePageEvidence(page, normalizedFinalUrl);
  const sourceName = evidence.meta["og:site_name"] ?? finalHost;

  if (evidence.markdownContent.length < 20 && !hasDescriptionMetadata(evidence.meta)) {
    throw new RecipeImportError("extraction_failed", "Recipe text could not be extracted.");
  }

  const input: RecipeImportGenericAIInput = {
    source: {
      finalUrl: normalizedFinalUrl,
      host: finalHost,
    },
    markdownContent: evidence.markdownContent,
    recipeStructuredEvidence: evidence.recipeStructuredEvidence,
  };

  return {
    type: "requiresAi",
    promptProfile: "generic",
    input,
    imageCandidates: evidence.imageCandidates,
    titleFallbackCandidates: [
      evidence.meta["og:title"],
      evidence.meta["twitter:title"],
      evidence.title,
    ].filter((candidate): candidate is string => Boolean(candidate)),
    source: {
      sourceUrl: normalizedFinalUrl,
      sourceName,
    },
    warnings: [],
  };
};

const hasDescriptionMetadata = (meta: Record<string, string | undefined>) =>
  Boolean(meta.description || meta["og:description"] || meta["twitter:description"]);

export const importRecipeFromUrl = async ({
  rawUrl,
  userId,
  env,
  usageRepository,
  aiProvider,
  fetcher,
  youtubeDataClient,
  deterministicImporter = defaultDeterministicImporter,
  sourceExtractor = defaultSourceExtractor,
  now = new Date(),
  deadline,
  getCurrentDate,
  logger = createLogger(),
}: {
  rawUrl: string;
  userId: string;
  env: Partial<Bindings>;
  usageRepository: AiUsageConsumptionRepository;
  aiProvider?: RecipeImportAIProvider;
  fetcher?: RecipeImportFetcher;
  youtubeDataClient?: YouTubeDataClient;
  deterministicImporter?: DeterministicImporter;
  sourceExtractor?: SourceExtractor;
  now?: Date;
  deadline?: Date;
  getCurrentDate?: () => Date;
  logger?: Logger;
}): Promise<RecipeImportResult> => {
  const currentDate = () => getCurrentDate?.() ?? new Date();
  assertImportJobDeadline(deadline, currentDate());
  const normalizedUrl = normalizeImportableUrl(rawUrl);
  const deterministicFetchOptions = {
    timeoutMs: resolveBoundedTimeoutMs(resolveImportTimeoutMs(env), deadline, currentDate()),
    maxBytes: resolveImportMaxHtmlBytes(env),
  };
  const deterministicFetcher = fetcher ?? fetchImportPage;
  const deterministicResult = await deterministicImporter.tryImport({
    normalizedUrl,
    fetcher: deterministicFetcher,
    fetchOptions: deterministicFetchOptions,
  });
  assertImportJobDeadline(deadline, currentDate());
  if (deterministicResult) return deterministicResult;

  const fetchOptions = {
    timeoutMs: resolveBoundedTimeoutMs(resolveImportTimeoutMs(env), deadline, currentDate()),
    maxBytes: resolveImportMaxHtmlBytes(env),
  };
  const sourceExtractionResult = await sourceExtractor.tryExtract({
    normalizedUrl,
    fetcher: deterministicFetcher,
    fetchOptions,
    youtubeDataClient: youtubeDataClient ?? resolveYouTubeDataClient(env),
  });
  assertImportJobDeadline(deadline, currentDate());
  const conversion = sourceExtractionResult
    ? {
        type: "requiresAi" as const,
        ...sourceExtractionResult,
      }
    : undefined;
  const importFetcher = fetcher ?? resolveImportFetcher(env);
  const genericConversion = async () => {
    const page = await importFetcher(normalizedUrl, fetchOptions);
    assertImportJobDeadline(deadline, currentDate());
    return convertFetchedHtmlPage(page);
  };
  const resolvedConversion = conversion ?? (await genericConversion());
  assertImportJobDeadline(deadline, currentDate());

  const normalizeRequest: RecipeImportAINormalizeRequest =
    resolvedConversion.promptProfile === "generic"
      ? { promptProfile: "generic", input: resolvedConversion.input }
      : { promptProfile: "social", input: resolvedConversion.input };
  const draft = await normalizeRecipeWithAi({
    request: normalizeRequest,
    userId,
    env,
    usageRepository,
    aiProvider,
    now,
    deadline,
    getCurrentDate,
    logger,
  });

  let imageResult: { draft: RecipeDraftContent; warnings: string[] };

  try {
    imageResult = resolveDraftImageUrls(
      {
        ...draft,
        title: resolveImportDraftTitle(draft.title, resolvedConversion),
      },
      resolvedConversion.imageCandidates,
    );
    imageResult = {
      draft: applyDeterministicImagePlacement(imageResult.draft, resolvedConversion.imagePlacement),
      warnings: imageResult.warnings,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new RecipeImportError("ai_schema_invalid", "AI response schema was invalid.");
    }

    throw new RecipeImportError("unknown" as ImportErrorCode, "AI normalization failed.");
  }

  return {
    recipeDraftContent: imageResult.draft,
    source: resolvedConversion.source,
    warnings: resolvedConversion.warnings.concat(imageResult.warnings),
  };
};

const resolveImportTimeoutMs = (env: Partial<Bindings>) => {
  const value = Number(env.IMPORT_TIMEOUT_MS ?? 10_000);
  return Number.isInteger(value) && value > 0 ? value : 10_000;
};

const resolveImportMaxHtmlBytes = (env: Partial<Bindings>) => {
  const value = Number(env.IMPORT_MAX_HTML_BYTES ?? 2_000_000);
  return Number.isInteger(value) && value > 0 ? value : 2_000_000;
};

const resolveYouTubeDataClient = (env: Partial<Bindings>): YouTubeDataClient | undefined => {
  const apiKey = env.YOUTUBE_DATA_API_KEY?.trim();
  return apiKey ? createYouTubeDataClient({ apiKey }) : undefined;
};

const resolveImportFetcher = (env: Partial<Bindings>): RecipeImportFetcher => {
  const mode = env.IMPORT_FETCH_MODE?.trim() || "standard";

  if (mode === "standard") {
    return fetchImportPage;
  }

  if (mode === "browser-run") {
    if (!env.BROWSER) {
      throw new RecipeImportError("unknown", "Browser Run binding is not configured.");
    }

    return createBrowserRunImportFetcher(env.BROWSER);
  }

  throw new RecipeImportError("unknown", "Import fetch mode is invalid.");
};

const assertContentLengthAllowed = (response: Response, maxBytes: number) => {
  const contentLengthHeader = response.headers.get("content-length");
  if (!contentLengthHeader) return;

  const contentLength = Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RecipeImportError("unsupported_page", "Import page is too large.");
  }
};

const assertTextByteLengthAllowed = (text: string, maxBytes: number) => {
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new RecipeImportError("unsupported_page", "Import page is too large.");
  }
};

const readResponseTextWithLimit = async (response: Response, maxBytes: number) => {
  if (!response.body) {
    const text = await response.text();
    assertTextByteLengthAllowed(text, maxBytes);

    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RecipeImportError("unsupported_page", "Import page is too large.");
      }

      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};

const normalizeTitleCandidate = (value: string | null | undefined) => {
  const title = value?.trim();
  return title || null;
};

const resolveImportDraftTitle = (
  aiTitle: string | null,
  conversion: RecipeImportConverterResult,
) => {
  const structuredRecipeName =
    conversion.promptProfile === "generic"
      ? conversion.input.recipeStructuredEvidence
          .map((evidence) => normalizeTitleCandidate(evidence.name))
          .find((title): title is string => Boolean(title))
      : null;
  const fallbackTitle = [
    normalizeTitleCandidate(aiTitle),
    structuredRecipeName,
    ...(conversion.titleFallbackCandidates ?? []).map(normalizeTitleCandidate),
    normalizeTitleCandidate(conversion.source.sourceName),
    normalizeTitleCandidate(conversion.input.source.host),
  ].find((title): title is string => Boolean(title));

  if (!fallbackTitle) {
    throw new RecipeImportError("unknown", "Import title fallback could not be resolved.");
  }

  return fallbackTitle;
};

const resolveDraftImageUrls = (
  draft: ResolvedTitleRecipeImportAIDraftContent,
  candidates: RecipeImportImageCandidate[],
): { draft: RecipeDraftContent; warnings: string[] } => {
  const candidateUrls = new Set(candidates.map((candidate) => candidate.url));
  const warnings: string[] = [];
  const resolveImage = (imageUrl: RecipeImportAIImageUrl | undefined) => {
    if (!imageUrl) return undefined;

    if (candidateUrls.has(imageUrl)) {
      return {
        type: "externalImageUrl" as const,
        url: imageUrl,
      };
    }

    warnings.push(`AI returned unknown image URL: ${imageUrl}`);
    return undefined;
  };

  return {
    draft: trimRecipeDraftContent({
      title: draft.title,
      yieldText: draft.yieldText,
      coverImage: resolveImage(draft.coverImageUrl),
      referenceImages: [],
      ingredientGroups: draft.ingredientGroups,
      steps: draft.steps.map((step) => ({
        text: step.text,
        images: step.imageUrls
          .map(resolveImage)
          .filter((image): image is NonNullable<typeof image> => Boolean(image)),
      })),
      note: draft.note,
    }),
    warnings,
  };
};

const applyDeterministicImagePlacement = (
  draft: RecipeDraftContent,
  placement: RecipeImportImagePlacement | undefined,
): RecipeDraftContent => {
  if (!placement) return draft;

  return trimRecipeDraftContent({
    ...draft,
    ...(placement.coverImageUrl
      ? {
          coverImage: {
            type: "externalImageUrl",
            url: placement.coverImageUrl,
          },
        }
      : {}),
    referenceImages: [
      ...placement.referenceImageUrls.map((url) => ({ type: "externalImageUrl" as const, url })),
      ...(draft.referenceImages ?? []),
    ],
  });
};
