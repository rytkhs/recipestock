import {
  type CreateRecipeRequest,
  createRecipeRequestSchema,
  type RecipeDetail,
  type RecipeDraftContent,
  type RecipeSourceDraft,
  recipeDraftContentSchema,
} from "@recipestock/schemas";
import { type RecipeDraftFormValues } from "./recipe-draft-form-values";

const compactText = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const formValuesToCreateRecipeRequest = (
  values: RecipeDraftFormValues,
  source: RecipeSourceDraft = {},
): CreateRecipeRequest => {
  return createRecipeRequestSchema.parse({
    content: formValuesToRecipeDraftContent(values),
    source,
  });
};

export const formValuesToRecipeDraftContent = (
  values: RecipeDraftFormValues,
): RecipeDraftContent => {
  return recipeDraftContentSchema.parse({
    title: values.title.trim(),
    yieldText: compactText(values.yieldText),
    coverImage: values.coverImage,
    referenceImages: values.referenceImages,
    ingredientGroups: values.ingredientGroups
      .map((group) => ({
        label: compactText(group.label),
        ingredients: group.ingredients
          .map((ingredient) => ({
            name: ingredient.name?.trim() ?? "",
            amount: ingredient.amount?.trim() ?? "",
          }))
          .filter((ingredient) => ingredient.name),
      }))
      .filter((group) => group.label || group.ingredients.length > 0),
    steps: values.steps
      .map((step) => ({ text: compactText(step.text), images: step.images }))
      .filter((step) => step.text || step.images.length > 0),
    note: compactText(values.note),
  });
};

export const recipeDetailToFormValues = (recipe: RecipeDetail): RecipeDraftFormValues => ({
  title: recipe.content.title,
  yieldText: recipe.content.yieldText ?? "",
  coverImage: recipe.content.coverImage
    ? { type: "existingObjectKey", key: recipe.content.coverImage.objectKey }
    : undefined,
  referenceImages: (recipe.content.referenceImages ?? []).map((image) => ({
    type: "existingObjectKey",
    key: image.objectKey,
  })),
  note: recipe.content.note ?? "",
  ingredientGroups:
    recipe.content.ingredientGroups.length > 0
      ? recipe.content.ingredientGroups.map((group) => ({
          label: group.label ?? "",
          ingredients:
            group.ingredients.length > 0
              ? group.ingredients.map((ingredient) => ({
                  name: ingredient.name,
                  amount: ingredient.amount,
                }))
              : [{ name: "", amount: "" }],
        }))
      : [{ label: "", ingredients: [{ name: "", amount: "" }] }],
  steps:
    recipe.content.steps.length > 0
      ? recipe.content.steps.map((step) => ({
          text: step.text ?? "",
          images: step.images.map((image) => ({
            type: "existingObjectKey",
            key: image.objectKey,
          })),
        }))
      : [createEmptyFormStep()],
});

const createEmptyFormStep = () => ({ text: "", images: [] });
