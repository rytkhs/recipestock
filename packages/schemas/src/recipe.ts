import { z } from "zod";

const webUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

export const sourceTypeSchema = z.enum(["web", "youtube", "sns", "image", "manual", "other"]);

export const sourcePlatformSchema = z.enum([
  "youtube",
  "instagram",
  "tiktok",
  "x",
  "cookpad",
  "delishkitchen",
  "other",
]);

export const draftImageRefSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tmpObjectKey"),
    key: z.string().min(1),
  }),
  z.object({
    type: z.literal("externalImageUrl"),
    url: z.url(),
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

export const recipeStepSchema = z
  .object({
    text: z.string().min(1).optional(),
    imageKey: z.string().min(1).optional(),
  })
  .refine((step) => step.text || step.imageKey);

export const recipeDraftStepSchema = z
  .object({
    text: z.string().min(1).optional(),
    image: draftImageRefSchema.optional(),
  })
  .refine((step) => step.text || step.image);

export const recipeContentSchema = z.object({
  title: z.string().min(1),
  servingsText: z.string().optional(),
  coverImageKey: z.string().min(1).optional(),
  ingredientGroups: z.array(ingredientGroupSchema).default([]),
  steps: z.array(recipeStepSchema).default([]),
  note: z.string().optional(),
});

export const recipeStepWithUrlSchema = recipeStepSchema.extend({
  imageUrl: z.string().optional(),
});

export const recipeContentWithUrlsSchema = recipeContentSchema.extend({
  coverImageUrl: z.string().optional(),
  steps: z.array(recipeStepWithUrlSchema).default([]),
});

export const recipeDraftContentSchema = z.object({
  title: z.string().min(1),
  servingsText: z.string().optional(),
  coverImage: draftImageRefSchema.optional(),
  ingredientGroups: z.array(ingredientGroupSchema).default([]),
  steps: z.array(recipeDraftStepSchema).default([]),
  note: z.string().optional(),
});

export const recipeSourceDraftSchema = z.object({
  sourceType: sourceTypeSchema,
  sourcePlatform: sourcePlatformSchema.optional().nullable(),
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

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourcePlatform = z.infer<typeof sourcePlatformSchema>;
export type DraftImageRef = z.infer<typeof draftImageRefSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type IngredientGroup = z.infer<typeof ingredientGroupSchema>;
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
