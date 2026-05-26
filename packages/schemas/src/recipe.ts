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

export const recipeStepSchema = z.object({
  text: z.string().min(1),
  imageKey: z.string().min(1).optional(),
});

export const recipeDraftStepSchema = z.object({
  text: z.string().min(1),
  image: draftImageRefSchema.optional(),
});

export const recipeContentSchema = z.object({
  title: z.string().min(1),
  servingsText: z.string().optional(),
  coverImageKey: z.string().min(1).optional(),
  ingredientGroups: z.array(ingredientGroupSchema).default([]),
  steps: z.array(recipeStepSchema).default([]),
  note: z.string().optional(),
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
  content: recipeContentSchema,
  source: recipeSourceSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  locked: z.literal(false),
});

export const createRecipeRequestSchema = z.object({
  content: recipeDraftContentSchema,
  source: recipeSourceDraftSchema,
});

export const createRecipeResponseSchema = z.object({
  recipe: recipeDetailSchema,
});

export const getRecipeResponseSchema = createRecipeResponseSchema;

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourcePlatform = z.infer<typeof sourcePlatformSchema>;
export type DraftImageRef = z.infer<typeof draftImageRefSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type IngredientGroup = z.infer<typeof ingredientGroupSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type RecipeDraftStep = z.infer<typeof recipeDraftStepSchema>;
export type RecipeContent = z.infer<typeof recipeContentSchema>;
export type RecipeDraftContent = z.infer<typeof recipeDraftContentSchema>;
export type RecipeSourceDraft = z.infer<typeof recipeSourceDraftSchema>;
export type RecipeSource = z.infer<typeof recipeSourceSchema>;
export type RecipeDetail = z.infer<typeof recipeDetailSchema>;
export type CreateRecipeRequest = z.infer<typeof createRecipeRequestSchema>;
export type CreateRecipeResponse = z.infer<typeof createRecipeResponseSchema>;
