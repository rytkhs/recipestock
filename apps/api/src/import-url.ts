/// <reference path="./html2md4llm.d.ts" />

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  type RecipeDraftContent,
  type RecipeSourceDraft,
  recipeDraftContentSchema,
} from "@recipestock/schemas";
import { normalizeUrl } from "@recipestock/shared";
import { generateObject } from "ai";
import html2md4llm from "html2md4llm";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { type Bindings } from "./env";
import { createLogger, type Logger } from "./logger";
import { isHttpFetchUrlAllowed } from "./url-safety";
import { consumeAiUsage, type UsageRepository } from "./usage";

export type ImportErrorCode =
  | "invalid_url"
  | "fetch_failed"
  | "unsupported_page"
  | "extraction_failed"
  | "ai_usage_limit_exceeded"
  | "ai_timeout"
  | "ai_schema_invalid"
  | "unknown";

export class RecipeImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "RecipeImportError";
    this.code = code;
  }
}

export type RecipeImportImageCandidate = {
  id: string;
  url: string;
  alt?: string;
  position: number;
};

export type ExtractedRecipeStructuredInstruction = {
  text: string;
  imageUrls: string[];
};

export type ExtractedRecipeStructuredEvidence = {
  format: "jsonLd" | "microdata" | "rdfa";
  name?: string;
  servingsText?: string;
  imageUrls: string[];
  rawIngredients: string[];
  rawInstructions: string[];
  structuredInstructions: ExtractedRecipeStructuredInstruction[];
};

export type RecipeImportStructuredInstructionEvidence = {
  text: string;
  imageIds: string[];
};

export type RecipeImportStructuredEvidence = {
  format: "jsonLd" | "microdata" | "rdfa";
  name?: string;
  servingsText?: string;
  imageIds: string[];
  rawIngredients: string[];
  rawInstructions: string[];
  structuredInstructions: RecipeImportStructuredInstructionEvidence[];
};

export type RecipeImportAIInput = {
  source: {
    finalUrl: string;
    host: string;
  };
  markdownContent: string;
  recipeStructuredEvidence: RecipeImportStructuredEvidence[];
};

export type RecipeImportAIImageRef = {
  type: "imageId";
  id: string;
};

export type RecipeImportAIDraftStep = {
  text?: string;
  images: RecipeImportAIImageRef[];
};

export type RecipeImportAIDraftContent = {
  title: string;
  servingsText?: string;
  coverImage?: RecipeImportAIImageRef;
  ingredientGroups: Array<{
    label?: string;
    ingredients: Array<{
      name: string;
      amount: string;
    }>;
  }>;
  steps: RecipeImportAIDraftStep[];
  note?: string;
};

export type RecipeImportAIProvider = {
  normalize(input: RecipeImportAIInput): Promise<RecipeImportAIDraftContent>;
};

export type RecipeImportResult = {
  recipeDraftContent: RecipeDraftContent;
  source: RecipeSourceDraft;
  warnings: string[];
};

export type RecipeImportConverterResult =
  | {
      type: "deterministic";
      recipeDraftContent: RecipeDraftContent;
      source: RecipeSourceDraft;
      warnings: string[];
    }
  | {
      type: "requiresAi";
      input: RecipeImportAIInput;
      imageCandidates: RecipeImportImageCandidate[];
      source: RecipeSourceDraft;
      warnings: string[];
    };

export type RecipeImportConverter = {
  convert(page: FetchedImportPage): Promise<RecipeImportConverterResult>;
};

export type FetchedImportPage = {
  finalUrl: string;
  contentType: string;
  body: Response | string;
};

export type RecipeImportFetcher = (
  url: string,
  options: { timeoutMs: number; maxBytes: number },
) => Promise<FetchedImportPage>;

const MAX_IMPORT_PAGE_REDIRECTS = 5;

const importAiImageRefSchema = z.strictObject({
  type: z.literal("imageId"),
  id: z.string().min(1),
});

const importAiIngredientSchema = z.object({
  name: z.string().min(1),
  amount: z.string(),
});

const importAiIngredientGroupSchema = z.object({
  label: z.string().optional(),
  ingredients: z.array(importAiIngredientSchema).default([]),
});

const importAiDraftStepSchema = z
  .object({
    text: z.string().min(1).optional(),
    images: z.array(importAiImageRefSchema).default([]),
  })
  .refine((step) => step.text || step.images.length > 0);

const importAiDraftContentSchema = z.object({
  title: z.string().min(1),
  servingsText: z.string().optional(),
  coverImage: importAiImageRefSchema.optional(),
  ingredientGroups: z.array(importAiIngredientGroupSchema).default([]),
  steps: z.array(importAiDraftStepSchema).default([]),
  note: z.string().optional(),
});

