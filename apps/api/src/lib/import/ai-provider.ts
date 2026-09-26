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

const IMPORT_AI_MAX_OUTPUT_TOKENS = 8192;

export const createDefaultRecipeImportAIProvider = (
  env: Bindings,
  { logger = createLogger() }: { logger?: Logger } = {},
): RecipeImportAIProvider => ({
  async normalize(request: RecipeImportAINormalizeRequest) {
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
        model: createImportLanguageModel(env, timeoutMs),
        schema: importAiDraftContentSchema,
        system,
        prompt: buildImportUserPrompt(request),
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

const createImportLanguageModel = (env: Bindings, timeoutMs: number) => {
  const model = resolveImportAiTextModel(env);
  const workersai = createWorkersAI({
    binding: env.AI,
    gateway: { id: env.AI_GATEWAY_NAME },
  });

  return workersai(model as never, {
    extraHeaders: { "cf-aig-request-timeout": String(timeoutMs) },
  }) as never;
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

const logImportAiFailure = (
  error: unknown,
  {
    env,
    logger,
    request,
    timeoutMs,
  }: {
    env: Partial<Bindings>;
    logger: Logger;
    request: RecipeImportAINormalizeRequest;
    timeoutMs: number;
  },
) => {
  logger.error("recipe_import_ai_normalization_failed", {
    promptProfile: request.promptProfile,
    model: env.AI_TEXT_MODEL?.trim() || undefined,
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
    gatewayName: env.AI_GATEWAY_NAME?.trim() || undefined,
    error: sanitizeErrorDetails(error),
  });
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
