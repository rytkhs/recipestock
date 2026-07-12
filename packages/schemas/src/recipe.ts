import { z } from "zod";

export const MAX_RECIPE_REFERENCE_IMAGES = 20;
export const MAX_RECIPE_STEP_IMAGES = 10;
export const MAX_RECIPE_TOTAL_IMAGES = 100;

const webUrlSchema = z.url({ protocol: /^https?$/ });

export const draftImageRefSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tmpObjectKey"),
    key: z.string().min(1),
  }),
  z.object({
    type: z.literal("externalImageUrl"),
    url: webUrlSchema,
  }),
  z.object({
    type: z.literal("existingObjectKey"),
    key: z.string().min(1),
  }),
]);

export const ingredientSchema = z.object({
  name: z.string().min(1),
  amount: z.string(),
});

export const ingredientGroupSchema = z.object({
  label: z.string().optional(),
  ingredients: z.array(ingredientSchema).default([]),
});

export const recipeImageSchema = z.object({
  objectKey: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const recipeImageWithUrlSchema = recipeImageSchema.extend({
  url: z.string().optional(),
});

const countRecipeImages = (content: {
  referenceImages?: unknown[];
  steps?: { images?: unknown[] }[];
}) =>
  (content.referenceImages?.length ?? 0) +
  (content.steps ?? []).reduce((count, step) => count + (step.images?.length ?? 0), 0);

const validateRecipeTotalImages = (
  content: {
    referenceImages?: unknown[];
    steps?: { images?: unknown[] }[];
  },
  ctx: z.RefinementCtx,
) => {
  if (countRecipeImages(content) > MAX_RECIPE_TOTAL_IMAGES) {
    ctx.addIssue({
      code: "custom",
      path: ["steps"],
      message: `Recipe images must be at most ${MAX_RECIPE_TOTAL_IMAGES}.`,
    });
  }
};

export const recipeStepSchema = z
  .object({
    text: z.string().min(1).optional(),
    images: z.array(recipeImageSchema).max(MAX_RECIPE_STEP_IMAGES).default([]),
  })
  .refine((step) => step.text || step.images.length > 0);

export const recipeDraftStepSchema = z
  .object({
    text: z.string().min(1).optional(),
    images: z.array(draftImageRefSchema).max(MAX_RECIPE_STEP_IMAGES).default([]),
  })
  .refine((step) => step.text || step.images.length > 0);

export const recipeContentSchema = z
  .object({
    title: z.string().min(1),
    yieldText: z.string().optional(),
    coverImage: recipeImageSchema.optional(),
    referenceImages: z.array(recipeImageSchema).max(MAX_RECIPE_REFERENCE_IMAGES).default([]),
    ingredientGroups: z.array(ingredientGroupSchema).default([]),
    steps: z.array(recipeStepSchema).default([]),
    note: z.string().optional(),
  })
  .superRefine(validateRecipeTotalImages);

export const recipeStepWithUrlSchema = recipeStepSchema.safeExtend({
  images: z.array(recipeImageWithUrlSchema).max(MAX_RECIPE_STEP_IMAGES).default([]),
});

export const recipeContentWithUrlsSchema = recipeContentSchema.safeExtend({
  coverImage: recipeImageWithUrlSchema.optional(),
  referenceImages: z.array(recipeImageWithUrlSchema).max(MAX_RECIPE_REFERENCE_IMAGES).default([]),
  steps: z.array(recipeStepWithUrlSchema).default([]),
});

export const recipeDraftContentSchema = z
  .object({
    title: z.string().min(1),
    yieldText: z.string().optional(),
    coverImage: draftImageRefSchema.optional(),
    referenceImages: z.array(draftImageRefSchema).max(MAX_RECIPE_REFERENCE_IMAGES).default([]),
    ingredientGroups: z.array(ingredientGroupSchema).default([]),
    steps: z.array(recipeDraftStepSchema).default([]),
    note: z.string().optional(),
  })
  .superRefine(validateRecipeTotalImages);

export const recipeSourceDraftSchema = z.object({
  sourceUrl: webUrlSchema.optional().nullable(),
  sourceName: z.string().optional().nullable(),
});

export const recipeSourceSchema = recipeSourceDraftSchema.extend({
  normalizedSourceUrl: webUrlSchema.optional().nullable(),
});

export const recipeDetailSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content: recipeContentWithUrlsSchema,
  source: recipeSourceSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  locked: z.literal(false),
});

export const lockedRecipeDetailSchema = z.strictObject({
  id: z.string().min(1),
  locked: z.literal(true),
});

export const createRecipeRequestSchema = z.object({
  content: recipeDraftContentSchema,
  source: recipeSourceDraftSchema,
});

export const createRecipeResponseSchema = z.object({
  recipe: recipeDetailSchema,
});

export const updateRecipeRequestSchema = z.object({
  content: recipeDraftContentSchema,
});

export const updateRecipeResponseSchema = z.object({
  recipe: recipeDetailSchema,
});

export const deleteRecipeResponseSchema = z.object({
  ok: z.literal(true),
});

export const listRecipesQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export const recipeListItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  coverImageUrl: z.string().nullable(),
  sourceName: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  locked: z.boolean(),
});

export const listRecipesResponseSchema = z.object({
  items: z.array(recipeListItemSchema),
  nextCursor: z.string().nullable().optional(),
});

export const getRecipeResponseSchema = z.object({
  recipe: z.discriminatedUnion("locked", [recipeDetailSchema, lockedRecipeDetailSchema]),
});

export type DraftImageRef = z.infer<typeof draftImageRefSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type IngredientGroup = z.infer<typeof ingredientGroupSchema>;
export type RecipeImage = z.infer<typeof recipeImageSchema>;
export type RecipeImageWithUrl = z.infer<typeof recipeImageWithUrlSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type RecipeStepWithUrl = z.infer<typeof recipeStepWithUrlSchema>;
export type RecipeDraftStep = z.infer<typeof recipeDraftStepSchema>;
export type RecipeContent = z.infer<typeof recipeContentSchema>;
export type RecipeContentWithUrls = z.infer<typeof recipeContentWithUrlsSchema>;
export type RecipeDraftContent = z.infer<typeof recipeDraftContentSchema>;
export type RecipeSourceDraft = z.infer<typeof recipeSourceDraftSchema>;
export type RecipeSource = z.infer<typeof recipeSourceSchema>;
export type RecipeDetail = z.infer<typeof recipeDetailSchema>;
export type LockedRecipeDetail = z.infer<typeof lockedRecipeDetailSchema>;
export type CreateRecipeRequest = z.infer<typeof createRecipeRequestSchema>;
export type CreateRecipeResponse = z.infer<typeof createRecipeResponseSchema>;
export type UpdateRecipeRequest = z.infer<typeof updateRecipeRequestSchema>;
export type UpdateRecipeResponse = z.infer<typeof updateRecipeResponseSchema>;
export type DeleteRecipeResponse = z.infer<typeof deleteRecipeResponseSchema>;
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;
export type RecipeListItem = z.infer<typeof recipeListItemSchema>;
export type ListRecipesResponse = z.infer<typeof listRecipesResponseSchema>;
export type GetRecipeResponse = z.infer<typeof getRecipeResponseSchema>;