const normalizeImportAiDraftContent = (value: unknown): RecipeImportAIDraftContent => {
  const draft = importAiDraftContentSchema.parse(value);

  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      images: step.images,
    })),
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

    assertContentLengthAllowed(response, maxBytes);

    return {
      finalUrl,
      contentType: response.headers.get("content-type") ?? "",
      body: await readResponseTextWithLimit(response, maxBytes),
    };
  } catch (error) {
    if (error instanceof RecipeImportError) {
      throw error;
    }

    throw new RecipeImportError("fetch_failed", "Import URL could not be fetched.");
  } finally {
    clearTimeout(timeout);
  }
};

const fetchImportPageFollowingAllowedRedirects = async (sourceUrl: string, signal: AbortSignal) => {
  let currentUrl = sourceUrl;

  for (let redirectCount = 0; redirectCount <= MAX_IMPORT_PAGE_REDIRECTS; redirectCount++) {
    assertImportUrlAllowed(currentUrl);

    const DEFAULT_IMPORT_USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/125.0.0.0 Safari/537.36";

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

export const assertImportUrlAllowed = (sourceUrl: string) => {
  if (!isHttpFetchUrlAllowed(sourceUrl)) {
    throw new RecipeImportError("invalid_url", "Import URL is invalid.");
  }
};

export const genericHtmlImportConverter: RecipeImportConverter = {
  async convert(page) {
    if (page.contentType && !/html/i.test(page.contentType)) {
      throw new RecipeImportError("unsupported_page", "Import URL is not an HTML page.");
    }

    const normalizedUrl = normalizeUrl(page.finalUrl);
    const imageRegistry = new ImportImageRegistry(normalizedUrl);
    const extraction = await extractHtmlImportData(page, normalizedUrl, imageRegistry);
    const sourceName =
      extraction.meta["og:site_name"] ?? new URL(normalizedUrl).hostname.replace(/^www\./, "");
    const markdownContent = normalizeMarkdownContent(extraction.markdownContent);
    const extractedRecipeStructuredEvidence = dedupeRecipeStructuredEvidence([
      ...extractRecipeJsonLdEvidence(extraction.jsonLd, normalizedUrl),
      ...extraction.recipeStructuredEvidence,
    ]);
    const recipeStructuredEvidence = buildImportStructuredEvidence(
      extractedRecipeStructuredEvidence,
      imageRegistry,
    );

    if (markdownContent.length < 40 && !hasDescriptionMetadata(extraction.meta)) {
      throw new RecipeImportError("extraction_failed", "Recipe text could not be extracted.");
    }

    return {
      type: "requiresAi",
      input: {
        source: {
          finalUrl: normalizedUrl,
          host: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
        },
        markdownContent,
        recipeStructuredEvidence,
      },
      imageCandidates: imageRegistry.candidates,
      source: {
        sourceUrl: normalizedUrl,
        sourceName,
      },
      warnings: [],
    };
  },
};

export const importRecipeFromUrl = async ({
  rawUrl,
  userId,
  env,
  usageRepository,
  aiProvider,
  fetcher = fetchImportPage,
  converters = [genericHtmlImportConverter],
  now = new Date(),
  logger = createLogger(),
}: {
  rawUrl: string;
  userId: string;
  env: Partial<Bindings>;
  usageRepository: UsageRepository;
  aiProvider?: RecipeImportAIProvider;
  fetcher?: RecipeImportFetcher;
  converters?: RecipeImportConverter[];
  now?: Date;
  logger?: Logger;
}): Promise<RecipeImportResult> => {
  let normalizedUrl: string;

  try {
    normalizedUrl = normalizeUrl(rawUrl);
  } catch {
    throw new RecipeImportError("invalid_url", "Import URL is invalid.");
  }

  const page = await fetcher(normalizedUrl, {
    timeoutMs: resolveImportTimeoutMs(env),
    maxBytes: resolveImportMaxHtmlBytes(env),
  });
  const conversion = await convertImportPage(page, converters);

  if (conversion.type === "deterministic") {
    return conversion;
  }

  const usage = await consumeAiUsage({
    userId,
    env,
    repository: usageRepository,
    now,
  });

  if (usage.status === "limitExceeded") {
    throw new RecipeImportError("ai_usage_limit_exceeded", "AI usage limit exceeded.");
  }

  const importAIProvider =
    aiProvider ?? createDefaultRecipeImportAIProvider(env as Bindings, { logger });
  let draft: RecipeImportAIDraftContent;

  try {
    draft = await importAIProvider.normalize(conversion.input);
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
    imageResult = resolveDraftImageIds(draft, conversion.imageCandidates);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new RecipeImportError("ai_schema_invalid", "AI response schema was invalid.");
    }

    throw new RecipeImportError("unknown" as ImportErrorCode, "AI normalization failed.");
  }

  return {
    recipeDraftContent: imageResult.draft,
    source: conversion.source,
    warnings: conversion.warnings.concat(imageResult.warnings),
  };
};

const convertImportPage = (
  page: FetchedImportPage,
  converters: RecipeImportConverter[],
): Promise<RecipeImportConverterResult> => {
  for (const converter of converters) {
    return converter.convert(page);
  }

  throw new RecipeImportError("unsupported_page", "No import converter is available.");
};

type ImportAiProviderKind = "workers-ai" | "openrouter";

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
        temperature: 0,
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
  if (provider === "workers-ai" || provider === "openrouter") {
    return provider;
  }

  throw new RecipeImportError("unknown", "Import AI provider is not configured.");
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

const resolveOpenRouterGatewayBaseUrl = (env: Partial<Bindings>) => {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  if (!accountId || !gatewayName) {
    throw new RecipeImportError("unknown", "Cloudflare AI Gateway is not configured.");
  }

  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    accountId,
  )}/${encodeURIComponent(gatewayName)}/openrouter`;
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
  const model =
    providerKind === "openrouter" ? env.OPENROUTER_TEXT_MODEL?.trim() : env.AI_TEXT_MODEL?.trim();

  logger.error("recipe_import_ai_normalization_failed", {
    provider: providerKind,
    model: model || undefined,
    timeoutMs,
    sourceHost: input.source.host,
    sourceUrl: input.source.finalUrl,
    markdownContentLength: input.markdownContent.length,
    structuredEvidenceCount: input.recipeStructuredEvidence.length,
    gatewayBaseUrl:
      providerKind === "openrouter" ? resolveOpenRouterGatewayBaseUrlForLog(env) : undefined,
    gatewayName: env.AI_GATEWAY_NAME?.trim() || undefined,
    gatewayAuthConfigured:
      providerKind === "openrouter" ? Boolean(env.CF_AIG_TOKEN?.trim()) : undefined,
    error: sanitizeErrorDetails(error),
  });
};

const resolveOpenRouterGatewayBaseUrlForLog = (env: Partial<Bindings>) => {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayName = env.AI_GATEWAY_NAME?.trim();
  if (!accountId || !gatewayName) return undefined;

  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    accountId,
  )}/${encodeURIComponent(gatewayName)}/openrouter`;
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

