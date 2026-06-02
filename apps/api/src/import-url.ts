import {
  type RecipeDraftContent,
  type RecipeSourceDraft,
  recipeDraftContentSchema,
  type SourcePlatform,
} from "@recipestock/schemas";
import { normalizeUrl } from "@recipestock/shared";
import { generateObject } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { type Bindings } from "./env";
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
  url: string;
  kind: "cover" | "content";
  alt?: string;
  nearbyText?: string;
  position: number;
};

export type RecipeImportAIInput = {
  sourceUrl: string;
  sourceName?: string;
  title?: string;
  description?: string;
  text: string;
  jsonLd: string[];
  imageCandidates: RecipeImportImageCandidate[];
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

export const fetchImportPage: RecipeImportFetcher = async (url, { timeoutMs, maxBytes }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "RecipeStockBot/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RecipeImportError("fetch_failed", "Import URL could not be fetched.");
    }

    assertContentLengthAllowed(response, maxBytes);

    return {
      finalUrl: response.url || url,
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

export const genericHtmlImportConverter: RecipeImportConverter = {
  async convert(page) {
    if (page.contentType && !/html/i.test(page.contentType)) {
      throw new RecipeImportError("unsupported_page", "Import URL is not an HTML page.");
    }

    const normalizedUrl = normalizeUrl(page.finalUrl);
    const extraction = await extractHtmlImportData(page);
    const sourceName =
      extraction.meta["og:site_name"] ?? new URL(normalizedUrl).hostname.replace(/^www\./, "");
    const description = extraction.meta.description ?? extraction.meta["og:description"];
    const text = normalizeReadableText(extraction.text);

    if (text.length < 40 && !description) {
      throw new RecipeImportError("extraction_failed", "Recipe text could not be extracted.");
    }

    return {
      type: "requiresAi",
      input: {
        sourceUrl: normalizedUrl,
        sourceName,
        title: normalizeReadableText(extraction.title) || undefined,
        description,
        text,
        jsonLd: extraction.jsonLd,
        imageCandidates: resolveImageCandidates(extraction.imageCandidates, normalizedUrl),
      },
      source: {
        sourceType: "web",
        sourcePlatform: detectSourcePlatform(normalizedUrl),
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
    imageResult = filterDraftImages(draft, conversion.input.imageCandidates);
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

export const createDefaultRecipeImportAIProvider = (env: Bindings): RecipeImportAIProvider => ({
  async normalize(input) {
    const model = resolveImportAiTextModel(env);
    const system = resolveImportRecipeSystemPrompt(env);
    const workersai = createWorkersAI({
      binding: env.AI,
      gateway: { id: env.AI_GATEWAY_NAME },
    });
    const timeoutMs = resolveImportAiTimeoutMs(env);
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    try {
      const result = await generateObject({
        model: workersai(model as never) as never,
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

const buildImportUserPrompt = (input: RecipeImportAIInput) => `sourceUrl: ${input.sourceUrl}
sourceName: ${input.sourceName ?? ""}
title: ${input.title ?? ""}
description: ${input.description ?? ""}

imageCandidates:
${JSON.stringify(input.imageCandidates)}

jsonLd:
${input.jsonLd.join("\n")}

text:
${input.text}`;

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
      steps: draft.steps.map((step) => ({ ...step, image: filterImage(step.image) })),
    }),
    warnings,
  };
};

const detectSourcePlatform = (urlValue: string): SourcePlatform | null => {
  const hostname = new URL(urlValue).hostname.replace(/^www\./, "");

  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "youtube";
  if (hostname.includes("instagram.com")) return "instagram";
  if (hostname.includes("tiktok.com")) return "tiktok";
  if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname.includes("twitter.com")) {
    return "x";
  }
  if (hostname.includes("cookpad.com")) return "cookpad";
  if (hostname.includes("delishkitchen.tv")) return "delishkitchen";

  return "other";
};

type HtmlRewriterElement = Parameters<
  NonNullable<HTMLRewriterElementContentHandlers["element"]>
>[0];

type ExtractedImageCandidate = {
  rawUrl: string;
  kind: "cover" | "content";
  alt?: string;
};

type HtmlImportExtraction = {
  title: string;
  meta: Record<string, string | undefined>;
  text: string;
  jsonLd: string[];
  imageCandidates: ExtractedImageCandidate[];
};

const extractHtmlImportData = async (page: FetchedImportPage): Promise<HtmlImportExtraction> => {
  const extraction: HtmlImportExtraction = {
    title: "",
    meta: {},
    text: "",
    jsonLd: [],
    imageCandidates: [],
  };
  let ignoredTextDepth = 0;
  let jsonLdText: string | null = null;

  const response = importPageBodyToResponse(page);
  const ignoreElementText = {
    element(element: HtmlRewriterElement) {
      ignoredTextDepth += 1;
      element.onEndTag(() => {
        ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
      });
    },
  };

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
          extraction.imageCandidates.push({ rawUrl: content, kind: "cover" });
        }
      },
    })
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
        if (extraction.imageCandidates.length >= 20) return;

        const rawUrl = element.getAttribute("src") ?? element.getAttribute("data-src");
        if (!rawUrl) return;

        extraction.imageCandidates.push({
          rawUrl,
          kind: "content",
          alt: element.getAttribute("alt") ?? undefined,
        });
      },
    })
    .onDocument({
      text(text) {
        if (ignoredTextDepth > 0) return;
        extraction.text += ` ${text.text}`;
      },
    })
    .transform(response)
    .text();

  return {
    ...extraction,
    jsonLd: extraction.jsonLd.filter(Boolean).slice(0, 5),
    imageCandidates: extraction.imageCandidates.slice(0, 20),
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
    normalizedKey === "og:description" ||
    normalizedKey === "og:site_name" ||
    normalizedKey === "og:image" ||
    normalizedKey === "twitter:image"
  ) {
    return normalizedKey;
  }

  return undefined;
};

const normalizeReadableText = (value: string) =>
  decodeHtml(value).replace(/\s+/g, " ").trim().slice(0, 24_000);

const resolveImageCandidates = (
  extractedCandidates: ExtractedImageCandidate[],
  baseUrl: string,
): RecipeImportImageCandidate[] => {
  const candidates: RecipeImportImageCandidate[] = [];
  const pushCandidate = (rawUrl: string | undefined, kind: "cover" | "content", alt?: string) => {
    if (!rawUrl) return;

    try {
      const url = new URL(decodeHtml(rawUrl), baseUrl).toString();
      if (candidates.some((candidate) => candidate.url === url)) return;
      candidates.push({ url, kind, alt, position: candidates.length });
    } catch {
      return;
    }
  };

  for (const candidate of extractedCandidates) {
    pushCandidate(candidate.rawUrl, candidate.kind, candidate.alt);
    if (candidates.length >= 20) break;
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
