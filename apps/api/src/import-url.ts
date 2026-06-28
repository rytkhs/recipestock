import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  type RecipeDraftContent,
  type RecipeSourceDraft,
  recipeDraftContentSchema,
} from "@recipestock/schemas";
import { normalizeUrl } from "@recipestock/shared";
import { generateObject } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { type Bindings, type BrowserRunBinding } from "./env";
import { extractRecipePageEvidence } from "./import-page-evidence";
import {
  type DeterministicImporter,
  defaultDeterministicImporter,
} from "./lib/import/deterministic";
import {
  assertFetchedPageIsHtml,
  assertImportContentTypeMayBeHtml,
  assertImportUrlAllowed,
} from "./lib/import/policy";
import { defaultSourceExtractor, type SourceExtractor } from "./lib/import/source-extraction";
import {
  type FetchedImportPage,
  type ImportErrorCode,
  type RecipeImportAIDraftContent,
  type RecipeImportAIImageUrl,
  type RecipeImportAIInput,
  type RecipeImportAIProvider,
  RecipeImportError,
  type RecipeImportFetcher,
  type RecipeImportImageCandidate,
  type RecipeImportImagePlacement,
  type RecipeImportResult,
} from "./lib/import/types";
import { createLogger, type Logger } from "./logger";
import { consumeAiUsage, type UsageRepository } from "./usage";
import { type YtDlpMetadataClient } from "./ytdlp-metadata";

export { assertImportUrlAllowed } from "./lib/import/policy";
export {
  type FetchedImportPage,
  type ImportErrorCode,
  type RecipeImportAIDraftContent,
  type RecipeImportAIImageUrl,
  type RecipeImportAIInput,
  type RecipeImportAIProvider,
  RecipeImportError,
  type RecipeImportFetcher,
  type RecipeImportImageCandidate,
  type RecipeImportResult,
  type RecipeImportStructuredEvidence,
} from "./lib/import/types";

type RecipeImportConverterResult = {
  type: "requiresAi";
  input: RecipeImportAIInput;
  imageCandidates: RecipeImportImageCandidate[];
  imagePlacement?: RecipeImportImagePlacement;
  source: RecipeSourceDraft;
  warnings: string[];
};

const MAX_IMPORT_PAGE_REDIRECTS = 5;
const MAX_BROWSER_RUN_GOTO_TIMEOUT_MS = 60_000;
const DEFAULT_IMPORT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125.0.0.0 Safari/537.36";

const importAiImageUrlSchema = z.string().min(1);

const importAiIngredientSchema = z.strictObject({
  name: z.string().min(1),
  amount: z.string(),
});

const importAiIngredientGroupSchema = z.strictObject({
  label: z.string().nullable(),
  ingredients: z.array(importAiIngredientSchema),
});

const importAiDraftStepSchema = z
  .strictObject({
    text: z.string().min(1).nullable(),
    imageUrls: z.array(importAiImageUrlSchema),
  })
  .refine((step) => step.text !== null || step.imageUrls.length > 0);

const importAiDraftContentSchema = z.strictObject({
  title: z.string().min(1),
  yieldText: z.string().nullable(),
  coverImageUrl: importAiImageUrlSchema.nullable(),
  ingredientGroups: z.array(importAiIngredientGroupSchema),
  steps: z.array(importAiDraftStepSchema),
  note: z.string().nullable(),
});

const browserRunContentResponseSchema = z.object({
  success: z.literal(true),
  result: z.string(),
});

