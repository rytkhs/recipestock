import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { type Bindings } from "../../env";
import { createLogger, type Logger } from "../../logger";
import { getRecipeImportSystemPrompt } from "./prompts";
import {
  type RecipeImportAIDraftContent,
  type RecipeImportAINormalizeRequest,
  type RecipeImportAIProvider,
  RecipeImportError,
} from "./types";

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
  title: z.string().nullable(),
  yieldText: z.string().nullable(),
  coverImageUrl: importAiImageUrlSchema.nullable(),
  ingredientGroups: z.array(importAiIngredientGroupSchema),
  steps: z.array(importAiDraftStepSchema),
  note: z.string().nullable(),
});

const normalizeImportAiDraftContent = (value: unknown): RecipeImportAIDraftContent => {
  const draft = importAiDraftContentSchema.parse(value);

  return {
    title: normalizeTitleCandidate(draft.title),
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

type ImportAiProviderKind = "workers-ai" | "openrouter" | "groq";

const IMPORT_AI_MAX_OUTPUT_TOKENS = 8192;

export const createDefaultRecipeImportAIProvider = (
  env: Bindings,
  { logger = createLogger() }: { logger?: Logger } = {},
): RecipeImportAIProvider => ({
  async normalize(request: RecipeImportAINormalizeRequest) {
    const providerKind = resolveImportAiProvider(env);
    const system = getRecipeImportSystemPrompt(request.promptProfile);
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
        prompt: buildImportUserPrompt(request),
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
        logger,
        providerKind,
        request,
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

const buildImportUserPrompt = (request: RecipeImportAINormalizeRequest) => {
  if (request.promptProfile === "text") {
    return `
text:
<<<PASTED_TEXT
${request.input.text}
PASTED_TEXT`;
  }

  const structuredEvidenceSection =
    request.promptProfile === "generic"
      ? `
recipeStructuredEvidence:
${JSON.stringify(request.input.recipeStructuredEvidence)}
`
      : "";

  return `
source:
${JSON.stringify(request.input.source)}
${structuredEvidenceSection}

markdownContent:
<<<PAGE_CONTENT
${request.input.markdownContent}
PAGE_CONTENT`;
};

export const resolveImportAiTimeoutMs = (env: Partial<Bindings>) => {
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
    logger,
    providerKind,
    request,
    timeoutMs,
  }: {
    env: Partial<Bindings>;
    logger: Logger;
    providerKind: ImportAiProviderKind;
    request: RecipeImportAINormalizeRequest;
    timeoutMs: number;
  },
) => {
  const model = resolveImportAiTextModelForLog(env, providerKind);

  logger.error("recipe_import_ai_normalization_failed", {
    provider: providerKind,
    promptProfile: request.promptProfile,
    model: model || undefined,
    timeoutMs,
    ...(request.promptProfile === "text"
      ? { textLength: request.input.text.length }
      : {
          sourceHost: request.input.source.host,
          sourceUrl: request.input.source.finalUrl,
          markdownContentLength: request.input.markdownContent.length,
        }),
    ...(request.promptProfile === "generic"
      ? { structuredEvidenceCount: request.input.recipeStructuredEvidence.length }
      : {}),
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

const normalizeTitleCandidate = (value: string | null | undefined) => {
  const title = value?.trim();
  return title || null;
};
