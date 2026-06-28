import {
  MAX_RECIPE_SOURCE_MEDIA_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_TOTAL_IMAGES,
  type RecipeDraftContent,
  recipeDraftContentSchema,
} from "@recipestock/schemas";

export const trimRecipeDraftContentImages = (draft: RecipeDraftContent): RecipeDraftContent => {
  let remainingImages = MAX_RECIPE_TOTAL_IMAGES - (draft.coverImage ? 1 : 0);
  const sourceMediaLimit = Math.min(MAX_RECIPE_SOURCE_MEDIA_IMAGES, Math.max(remainingImages, 0));
  const sourceMedia = (draft.sourceMedia ?? []).slice(0, sourceMediaLimit);
  remainingImages -= sourceMedia.length;

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
    sourceMedia,
    steps,
  });
};
