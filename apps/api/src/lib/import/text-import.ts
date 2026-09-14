import { type RecipeDraftContent, recipeDraftContentSchema } from "@recipestock/schemas";
import { z } from "zod";
import { type Bindings } from "../../env";
import { createLogger, type Logger } from "../../logger";
import { type AiUsageConsumptionRepository } from "../../usage";
import { normalizeRecipeWithAi } from "./ai-normalization";
import { assertImportJobDeadline } from "./deadline";
import {
  type RecipeImportAIDraftContent,
  type RecipeImportAIProvider,
  RecipeImportError,
  type RecipeImportResult,
} from "./types";

const TITLE_FALLBACK_MAX_LENGTH = 80;

/**
 * 貼り付けられた原文からRecipeを作る。URL取り込みと違い取得や抽出の段階はなく、原文をそのままAIへ渡す。
 */
export const importRecipeFromText = async ({
  sourceText,
  userId,
  env,
  usageRepository,
  aiProvider,
  now = new Date(),
  deadline,
  getCurrentDate,
  logger = createLogger(),
}: {
  sourceText: string;
  userId: string;
  env: Partial<Bindings>;
  usageRepository: AiUsageConsumptionRepository;
  aiProvider?: RecipeImportAIProvider;
  now?: Date;
  deadline?: Date;
  getCurrentDate?: () => Date;
  logger?: Logger;
}): Promise<RecipeImportResult> => {
  assertImportJobDeadline(deadline, getCurrentDate?.() ?? new Date());

  const draft = await normalizeRecipeWithAi({
    request: { promptProfile: "text", input: { text: sourceText } },
    userId,
    env,
    usageRepository,
    aiProvider,
    now,
    deadline,
    getCurrentDate,
    logger,
  });
  const recipeDraftContent = toTextRecipeDraftContent(draft, sourceText);

  /**
   * 材料も手順もないRecipeは保存しても使い道がない。失敗にして、原文を直して送り直せるようにする。
   */
  if (!hasRecipeBody(recipeDraftContent)) {
    throw new RecipeImportError(
      "extraction_failed",
      "Recipe could not be extracted from the text.",
    );
  }

  return {
    recipeDraftContent,
    source: { sourceUrl: null, sourceName: null },
    warnings: [],
  };
};

/**
 * テキストには画像がないので、AIが画像URLを返しても採用しない。Recipeにはタイトルが必須であり、
 * AIが付けなかったときは、URL取り込みのページmetadataに当たるものとして原文の最初の行を使う。
 */
const toTextRecipeDraftContent = (
  draft: RecipeImportAIDraftContent,
  sourceText: string,
): RecipeDraftContent => {
  try {
    return recipeDraftContentSchema.parse({
      title: draft.title?.trim() || firstLineOf(sourceText),
      yieldText: draft.yieldText,
      referenceImages: [],
      ingredientGroups: draft.ingredientGroups,
      steps: draft.steps.flatMap((step) => (step.text ? [{ text: step.text, images: [] }] : [])),
      note: draft.note,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new RecipeImportError("ai_schema_invalid", "AI response schema was invalid.");
    }

    throw error;
  }
};

const firstLineOf = (text: string) => {
  const firstLine = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  return Array.from(firstLine).slice(0, TITLE_FALLBACK_MAX_LENGTH).join("");
};

const hasRecipeBody = (content: RecipeDraftContent) =>
  content.steps.length > 0 ||
  content.ingredientGroups.some((group) => group.ingredients.length > 0);
