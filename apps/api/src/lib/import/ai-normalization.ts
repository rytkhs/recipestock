import { z } from "zod";
import { type Bindings } from "../../env";
import { type Logger } from "../../logger";
import { type AiUsageConsumptionRepository, consumeAiUsage } from "../../usage";
import { createDefaultRecipeImportAIProvider, resolveImportAiTimeoutMs } from "./ai-provider";
import { assertImportJobDeadline, resolveBoundedTimeoutMs } from "./deadline";
import {
  type RecipeImportAIDraftContent,
  type RecipeImportAINormalizeRequest,
  type RecipeImportAIProvider,
  RecipeImportError,
} from "./types";

/**
 * AI利用回数はproviderを呼ぶ直前に消費する。取得や抽出で失敗したImport Jobはここへ到達しないので、
 * 枠を減らさない。
 */
export const normalizeRecipeWithAi = async ({
  request,
  userId,
  env,
  usageRepository,
  aiProvider,
  now,
  deadline,
  getCurrentDate,
  logger,
}: {
  request: RecipeImportAINormalizeRequest;
  userId: string;
  env: Partial<Bindings>;
  usageRepository: AiUsageConsumptionRepository;
  aiProvider?: RecipeImportAIProvider;
  now: Date;
  deadline?: Date;
  getCurrentDate?: () => Date;
  logger: Logger;
}): Promise<RecipeImportAIDraftContent> => {
  const currentDate = () => getCurrentDate?.() ?? new Date();
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

  try {
    const draft = await importAIProvider.normalize(request);
    assertImportJobDeadline(deadline, currentDate());
    return draft;
  } catch (error) {
    if (error instanceof RecipeImportError) {
      throw error;
    }

    if (error instanceof z.ZodError) {
      throw new RecipeImportError("ai_schema_invalid", "AI response schema was invalid.");
    }

    throw new RecipeImportError("unknown", "AI normalization failed.");
  }
};
