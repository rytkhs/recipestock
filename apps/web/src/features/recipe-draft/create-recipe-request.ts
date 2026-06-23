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
    servingsText: compactText(values.servingsText),
    coverImage: values.coverImage,
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
  servingsText: recipe.content.servingsText ?? "",
  coverImage: recipe.content.coverImage
    ? { type: "existingObjectKey", key: recipe.content.coverImage.objectKey }
    : undefined,
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

export const recipeDraftContentToFormValues = (
  draft: RecipeDraftContent,
): RecipeDraftFormValues => ({
  title: draft.title,
  servingsText: draft.servingsText ?? "",
  coverImage: draft.coverImage,
  note: draft.note ?? "",
  ingredientGroups:
    draft.ingredientGroups.length > 0
      ? draft.ingredientGroups.map((group) => ({
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
    draft.steps.length > 0
      ? draft.steps.map((step) => ({
          text: step.text ?? "",
          images: step.images,
        }))
      : [createEmptyFormStep()],
});

const createEmptyFormStep = () => ({ text: "", images: [] });