const normalizeImportAiDraftContent = (value: unknown): RecipeImportAIDraftContent => {
  const draft = importAiDraftContentSchema.parse(value);

  return {
    title: draft.title,
    ...(draft.yieldText !== null ? { yieldText: draft.yieldText } : {}),
    ...(draft.coverImageUrl !== null ? { coverImageUrl: draft.coverImageUrl } : {}),
    ingredientGroups: draft.ingredientGroups.map((group) => ({
      ...(group.label !== null ? { label: group.label } : {}),
      ingredients: group.ingredients,
    })),
    steps: draft.steps.map((step) => ({
      ...(step.text !== null ? { text: step.text } : {}),
      imageUrls: step.imageUrls,
    })),
    ...(draft.note !== null ? { note: draft.note } : {}),
  };
};

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
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": DEFAULT_IMPORT_USER_AGENT,
      },
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

  return {
    type: "requiresAi",
    input: {
      source: {
        finalUrl: normalizedFinalUrl,
        host: finalHost,
      },
      markdownContent: evidence.markdownContent,
      recipeStructuredEvidence: evidence.recipeStructuredEvidence,
    },
    imageCandidates: evidence.imageCandidates,
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
  ytdlpMetadataClient,
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
  usageRepository: UsageRepository;
  aiProvider?: RecipeImportAIProvider;
  fetcher?: RecipeImportFetcher;
  ytdlpMetadataClient?: YtDlpMetadataClient;
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
    ytdlpMetadataClient,
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

  const usage = await consumeAiUsage({
    userId,
    env,
    repository: usageRepository,
    now,
  });

  if (usage.status === "limitExceeded") {
    throw new RecipeImportError("ai_usage_limit_exceeded", "AI usage limit exceeded.");
  }

  assertImportJobDeadline(deadline, currentDate());
  const aiTimeoutMs = resolveBoundedTimeoutMs(
    resolveImportAiTimeoutMs(env),
    deadline,
    currentDate(),
  );
  const boundedEnv = {
    ...env,
    IMPORT_AI_TIMEOUT_MS: String(aiTimeoutMs),
  };
  const importAIProvider =
    aiProvider ?? createDefaultRecipeImportAIProvider(boundedEnv as Bindings, { logger });
  let draft: RecipeImportAIDraftContent;

  try {
    draft = await importAIProvider.normalize(resolvedConversion.input);
    assertImportJobDeadline(deadline, currentDate());
  } catch (error) {
    if (error instanceof RecipeImportError) {
      throw error;
    }

    if (error instanceof z.ZodError) {
      throw new RecipeImportError("ai_schema_invalid", "AI response schema was invalid.");
    }

    throw new RecipeImportError("unknown" as ImportErrorCode, "AI normalization failed.");
  }

  let imageResult: { draft: RecipeDraftContent; warnings: string[] };

  try {
    imageResult = resolveDraftImageUrls(draft, resolvedConversion.imageCandidates);
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

const assertImportJobDeadline = (deadline: Date | undefined, now: Date) => {
  if (deadline && now.getTime() >= deadline.getTime()) {
    throw new RecipeImportError("job_timeout", "Import job timed out.");
  }
};

const resolveBoundedTimeoutMs = (timeoutMs: number, deadline: Date | undefined, now: Date) => {
  if (!deadline) return timeoutMs;

  const remainingMs = deadline.getTime() - now.getTime();
  if (remainingMs <= 0) {
    throw new RecipeImportError("job_timeout", "Import job timed out.");
  }

  return Math.min(timeoutMs, remainingMs);
};

type ImportAiProviderKind = "workers-ai" | "openrouter" | "groq";

const IMPORT_AI_MAX_OUTPUT_TOKENS = 8192;

export const createDefaultRecipeImportAIProvider = (
  env: Bindings,
  { logger = createLogger() }: { logger?: Logger } = {},
): RecipeImportAIProvider => ({
  async normalize(input) {
    const providerKind = resolveImportAiProvider(env);
    const system = resolveImportRecipeSystemPrompt(env);
    const timeoutMs = resolveImportAiTimeoutMs(env);
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    try {
      const result = await generateObject({
        model: createImportLanguageModel(env, providerKind, timeoutMs),
        schema: importAiDraftContentSchema,
        system,
        prompt: buildImportUserPrompt(input),
        providerOptions: createImportProviderOptions(providerKind),
        temperature: 0,
        maxOutputTokens: IMPORT_AI_MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        timeout: timeoutMs,
        abortSignal: controller.signal,
      });

      return normalizeImportAiDraftContent(result.object);
    } catch (error) {
      logImportAiFailure(error, {
        env,
        input,
        logger,
        providerKind,
        timeoutMs,
      });

      const importError = classifyImportAiError(error, { didTimeout });
      if (importError) {
        throw importError;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  },
});

const createImportLanguageModel = (
  env: Bindings,
  providerKind: ImportAiProviderKind,
  timeoutMs: number,
) => {
  if (providerKind === "groq") {
    const model = resolveGroqTextModel(env);
    const groq = createGroq({
      apiKey: resolveGroqApiKey(env),
      baseURL: resolveGroqGatewayBaseUrl(env),
      headers: resolveAiGatewayAuthHeaders(env),
    });

    return groq(model) as never;
  }

  if (providerKind === "openrouter") {
    const model = resolveOpenRouterTextModel(env);
    const openrouter = createOpenRouter({
      apiKey: resolveOpenRouterApiKey(env),
      appName: "Recipe Stock",
      baseURL: resolveOpenRouterGatewayBaseUrl(env),
      headers: resolveAiGatewayAuthHeaders(env),
    });

    return openrouter.chat(model, {
      provider: {
        allow_fallbacks: false,
        require_parameters: true,
      },
      structuredOutputs: { strict: true },
    }) as never;
  }

  const model = resolveImportAiTextModel(env);
  const workersai = createWorkersAI({
    binding: env.AI,
    gateway: { id: env.AI_GATEWAY_NAME },
  });

  return workersai(model as never, {
    extraHeaders: { "cf-aig-request-timeout": String(timeoutMs) },
  }) as never;
};

const createImportProviderOptions = (providerKind: ImportAiProviderKind) => {
  if (providerKind !== "groq") return undefined;

  return {
    groq: {
      structuredOutputs: true,
      strictJsonSchema: true,
    },
  };
};

const buildImportUserPrompt = (input: RecipeImportAIInput) => `
source:
${JSON.stringify(input.source)}

recipeStructuredEvidence:
${JSON.stringify(input.recipeStructuredEvidence)}

markdownContent:
<<<PAGE_CONTENT
${input.markdownContent}
PAGE_CONTENT`;

const resolveImportTimeoutMs = (env: Partial<Bindings>) => {
  const value = Number(env.IMPORT_TIMEOUT_MS ?? 10_000);
  return Number.isInteger(value) && value > 0 ? value : 10_000;
};

const resolveImportMaxHtmlBytes = (env: Partial<Bindings>) => {
  const value = Number(env.IMPORT_MAX_HTML_BYTES ?? 2_000_000);
  return Number.isInteger(value) && value > 0 ? value : 2_000_000;
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

const resolveImportAiTimeoutMs = (env: Partial<Bindings>) => {
  const value = Number(env.IMPORT_AI_TIMEOUT_MS ?? 180_000);
  return Number.isInteger(value) && value > 0 ? value : 180_000;
};

const resolveImportAiTextModel = (env: Partial<Bindings>) => {
  const model = env.AI_TEXT_MODEL?.trim();
  if (!model) {
    throw new RecipeImportError("unknown", "AI text model is not configured.");
  }

  return model;
};

const resolveImportAiProvider = (env: Partial<Bindings>): ImportAiProviderKind => {
  const provider = env.IMPORT_AI_PROVIDER?.trim() || "workers-ai";
  if (provider === "workers-ai" || provider === "openrouter" || provider === "groq") {
    return provider;
  }

  throw new RecipeImportError("unknown", "Import AI provider is not configured.");
};

const resolveGroqApiKey = (env: Partial<Bindings>) => {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new RecipeImportError("unknown", "Groq API key is not configured.");
  }

  return apiKey;
};

const resolveGroqTextModel = (env: Partial<Bindings>) => {
  const model = env.GROQ_TEXT_MODEL?.trim();
  if (!model) {
    throw new RecipeImportError("unknown", "Groq text model is not configured.");
  }

  return model;
};

const resolveOpenRouterApiKey = (env: Partial<Bindings>) => {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new RecipeImportError("unknown", "OpenRouter API key is not configured.");
  }

  return apiKey;
};

const resolveOpenRouterTextModel = (env: Partial<Bindings>) => {
  const model = env.OPENROUTER_TEXT_MODEL?.trim();
  if (!model) {
    throw new RecipeImportError("unknown", "OpenRouter text model is not configured.");
  }

  return model;
};

const resolveGroqGatewayBaseUrl = (env: Partial<Bindings>) =>
  resolveCloudflareAiGatewayProviderBaseUrl(env, "groq");

const resolveOpenRouterGatewayBaseUrl = (env: Partial<Bindings>) => {
  return resolveCloudflareAiGatewayProviderBaseUrl(env, "openrouter");
};

const resolveCloudflareAiGatewayProviderBaseUrl = (
  env: Partial<Bindings>,
  providerPath: "groq" | "openrouter",
) => {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  if (!accountId || !gatewayName) {
    throw new RecipeImportError("unknown", "Cloudflare AI Gateway is not configured.");
  }

  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    accountId,
  )}/${encodeURIComponent(gatewayName)}/${providerPath}`;
};

const resolveAiGatewayAuthHeaders = (env: Partial<Bindings>) => {
  const token = env.CF_AIG_TOKEN?.trim();
  if (!token) {
    throw new RecipeImportError("unknown", "Cloudflare AI Gateway token is not configured.");
  }

  return {
    "cf-aig-authorization": `Bearer ${token}`,
  };
};

const logImportAiFailure = (
  error: unknown,
  {
    env,
    input,
    logger,
    providerKind,
    timeoutMs,
  }: {
    env: Partial<Bindings>;
    input: RecipeImportAIInput;
    logger: Logger;
    providerKind: ImportAiProviderKind;
    timeoutMs: number;
  },
) => {
  const model = resolveImportAiTextModelForLog(env, providerKind);

  logger.error("recipe_import_ai_normalization_failed", {
    provider: providerKind,
    model: model || undefined,
    timeoutMs,
    sourceHost: input.source.host,
    sourceUrl: input.source.finalUrl,
    markdownContentLength: input.markdownContent.length,
    structuredEvidenceCount: input.recipeStructuredEvidence.length,
    gatewayBaseUrl:
      providerKind === "workers-ai"
        ? undefined
        : resolveCloudflareAiGatewayProviderBaseUrlForLog(env, providerKind),
    gatewayName: env.AI_GATEWAY_NAME?.trim() || undefined,
    gatewayAuthConfigured:
      providerKind === "workers-ai" ? undefined : Boolean(env.CF_AIG_TOKEN?.trim()),
    error: sanitizeErrorDetails(error),
  });
};

const resolveImportAiTextModelForLog = (
  env: Partial<Bindings>,
  providerKind: ImportAiProviderKind,
) => {
  if (providerKind === "groq") return env.GROQ_TEXT_MODEL?.trim();
  if (providerKind === "openrouter") return env.OPENROUTER_TEXT_MODEL?.trim();

  return env.AI_TEXT_MODEL?.trim();
};

const resolveCloudflareAiGatewayProviderBaseUrlForLog = (
  env: Partial<Bindings>,
  providerKind: Exclude<ImportAiProviderKind, "workers-ai">,
) => {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  if (!accountId || !gatewayName) return undefined;

  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    accountId,
  )}/${encodeURIComponent(gatewayName)}/${providerKind}`;
};

const sanitizeErrorDetails = (error: unknown, depth = 0): unknown => {
  if (depth > 2) return undefined;
  if (error instanceof Error) {
    const record = error as Error & {
      cause?: unknown;
      statusCode?: unknown;
      status?: unknown;
      url?: unknown;
      responseBody?: unknown;
    };

    return {
      name: error.name,
      message: error.message,
      statusCode: record.statusCode ?? record.status,
      url: typeof record.url === "string" ? record.url : undefined,
      responseBody:
        typeof record.responseBody === "string" ? record.responseBody.slice(0, 1_000) : undefined,
      cause: record.cause ? sanitizeErrorDetails(record.cause, depth + 1) : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    return Object.fromEntries(
      Object.entries(error as Record<string, unknown>)
        .filter(([key]) => !/key|token|secret|authorization/i.test(key))
        .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 1_000) : value]),
    );
  }

  return error;
};

