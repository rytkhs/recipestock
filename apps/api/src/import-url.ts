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
import { type Bindings } from "./env";
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

export type ExtractedRecipeJsonLd = {
  name?: string;
  servingsText?: string;
  imageUrls: string[];
  rawIngredients: string[];
  rawInstructions: string[];
};

export type RecipeImportAIInput = {
  source: {
    finalUrl: string;
    host: string;
  };
  structuredContent: string;
  recipeJsonLdEvidence: ExtractedRecipeJsonLd[];
};

export type RecipeImportAIProvider = {
  normalize(input: RecipeImportAIInput): Promise<RecipeDraftContent>;
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

    const response = await fetch(currentUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "RecipeStockBot/1.0",
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
    const extraction = await extractHtmlImportData(page);
    const sourceName =
      extraction.meta["og:site_name"] ?? new URL(normalizedUrl).hostname.replace(/^www\./, "");
    const structuredContent = normalizeStructuredContent(extraction.structuredContent);
    const recipeJsonLdEvidence = extractRecipeJsonLdEvidence(extraction.jsonLd, normalizedUrl);

    if (structuredContent.length < 40 && !hasDescriptionMetadata(extraction.meta)) {
      throw new RecipeImportError("extraction_failed", "Recipe text could not be extracted.");
    }

    const resolvedImageCandidates = resolveImageCandidates(
      appendJsonLdImageCandidates(extraction.imageCandidates, recipeJsonLdEvidence),
      normalizedUrl,
    );

    return {
      type: "requiresAi",
      input: {
        source: {
          finalUrl: normalizedUrl,
          host: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
        },
        structuredContent,
        recipeJsonLdEvidence,
      },
      imageCandidates: resolvedImageCandidates,
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
}: {
  rawUrl: string;
  userId: string;
  env: Partial<Bindings>;
  usageRepository: UsageRepository;
  aiProvider: RecipeImportAIProvider;
  fetcher?: RecipeImportFetcher;
  converters?: RecipeImportConverter[];
  now?: Date;
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

  let draft: RecipeDraftContent;

  try {
    draft = recipeDraftContentSchema.parse(await aiProvider.normalize(conversion.input));
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
    imageResult = filterDraftImages(draft, conversion.imageCandidates);
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

export const createDefaultRecipeImportAIProvider = (env: Bindings): RecipeImportAIProvider => ({
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
        schema: recipeDraftContentSchema,
        system,
        prompt: buildImportUserPrompt(input),
        temperature: 0,
        maxRetries: 0,
        timeout: timeoutMs,
        abortSignal: controller.signal,
      });

      return result.object;
    } catch (error) {
      logImportAiFailure(error, {
        env,
        input,
        providerKind,
        timeoutMs,
      });

      if (didTimeout || isAiTimeoutError(error)) {
        throw new RecipeImportError("ai_timeout", "AI normalization timed out.");
      }

      if (isAiSchemaError(error)) {
        throw new RecipeImportError("ai_schema_invalid", "AI response schema was invalid.");
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

recipeJsonLdEvidence:
${JSON.stringify(input.recipeJsonLdEvidence)}

structuredContent:
<<<PAGE_CONTENT
${input.structuredContent}
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
    providerKind,
    timeoutMs,
  }: {
    env: Partial<Bindings>;
    input: RecipeImportAIInput;
    providerKind: ImportAiProviderKind;
    timeoutMs: number;
  },
) => {
  const model =
    providerKind === "openrouter" ? env.OPENROUTER_TEXT_MODEL?.trim() : env.AI_TEXT_MODEL?.trim();

  console.error("[recipe-import-ai] AI normalization failed", {
    provider: providerKind,
    model: model || undefined,
    timeoutMs,
    sourceHost: input.source.host,
    sourceUrl: input.source.finalUrl,
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

const errorStatusCode = (error: unknown) =>
  typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : undefined;

const isAiTimeoutError = (error: unknown): boolean => {
  if (isAbortError(error)) return true;

  const name = errorName(error).toLowerCase();
  const message = errorMessage(error).toLowerCase();
  const statusCode = errorStatusCode(error);

  if (statusCode === 408 || statusCode === 504) return true;
  if (name.includes("abort") || name.includes("timeout")) return true;
  if (message.includes("abort") || message.includes("timeout") || message.includes("timed out")) {
    return true;
  }

  const cause = errorCause(error);
  return cause ? isAiTimeoutError(cause) : false;
};

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

const filterDraftImages = (
  draft: RecipeDraftContent,
  candidates: RecipeImportImageCandidate[],
): { draft: RecipeDraftContent; warnings: string[] } => {
  const allowedUrls = new Set(candidates.map((candidate) => candidate.url));
  const warnings: string[] = [];
  const filterImage = (image: RecipeDraftContent["coverImage"]) => {
    if (!image || image.type !== "externalImageUrl" || allowedUrls.has(image.url)) {
      return image;
    }

    warnings.push(`AI returned image URL outside extracted candidates: ${image.url}`);
    return undefined;
  };

  return {
    draft: recipeDraftContentSchema.parse({
      ...draft,
      coverImage: filterImage(draft.coverImage),
      steps: draft.steps.map((step) => ({
        ...step,
        images: step.images
          .map(filterImage)
          .filter((image): image is NonNullable<typeof image> => Boolean(image)),
      })),
    }),
    warnings,
  };
};

type HtmlRewriterElement = Parameters<
  NonNullable<HTMLRewriterElementContentHandlers["element"]>
>[0];

type SemanticHtmlTag =
  | "article"
  | "h1"
  | "h2"
  | "h3"
  | "li"
  | "main"
  | "ol"
  | "p"
  | "section"
  | "ul";

type ExtractedImageCandidate = {
  id: string;
  rawUrl: string;
  alt?: string;
};

type HtmlImportExtraction = {
  title: string;
  meta: Record<string, string | undefined>;
  h1: string[];
  structuredContent: string;
  jsonLd: string[];
  imageCandidates: ExtractedImageCandidate[];
};

const extractHtmlImportData = async (page: FetchedImportPage): Promise<HtmlImportExtraction> => {
  const extraction: HtmlImportExtraction = {
    title: "",
    meta: {},
    h1: [],
    structuredContent: "",
    jsonLd: [],
    imageCandidates: [],
  };
  let ignoredTextDepth = 0;
  let semanticElementDepth = 0;
  let jsonLdText: string | null = null;
  const textBuffers: { text: string }[] = [];

  const response = importPageBodyToResponse(page);
  const appendStructuredContent = (value: string) => {
    extraction.structuredContent += value;
  };
  const appendTextContent = (value: string) => {
    const normalized = decodeHtml(value).replace(/\s+/g, " ");
    if (!normalized.trim()) return;

    appendStructuredContent(escapeHtmlText(normalized));
  };
  const appendImageCandidate = (
    rawUrl: string | undefined,
    isContentImage: boolean,
    alt?: string,
  ) => {
    if (!rawUrl || extraction.imageCandidates.length >= 100) return;

    const normalizedAlt = alt ? normalizeReadableText(alt) : undefined;
    const id = `img_${extraction.imageCandidates.length + 1}`;
    extraction.imageCandidates.push({
      id,
      rawUrl,
      alt: normalizedAlt || undefined,
    });

    if (isContentImage) {
      appendStructuredContent(
        `<img src="${escapeHtmlAttribute(rawUrl)}"${normalizedAlt ? ` alt="${escapeHtmlAttribute(normalizedAlt)}"` : ""}>`,
      );
    }
  };
  const ignoreElementText = {
    element(element: HtmlRewriterElement) {
      ignoredTextDepth += 1;
      element.onEndTag(() => {
        ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
      });
    },
  };
  const semanticContainerHandler = (tagName: SemanticHtmlTag) => ({
    element(element: HtmlRewriterElement) {
      if (ignoredTextDepth > 0) return;

      semanticElementDepth += 1;
      appendStructuredContent(`\n<${tagName}>`);
      element.onEndTag(() => {
        appendStructuredContent(`</${tagName}>\n`);
        semanticElementDepth = Math.max(0, semanticElementDepth - 1);
      });
    },
  });
  const semanticTextHandler = (
    tagName: SemanticHtmlTag,
    onNormalizedText?: (text: string) => void,
  ) => ({
    element(element: HtmlRewriterElement) {
      if (ignoredTextDepth > 0) return;

      const buffer = { text: "" };
      textBuffers.push(buffer);
      semanticElementDepth += 1;
      appendStructuredContent(`\n<${tagName}>`);
      element.onEndTag(() => {
        const normalized = normalizeReadableText(buffer.text);
        if (normalized) {
          onNormalizedText?.(normalized);
        }

        appendStructuredContent(`</${tagName}>\n`);
        semanticElementDepth = Math.max(0, semanticElementDepth - 1);
        const bufferIndex = textBuffers.lastIndexOf(buffer);
        if (bufferIndex >= 0) {
          textBuffers.splice(bufferIndex, 1);
        }
      });
    },
    text(text: Parameters<NonNullable<HTMLRewriterElementContentHandlers["text"]>>[0]) {
      if (ignoredTextDepth > 0) return;

      const buffer = textBuffers.at(-1);
      if (buffer) {
        buffer.text += text.text;
      }
      appendTextContent(text.text);
    },
  });

  await new HTMLRewriter()
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
          appendImageCandidate(content, false);
        }
      },
    })
    .on(
      "h1",
      semanticTextHandler("h1", (text) => extraction.h1.push(text)),
    )
    .on("h2", semanticTextHandler("h2"))
    .on("h3", semanticTextHandler("h3"))
    .on("p", semanticTextHandler("p"))
    .on("li", semanticTextHandler("li"))
    .on("main", semanticContainerHandler("main"))
    .on("article", semanticContainerHandler("article"))
    .on("section", semanticContainerHandler("section"))
    .on("ul", semanticContainerHandler("ul"))
    .on("ol", semanticContainerHandler("ol"))
    .on("script", {
      element(element) {
        ignoredTextDepth += 1;
        const type = element.getAttribute("type")?.toLowerCase().replace(/\s+/g, "");
        jsonLdText = type === "application/ld+json" && extraction.jsonLd.length < 5 ? "" : null;
        if (type !== "application/ld+json" || extraction.jsonLd.length >= 5) {
          element.onEndTag(() => {
            ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
          });
          return;
        }

        element.onEndTag(() => {
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
        appendImageCandidate(rawUrl, true, element.getAttribute("alt") ?? undefined);
      },
    })
    .transform(response)
    .text();

  return {
    ...extraction,
    jsonLd: extraction.jsonLd.filter(Boolean).slice(0, 5),
    imageCandidates: extraction.imageCandidates.slice(0, 100),
  };
};

const importPageBodyToResponse = (page: FetchedImportPage) => {
  if (typeof page.body !== "string") {
    return page.body;
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

const normalizeStructuredContent = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 24_000);

const escapeHtmlText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeHtmlAttribute = (value: string) => escapeHtmlText(value).replace(/"/g, "&quot;");

const hasDescriptionMetadata = (meta: HtmlImportExtraction["meta"]) =>
  Boolean(meta.description || meta["og:description"] || meta["twitter:description"]);

const extractRecipeJsonLdEvidence = (
  documents: string[],
  baseUrl: string,
): ExtractedRecipeJsonLd[] => {
  const recipes: ExtractedRecipeJsonLd[] = [];
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
): ExtractedRecipeJsonLd => ({
  name: firstReadableText(record.name),
  servingsText: firstReadableText(record.recipeYield),
  imageUrls: extractJsonLdImageUrls(record.image, baseUrl),
  rawIngredients: extractReadableTexts(record.recipeIngredient),
  rawInstructions: extractInstructionTexts(record.recipeInstructions),
});

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

const extractInstructionTexts = (value: unknown): string[] => {
  const texts: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      texts.push(node);
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
    } else if (typeof record.name === "string" && isJsonLdHowToStepNode(record)) {
      texts.push(record.name);
    }

    visit(record.itemListElement);
    visit(record.steps);
  };

  visit(value);
  return dedupeStrings(texts.map(normalizeReadableText).filter(Boolean));
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

const appendJsonLdImageCandidates = (
  candidates: ExtractedImageCandidate[],
  recipes: ExtractedRecipeJsonLd[],
): ExtractedImageCandidate[] => {
  const nextCandidates = [...candidates];
  const seenUrls = new Set(nextCandidates.map((candidate) => candidate.rawUrl));

  for (const recipe of recipes) {
    for (const url of recipe.imageUrls) {
      if (seenUrls.has(url)) continue;

      seenUrls.add(url);
      nextCandidates.push({
        id: `img_${nextCandidates.length + 1}`,
        rawUrl: url,
        alt: recipe.name,
      });
    }
  }

  return nextCandidates;
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

const resolveImageCandidates = (
  extractedCandidates: ExtractedImageCandidate[],
  baseUrl: string,
): RecipeImportImageCandidate[] => {
  const candidates: RecipeImportImageCandidate[] = [];
  const seenUrls = new Set<string>();
  const pushCandidate = (candidate: ExtractedImageCandidate) => {
    const { rawUrl } = candidate;
    if (!rawUrl) return;

    try {
      const url = new URL(decodeHtml(rawUrl), baseUrl).toString();
      if (seenUrls.has(url)) return;

      seenUrls.add(url);
      candidates.push({
        id: candidate.id,
        url,
        alt: candidate.alt,
        position: candidates.length,
      });
    } catch {
      return;
    }
  };

  for (const candidate of extractedCandidates) {
    pushCandidate(candidate);
    if (candidates.length >= 100) break;
  }

  return candidates;
};

const decodeHtml = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