const readResponseTextWithLimit = async (response: Response, maxBytes: number) => {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new RecipeImportError("unsupported_page", "Import page is too large.");
    }

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

const resolveDraftImageIds = (
  draft: RecipeImportAIDraftContent,
  candidates: RecipeImportImageCandidate[],
): { draft: RecipeDraftContent; warnings: string[] } => {
  const urlsById = new Map(candidates.map((candidate) => [candidate.id, candidate.url]));
  const warnings: string[] = [];
  const resolveImage = (image: RecipeImportAIImageRef | undefined) => {
    if (!image) return undefined;

    const url = urlsById.get(image.id);
    if (url) {
      return {
        type: "externalImageUrl" as const,
        url,
      };
    }

    warnings.push(`AI returned unknown image ID: ${image.id}`);
    return undefined;
  };

  return {
    draft: recipeDraftContentSchema.parse({
      ...draft,
      coverImage: resolveImage(draft.coverImage),
      steps: draft.steps.map((step) => ({
        ...step,
        images: step.images
          .map(resolveImage)
          .filter((image): image is NonNullable<typeof image> => Boolean(image)),
      })),
    }),
    warnings,
  };
};

type HtmlRewriterElement = Parameters<
  NonNullable<HTMLRewriterElementContentHandlers["element"]>
>[0];

type HtmlElementEndTagRegistrar = (element: HtmlRewriterElement, callback: () => void) => void;

type RecipeStructuredEvidenceBuilder = {
  format: ExtractedRecipeStructuredEvidence["format"];
  name?: string;
  servingsText?: string;
  imageUrls: string[];
  rawIngredients: string[];
  rawInstructions: string[];
  structuredInstructions: ExtractedRecipeStructuredInstruction[];
};

type RecipeStructuredProperty = keyof Pick<
  ExtractedRecipeStructuredEvidence,
  "name" | "servingsText" | "imageUrls" | "rawIngredients" | "rawInstructions"
>;

type RecipeStructuredTextCapture = {
  builder: RecipeStructuredEvidenceBuilder;
  properties: RecipeStructuredProperty[];
  text: string;
};

type HtmlImportExtraction = {
  title: string;
  meta: Record<string, string | undefined>;
  h1: string[];
  markdownContent: string;
  jsonLd: string[];
  recipeStructuredEvidence: ExtractedRecipeStructuredEvidence[];
};

class ImportImageRegistry {
  readonly #baseUrl: string;
  readonly #candidates: RecipeImportImageCandidate[] = [];
  readonly #idsByUrl = new Map<string, string>();

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  get candidates() {
    return this.#candidates;
  }