const resolveImportRecipeSystemPrompt = (env: Partial<Bindings>) => {
  const prompt = env.IMPORT_RECIPE_SYSTEM_PROMPT?.trim();
  if (!prompt) {
    throw new RecipeImportError("unknown", "Import recipe system prompt is not configured.");
  }

  return prompt;
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

const errorName = (error: unknown) =>
  typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name)
    : "";

const errorMessage = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: unknown }).message)
    : "";

const isAbortError = (error: unknown) => {
  const name = errorName(error);
  return name === "AbortError" || name === "TimeoutError";
};

const errorCause = (error: unknown) =>
  typeof error === "object" && error !== null && "cause" in error
    ? (error as { cause?: unknown }).cause
    : undefined;

const errorStatusCode = (error: unknown) => {
  if (typeof error !== "object" || error === null) return undefined;

  const record = error as { statusCode?: unknown; status?: unknown };
  const statusCode = Number(record.statusCode ?? record.status);

  return Number.isFinite(statusCode) ? statusCode : undefined;
};

const classifyImportAiError = (
  error: unknown,
  { didTimeout }: { didTimeout: boolean },
): RecipeImportError | null => {
  if (didTimeout || isAiTimeoutError(error)) {
    return new RecipeImportError("ai_timeout", "AI normalization timed out.");
  }

  if (isAiSchemaError(error)) {
    return new RecipeImportError("ai_schema_invalid", "AI response schema was invalid.");
  }

  return null;
};

