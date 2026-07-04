import {
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_TOTAL_IMAGES,
  type RecipeDraftContent,
  recipeDraftContentSchema,
} from "@recipestock/schemas";

export const trimRecipeDraftContentImages = (draft: RecipeDraftContent): RecipeDraftContent => {
  let remainingImages = MAX_RECIPE_TOTAL_IMAGES;
  const referenceImagesLimit = Math.min(MAX_RECIPE_REFERENCE_IMAGES, Math.max(remainingImages, 0));
  const referenceImages = (draft.referenceImages ?? []).slice(0, referenceImagesLimit);
  remainingImages -= referenceImages.length;

  const steps: RecipeDraftContent["steps"] = [];

  for (const step of draft.steps) {
    const stepImageLimit = Math.min(MAX_RECIPE_STEP_IMAGES, Math.max(remainingImages, 0));
    const images = step.images.slice(0, stepImageLimit);
    remainingImages -= images.length;

    if (!step.text && images.length === 0) {
      continue;
    }

    steps.push({
      ...step,
      images,
    });
  }

  return recipeDraftContentSchema.parse({
    ...draft,
    referenceImages,
    steps,
  });
};