  getOrCreateId(rawUrl: string | undefined, alt?: string): string | undefined {
    if (!rawUrl || this.#candidates.length >= 100) return undefined;

    let url: string;
    try {
      url = new URL(decodeHtml(rawUrl), this.#baseUrl).toString();
    } catch {
      return undefined;
    }

    const existingId = this.#idsByUrl.get(url);
    if (existingId) return existingId;

    const id = `img_${String(this.#candidates.length + 1).padStart(3, "0")}`;
    const normalizedAlt = alt ? normalizeImageAlt(alt) : undefined;
    this.#idsByUrl.set(url, id);
    this.#candidates.push({
      id,
      url,
      alt: normalizedAlt || undefined,
      position: this.#candidates.length,
    });

    return id;
  }
}

const extractHtmlImportData = async (
  page: FetchedImportPage,
  baseUrl: string,
  imageRegistry: ImportImageRegistry,
): Promise<HtmlImportExtraction> => {
  const extraction: HtmlImportExtraction = {
    title: "",
    meta: {},
    h1: [],
    markdownContent: "",
    jsonLd: [],
    recipeStructuredEvidence: [],
  };
  let ignoredTextDepth = 0;
  let jsonLdText: string | null = null;
  const h1TextBuffers: { text: string }[] = [];
  const endTagCallbacks = new WeakMap<HtmlRewriterElement, Array<() => void>>();

  extraction.recipeStructuredEvidence = await extractRecipeHtmlStructuredEvidence(page, baseUrl);
  const onHtmlElementEnd: HtmlElementEndTagRegistrar = (element, callback) => {
    const callbacks = endTagCallbacks.get(element);
    if (callbacks) {
      callbacks.push(callback);
      return;
    }

    const elementCallbacks = [callback];
    endTagCallbacks.set(element, elementCallbacks);
    element.onEndTag(() => {
      for (let index = elementCallbacks.length - 1; index >= 0; index -= 1) {
        elementCallbacks[index]?.();
      }
    });
  };
  const ignoreElementText = {
    element(element: HtmlRewriterElement) {
      ignoredTextDepth += 1;
      onHtmlElementEnd(element, () => {
        ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
      });
    },
  };
  const h1Handler = {
    element(element: HtmlRewriterElement) {
      if (ignoredTextDepth > 0) return;

      const buffer = { text: "" };
      h1TextBuffers.push(buffer);
      onHtmlElementEnd(element, () => {
        const normalized = normalizeReadableText(buffer.text);
        if (normalized) {
          extraction.h1.push(normalized);
        }

        const bufferIndex = h1TextBuffers.lastIndexOf(buffer);
        if (bufferIndex >= 0) {
          h1TextBuffers.splice(bufferIndex, 1);
        }
      });
    },
    text(text: Parameters<NonNullable<HTMLRewriterElementContentHandlers["text"]>>[0]) {
      if (ignoredTextDepth > 0) return;

      const buffer = h1TextBuffers.at(-1);
      if (buffer) {
        buffer.text += text.text;
      }
    },
  };

  const htmlWithImageMarkers = await new HTMLRewriter()
    .on("title", {
      text(text) {
        extraction.title += text.text;
      },
    })
    .on("meta", {
      element(element) {
        const key = normalizeMetaKey(
          element.getAttribute("property") ?? element.getAttribute("name"),
        );
        const content = element.getAttribute("content");
        if (!key || !content || extraction.meta[key]) return;

        extraction.meta[key] = normalizeReadableText(content);
        if (key === "og:image" || key === "twitter:image") {
          imageRegistry.getOrCreateId(content);
        }
      },
    })
    .on("h1", h1Handler)
    .on("script", {
      element(element) {
        ignoredTextDepth += 1;
        const type = element.getAttribute("type")?.toLowerCase().replace(/\s+/g, "");
        jsonLdText = type === "application/ld+json" && extraction.jsonLd.length < 5 ? "" : null;
        if (type !== "application/ld+json" || extraction.jsonLd.length >= 5) {
          onHtmlElementEnd(element, () => {
            ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
          });
          return;
        }

        onHtmlElementEnd(element, () => {
          ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
          const normalizedJsonLd = normalizeReadableText(jsonLdText ?? "");
          if (normalizedJsonLd && extraction.jsonLd.length < 5) {
            extraction.jsonLd.push(normalizedJsonLd);
          }
          jsonLdText = null;
        });
      },
      text(text) {
        if (jsonLdText === null) return;
        jsonLdText += text.text;
      },
    })
    .on("style", ignoreElementText)
    .on("noscript", ignoreElementText)
    .on("svg", ignoreElementText)
    .on("img", {
      element(element) {
        const rawUrl = element.getAttribute("src") ?? element.getAttribute("data-src") ?? undefined;
        const alt = element.getAttribute("alt") ?? undefined;
        const id = imageRegistry.getOrCreateId(rawUrl, alt);
        element.replace(id ? formatImageMarker(id, alt) : "", { html: false });
      },
    })
    .transform(importPageBodyToResponse(page))
    .text();

  extraction.markdownContent = html2md4llm(htmlWithImageMarkers, {
    strategy: "article",
    outputFormat: "markdown",
  });

  return {
    ...extraction,
    jsonLd: extraction.jsonLd.filter(Boolean).slice(0, 5),
    recipeStructuredEvidence: dedupeRecipeStructuredEvidence(
      extraction.recipeStructuredEvidence,
    ).slice(0, 20),
  };
};

