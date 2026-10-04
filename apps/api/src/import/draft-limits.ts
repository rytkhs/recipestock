import {
  MAX_INGREDIENT_AMOUNT_LENGTH,
  MAX_INGREDIENT_GROUP_INGREDIENTS,
  MAX_INGREDIENT_GROUP_LABEL_LENGTH,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_RECIPE_INGREDIENT_GROUPS,
  MAX_RECIPE_NOTE_LENGTH,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_TOTAL_IMAGES,
  MAX_RECIPE_YIELD_TEXT_LENGTH,
  type RecipeDraftContent,
  recipeDraftContentSchema,
} from "@recipestock/schemas";
import { truncateText } from "@recipestock/shared";

const truncateOptionalText = (value: string | undefined, maxLength: number) =>
  value === undefined ? undefined : truncateText(value, maxLength);

/**
 * 取り込んだ本文を保存できる大きさに収める。取り込みは利用者が長さや枚数を選べないので、
 * 上限を超えた分は末尾から落として保存まで通す。手入力は入力画面で止める。
 */
export const trimRecipeDraftContent = (draft: RecipeDraftContent): RecipeDraftContent => {
  let remainingImages = MAX_RECIPE_TOTAL_IMAGES;
  const referenceImagesLimit = Math.min(MAX_RECIPE_REFERENCE_IMAGES, Math.max(remainingImages, 0));
  const referenceImages = (draft.referenceImages ?? []).slice(0, referenceImagesLimit);
  remainingImages -= referenceImages.length;

  const steps: RecipeDraftContent["steps"] = [];

  for (const step of draft.steps.slice(0, MAX_RECIPE_STEPS)) {
    const stepImageLimit = Math.min(MAX_RECIPE_STEP_IMAGES, Math.max(remainingImages, 0));
    const images = step.images.slice(0, stepImageLimit);
    remainingImages -= images.length;
    const text = truncateOptionalText(step.text, MAX_RECIPE_STEP_TEXT_LENGTH);

    if (!text && images.length === 0) {
      continue;
    }

    steps.push({
      ...step,
      text,
      images,
    });
  }

  return recipeDraftContentSchema.parse({
    ...draft,
    title: truncateText(draft.title, MAX_RECIPE_TITLE_LENGTH),
    yieldText: truncateOptionalText(draft.yieldText, MAX_RECIPE_YIELD_TEXT_LENGTH),
    note: truncateOptionalText(draft.note, MAX_RECIPE_NOTE_LENGTH),
    ingredientGroups: draft.ingredientGroups
      .slice(0, MAX_RECIPE_INGREDIENT_GROUPS)
      .map((group) => ({
        ...group,
        label: truncateOptionalText(group.label, MAX_INGREDIENT_GROUP_LABEL_LENGTH),
        ingredients: group.ingredients
          .slice(0, MAX_INGREDIENT_GROUP_INGREDIENTS)
          .map((ingredient) => ({
            name: truncateText(ingredient.name, MAX_INGREDIENT_NAME_LENGTH),
            amount: truncateText(ingredient.amount, MAX_INGREDIENT_AMOUNT_LENGTH),
          })),
      })),
    referenceImages,
    steps,
  });
};
