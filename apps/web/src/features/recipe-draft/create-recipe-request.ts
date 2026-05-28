import { type CreateRecipeRequest, createRecipeRequestSchema } from "@recipestock/schemas";
import { type RecipeDraftFormValues } from "./recipe-draft-form-values";

const compactText = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const formValuesToCreateRecipeRequest = (
  values: RecipeDraftFormValues,
): CreateRecipeRequest => {
  const sourceUrl = compactText(values.sourceUrl);
  const sourceName = compactText(values.sourceName);

  return createRecipeRequestSchema.parse({
    content: {
      title: values.title.trim(),
      servingsText: compactText(values.servingsText),
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
        .map((step) => ({ text: step.text?.trim() ?? "" }))
        .filter((step) => step.text),
      note: compactText(values.note),
    },
    source: {
      sourceType: "manual",
      sourceName,
      sourceUrl,
    },
  });
};