const extractRecipeHtmlStructuredEvidence = async (
  page: FetchedImportPage,
  baseUrl: string,
): Promise<ExtractedRecipeStructuredEvidence[]> => {
  const recipes: ExtractedRecipeStructuredEvidence[] = [];
  const microdataRecipeStack: RecipeStructuredEvidenceBuilder[] = [];
  const rdfaRecipeStack: RecipeStructuredEvidenceBuilder[] = [];
  const structuredTextCaptures: RecipeStructuredTextCapture[] = [];
  const endTagCallbacks = new WeakMap<HtmlRewriterElement, Array<() => void>>();

  const onHtmlElementEnd: HtmlElementEndTagRegistrar = (element, callback) => {
    const callbacks = endTagCallbacks.get(element);
    if (callbacks) {
      callbacks.push(callback);
      return;
    }

    const elementCallbacks = [callback];
    endTagCallbacks.set(element, elementCallbacks);
    element.onEndTag(() => {
      for (let index = elementCallbacks.length - 1; index >= 0; index -= 1) {
        elementCallbacks[index]?.();
      }
    });
  };
  const appendStructuredEvidence = (builder: RecipeStructuredEvidenceBuilder) => {
    const evidence = normalizeRecipeStructuredEvidence(builder);
    if (!evidence || recipes.length >= 20) return;

    recipes.push(evidence);
  };

  await new HTMLRewriter()
    .on("*", {
      element(element) {
        const microdataRecipe = createMicrodataRecipeBuilder(element);
        if (microdataRecipe) {
          microdataRecipeStack.push(microdataRecipe);
          onHtmlElementEnd(element, () => {
            removeStackEntry(microdataRecipeStack, microdataRecipe);
            appendStructuredEvidence(microdataRecipe);
          });
        }

        const rdfaRecipe = createRdfaRecipeBuilder(element);
        if (rdfaRecipe) {
          rdfaRecipeStack.push(rdfaRecipe);
          onHtmlElementEnd(element, () => {
            removeStackEntry(rdfaRecipeStack, rdfaRecipe);
            appendStructuredEvidence(rdfaRecipe);
          });
        }

        captureMicrodataRecipeProperties(element, microdataRecipeStack.at(-1), {
          baseUrl,
          structuredTextCaptures,
          onHtmlElementEnd,
        });
        captureRdfaRecipeProperties(element, rdfaRecipeStack.at(-1), {
          baseUrl,
          structuredTextCaptures,
          onHtmlElementEnd,
        });
      },
    })
    .onDocument({
      text(text) {
        for (const capture of structuredTextCaptures) {
          capture.text += text.text;
        }
      },
    })
    .transform(importPageBodyToResponse(page))
    .text();

  return dedupeRecipeStructuredEvidence(recipes).slice(0, 20);
};

const createMicrodataRecipeBuilder = (
  element: HtmlRewriterElement,
): RecipeStructuredEvidenceBuilder | undefined => {
  if (!element.hasAttribute("itemscope")) return undefined;
  if (!hasSchemaRecipeType(element.getAttribute("itemtype"))) return undefined;

  return createRecipeStructuredEvidenceBuilder("microdata");
};

const createRdfaRecipeBuilder = (
  element: HtmlRewriterElement,
): RecipeStructuredEvidenceBuilder | undefined => {
  if (!hasSchemaRecipeType(element.getAttribute("typeof"))) return undefined;

  return createRecipeStructuredEvidenceBuilder("rdfa");
};

const createRecipeStructuredEvidenceBuilder = (
  format: ExtractedRecipeStructuredEvidence["format"],
): RecipeStructuredEvidenceBuilder => ({
  format,
  imageUrls: [],
  rawIngredients: [],
  rawInstructions: [],
  structuredInstructions: [],
});

const removeStackEntry = <T>(stack: T[], entry: T) => {
  const index = stack.lastIndexOf(entry);
  if (index >= 0) {
    stack.splice(index, 1);
  }
};