const isAiTimeoutError = (error: unknown): boolean => {
  if (isAbortError(error)) return true;

  const name = errorName(error).toLowerCase();
  const message = errorMessage(error).toLowerCase();
  const statusCode = errorStatusCode(error);

  if (statusCode === 408 || statusCode === 504) return true;
  if (includesAiTimeoutSignal(name) || includesAiTimeoutSignal(message)) {
    return true;
  }

  const cause = errorCause(error);
  return cause ? isAiTimeoutError(cause) : false;
};

const includesAiTimeoutSignal = (value: string) =>
  value.includes("abort") ||
  value.includes("timeout") ||
  value.includes("timed out") ||
  value.includes("time-out") ||
  value.includes("gateway timeout") ||
  value.includes("gateway time-out") ||
  value.includes("504 gateway");

const isAiSchemaError = (error: unknown): boolean => {
  if (error instanceof z.ZodError) return true;

  const name = errorName(error);
  if (
    name === "NoObjectGeneratedError" ||
    name === "AI_NoObjectGeneratedError" ||
    name === "TypeValidationError" ||
    name === "AI_TypeValidationError"
  ) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  if (message.includes("schema") || message.includes("type validation")) {
    return true;
  }

  const cause = errorCause(error);
  return cause ? isAiSchemaError(cause) : false;
};

const resolveDraftImageUrls = (
  draft: RecipeImportAIDraftContent,
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
    draft: recipeDraftContentSchema.parse({
      title: draft.title,
      yieldText: draft.yieldText,
      coverImage: resolveImage(draft.coverImageUrl),
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

  return recipeDraftContentSchema.parse({
    ...draft,
    ...(placement.coverImageUrl
      ? {
          coverImage: {
            type: "externalImageUrl",
            url: placement.coverImageUrl,
          },
        }
      : {}),
    sourceMedia: [
      ...placement.sourceMediaUrls.map((url) => ({ type: "externalImageUrl" as const, url })),
      ...(draft.sourceMedia ?? []),
    ],
  });
};