const captureMicrodataRecipeProperties = (
  element: HtmlRewriterElement,
  builder: RecipeStructuredEvidenceBuilder | undefined,
  {
    baseUrl,
    structuredTextCaptures,
    onHtmlElementEnd,
  }: {
    baseUrl: string;
    structuredTextCaptures: RecipeStructuredTextCapture[];
    onHtmlElementEnd: HtmlElementEndTagRegistrar;
  },
) => {
  if (!builder) return;

  const properties = normalizeRecipeStructuredProperties(element.getAttribute("itemprop"));
  if (properties.length === 0) return;

  const value = extractStructuredElementValue(element);
  if (value) {
    appendRecipeStructuredValue(builder, properties, value, baseUrl);
    return;
  }

  startRecipeStructuredTextCapture(element, builder, properties, structuredTextCaptures, {
    onHtmlElementEnd,
  });
};

const captureRdfaRecipeProperties = (
  element: HtmlRewriterElement,
  builder: RecipeStructuredEvidenceBuilder | undefined,
  {
    baseUrl,
    structuredTextCaptures,
    onHtmlElementEnd,
  }: {
    baseUrl: string;
    structuredTextCaptures: RecipeStructuredTextCapture[];
    onHtmlElementEnd: HtmlElementEndTagRegistrar;
  },
) => {
  if (!builder) return;

  const properties = normalizeRecipeStructuredProperties(element.getAttribute("property"));
  if (properties.length === 0) return;

  const value = extractStructuredElementValue(element);
  if (value) {
    appendRecipeStructuredValue(builder, properties, value, baseUrl);
    return;
  }

  startRecipeStructuredTextCapture(element, builder, properties, structuredTextCaptures, {
    onHtmlElementEnd,
  });
};

const startRecipeStructuredTextCapture = (
  element: HtmlRewriterElement,
  builder: RecipeStructuredEvidenceBuilder,
  properties: RecipeStructuredProperty[],
  structuredTextCaptures: RecipeStructuredTextCapture[],
  { onHtmlElementEnd }: { onHtmlElementEnd: HtmlElementEndTagRegistrar },
) => {
  const capture: RecipeStructuredTextCapture = { builder, properties, text: "" };
  structuredTextCaptures.push(capture);
  onHtmlElementEnd(element, () => {
    const normalizedText = normalizeReadableText(capture.text);
    if (normalizedText) {
      appendRecipeStructuredValue(builder, properties, normalizedText, "");
    }

    const captureIndex = structuredTextCaptures.lastIndexOf(capture);
    if (captureIndex >= 0) {
      structuredTextCaptures.splice(captureIndex, 1);
    }
  });
};

const extractStructuredElementValue = (element: HtmlRewriterElement) =>
  firstReadableAttribute(element, ["content", "src", "href", "data", "value", "datetime"]);

const firstReadableAttribute = (element: HtmlRewriterElement, attributes: string[]) => {
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    const normalized = value ? normalizeReadableText(value) : "";
    if (normalized) return normalized;
  }

  return undefined;
};

const appendRecipeStructuredValue = (
  builder: RecipeStructuredEvidenceBuilder,
  properties: RecipeStructuredProperty[],
  value: string,
  baseUrl: string,
) => {
  for (const property of properties) {
    if (property === "name") {
      builder.name ??= value;
    } else if (property === "servingsText") {
      builder.servingsText ??= value;
    } else if (property === "imageUrls") {
      const imageUrl = resolveStructuredImageUrl(value, baseUrl);
      if (imageUrl) builder.imageUrls.push(imageUrl);
    } else if (property === "rawIngredients") {
      builder.rawIngredients.push(value);
    } else if (property === "rawInstructions") {
      builder.rawInstructions.push(value);
    }
  }
};

const normalizeRecipeStructuredEvidence = (
  builder: RecipeStructuredEvidenceBuilder,
): ExtractedRecipeStructuredEvidence | undefined => {
  const evidence = {
    format: builder.format,
    name: builder.name ? normalizeReadableText(builder.name) : undefined,
    servingsText: builder.servingsText ? normalizeReadableText(builder.servingsText) : undefined,
    imageUrls: dedupeStrings(builder.imageUrls.map(normalizeReadableText).filter(Boolean)),
    rawIngredients: dedupeStrings(
      builder.rawIngredients.map(normalizeReadableText).filter(Boolean),
    ),
    rawInstructions: dedupeStrings(
      builder.rawInstructions.map(normalizeReadableText).filter(Boolean),
    ),
    structuredInstructions: builder.structuredInstructions,
  } satisfies ExtractedRecipeStructuredEvidence;

  if (
    !evidence.name &&
    !evidence.servingsText &&
    evidence.imageUrls.length === 0 &&
    evidence.rawIngredients.length === 0 &&
    evidence.rawInstructions.length === 0 &&
    evidence.structuredInstructions.length === 0
  ) {
    return undefined;
  }

  return evidence;
};

const normalizeRecipeStructuredProperties = (value: string | null): RecipeStructuredProperty[] => {
  const properties: RecipeStructuredProperty[] = [];

  for (const token of splitHtmlTokens(value)) {
    const property = normalizeRecipeStructuredProperty(token);
    if (property && !properties.includes(property)) {
      properties.push(property);
    }
  }

  return properties;
};

const normalizeRecipeStructuredProperty = (value: string): RecipeStructuredProperty | undefined => {
  const term = normalizeSchemaTerm(value);
  if (term === "name") return "name";
  if (term === "recipeyield") return "servingsText";
  if (term === "image") return "imageUrls";
  if (term === "recipeingredient") return "rawIngredients";
  if (term === "recipeinstructions" || term === "text" || term === "itemlistelement") {
    return "rawInstructions";
  }

  return undefined;
};

const hasSchemaRecipeType = (value: string | null) =>
  splitHtmlTokens(value).some((token) => normalizeSchemaTerm(token) === "recipe");

const normalizeSchemaTerm = (value: string) => {
  const normalized = value.trim().replace(/\/$/, "");
  const lower = normalized.toLowerCase();

  if (lower.startsWith("http://schema.org/")) {
    return lower.slice("http://schema.org/".length);
  }
  if (lower.startsWith("https://schema.org/")) {
    return lower.slice("https://schema.org/".length);
  }
  if (lower.startsWith("schema:")) {
    return lower.slice("schema:".length);
  }

  return lower;
};

const splitHtmlTokens = (value: string | null) => (value ? value.trim().split(/\s+/) : []);

const resolveStructuredImageUrl = (rawUrl: string, baseUrl: string) => {
  try {
    return new URL(decodeHtml(rawUrl), baseUrl || undefined).toString();
  } catch {
    return undefined;
  }
};

const importPageBodyToResponse = (page: FetchedImportPage) => {
  if (typeof page.body !== "string") {
    return page.body.clone();
  }

  return new Response(page.body, {
    headers: page.contentType ? { "content-type": page.contentType } : undefined,
  });
};

const normalizeMetaKey = (key: string | null) => {
  if (!key) return undefined;

  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey === "description" ||
    normalizedKey === "og:title" ||
    normalizedKey === "og:description" ||
    normalizedKey === "og:site_name" ||
    normalizedKey === "og:image" ||
    normalizedKey === "twitter:title" ||
    normalizedKey === "twitter:description" ||
    normalizedKey === "twitter:image"
  ) {
    return normalizedKey;
  }

  return undefined;
};

const normalizeReadableText = (value: string) =>
  decodeHtml(value).replace(/\s+/g, " ").trim().slice(0, 24_000);

const normalizeImageAlt = (value: string) => normalizeReadableText(value).slice(0, 120);

const formatImageMarker = (id: string, alt?: string) => {
  const normalizedAlt = alt ? normalizeImageAlt(alt) : "";
  return normalizedAlt
    ? `\nRS_IMAGE id=${id} alt="${escapeImageMarkerAttribute(normalizedAlt)}"\n`
    : `\nRS_IMAGE id=${id}\n`;
};

const escapeImageMarkerAttribute = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const normalizeMarkdownContent = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 24_000);

const hasDescriptionMetadata = (meta: HtmlImportExtraction["meta"]) =>
  Boolean(meta.description || meta["og:description"] || meta["twitter:description"]);

const extractRecipeJsonLdEvidence = (
  documents: string[],
  baseUrl: string,
): ExtractedRecipeStructuredEvidence[] => {
  const recipes: ExtractedRecipeStructuredEvidence[] = [];
  const seen = new Set<string>();

  for (const document of documents) {
    try {
      for (const node of collectRecipeJsonLdNodes(JSON.parse(document))) {
        const recipe = normalizeRecipeJsonLdNode(node, baseUrl);
        const key = JSON.stringify(recipe);
        if (seen.has(key)) continue;

        seen.add(key);
        recipes.push(recipe);
      }
    } catch {}
  }

  return recipes;
};

const collectRecipeJsonLdNodes = (value: unknown): Record<string, unknown>[] => {
  const recipes: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    if (isJsonLdRecipeNode(record)) {
      recipes.push(record);
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(value);
  return recipes;
};

const normalizeRecipeJsonLdNode = (
  record: Record<string, unknown>,
  baseUrl: string,
): ExtractedRecipeStructuredEvidence => {
  const structuredInstructions = extractJsonLdStructuredInstructions(
    record.recipeInstructions,
    baseUrl,
  );

  return {
    format: "jsonLd",
    name: firstReadableText(record.name),
    servingsText: firstReadableText(record.recipeYield),
    imageUrls: extractJsonLdImageUrls(record.image, baseUrl),
    rawIngredients: extractReadableTexts(record.recipeIngredient),
    rawInstructions: structuredInstructions.map((instruction) => instruction.text),
    structuredInstructions,
  };
};

const isJsonLdRecipeNode = (record: Record<string, unknown>): boolean => {
  const type = record["@type"];
  const typeValues = Array.isArray(type) ? type : [type];
  return typeValues.some((entry) => typeof entry === "string" && entry.toLowerCase() === "recipe");
};

const extractReadableTexts = (value: unknown): string[] => {
  const texts: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string" || typeof node === "number") {
      texts.push(String(node));
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    if (typeof record.text === "string") {
      texts.push(record.text);
      return;
    }
    if (typeof record.name === "string") {
      texts.push(record.name);
    }
  };

  visit(value);
  return dedupeStrings(texts.map(normalizeReadableText).filter(Boolean));
};

const firstReadableText = (value: unknown) => extractReadableTexts(value)[0];

const extractJsonLdStructuredInstructions = (
  value: unknown,
  baseUrl: string,
): ExtractedRecipeStructuredInstruction[] => {
  const instructions: ExtractedRecipeStructuredInstruction[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const text = normalizeReadableText(node);
      if (text) {
        instructions.push({ text, imageUrls: [] });
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.name === "string" && isJsonLdHowToStepNode(record)
          ? record.name
          : undefined;

    if (text) {
      const normalizedText = normalizeReadableText(text);
      if (normalizedText) {
        instructions.push({
          text: normalizedText,
          imageUrls: extractJsonLdImageUrls(record.image, baseUrl),
        });
      }
    }

    visit(record.itemListElement);
    visit(record.steps);
  };

  visit(value);
  return dedupeStructuredInstructions(instructions);
};

const dedupeStructuredInstructions = (
  instructions: ExtractedRecipeStructuredInstruction[],
): ExtractedRecipeStructuredInstruction[] => {
  const byText = new Map<string, Set<string>>();
  const orderedTexts: string[] = [];

  for (const instruction of instructions) {
    const text = normalizeReadableText(instruction.text);
    if (!text) continue;

    let imageUrls = byText.get(text);
    if (!imageUrls) {
      imageUrls = new Set<string>();
      byText.set(text, imageUrls);
      orderedTexts.push(text);
    }

    for (const imageUrl of instruction.imageUrls) {
      imageUrls.add(imageUrl);
    }
  }

  return orderedTexts.map((text) => ({
    text,
    imageUrls: [...(byText.get(text) ?? [])],
  }));
};

const isJsonLdHowToStepNode = (record: Record<string, unknown>): boolean => {
  const type = record["@type"];
  const typeValues = Array.isArray(type) ? type : [type];
  return typeValues.some(
    (entry) => typeof entry === "string" && entry.toLowerCase() === "howtostep",
  );
};

const extractJsonLdImageUrls = (value: unknown, baseUrl: string): string[] => {
  const urls: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      urls.push(node);
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    visit(record.url);
    visit(record.contentUrl);
  };

  visit(value);
  return dedupeStrings(
    urls.flatMap((rawUrl) => {
      try {
        return new URL(decodeHtml(rawUrl), baseUrl).toString();
      } catch {
        return [];
      }
    }),
  );
};

const buildImportStructuredEvidence = (
  recipes: ExtractedRecipeStructuredEvidence[],
  imageRegistry: ImportImageRegistry,
): RecipeImportStructuredEvidence[] =>
  recipes.map((recipe) => ({
    format: recipe.format,
    name: recipe.name,
    servingsText: recipe.servingsText,
    imageIds: recipe.imageUrls.flatMap((url) => {
      const id = imageRegistry.getOrCreateId(url, recipe.name);
      return id ? [id] : [];
    }),
    rawIngredients: recipe.rawIngredients,
    rawInstructions: recipe.rawInstructions,
    structuredInstructions: recipe.structuredInstructions.map((instruction) => ({
      text: instruction.text,
      imageIds: instruction.imageUrls.flatMap((url) => {
        const id = imageRegistry.getOrCreateId(
          url,
          buildStructuredInstructionImageAlt(recipe, instruction),
        );
        return id ? [id] : [];
      }),
    })),
  }));

const buildStructuredInstructionImageAlt = (
  recipe: ExtractedRecipeStructuredEvidence,
  instruction: ExtractedRecipeStructuredInstruction,
) => normalizeReadableText([recipe.name, instruction.text].filter(Boolean).join(" ")).slice(0, 160);

const dedupeRecipeStructuredEvidence = (
  recipes: ExtractedRecipeStructuredEvidence[],
): ExtractedRecipeStructuredEvidence[] => {
  const seen = new Set<string>();
  const deduped: ExtractedRecipeStructuredEvidence[] = [];

  for (const recipe of recipes) {
    const key = JSON.stringify({
      name: recipe.name,
      servingsText: recipe.servingsText,
      imageUrls: recipe.imageUrls,
      rawIngredients: recipe.rawIngredients,
      rawInstructions: recipe.rawInstructions,
      structuredInstructions: recipe.structuredInstructions,
    });
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(recipe);
  }

  return deduped;
};

const dedupeStrings = (values: string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
};

const decodeHtml = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
