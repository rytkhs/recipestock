import { z } from "zod";

export const ingredientSchema = z.object({
  text: z.string().min(1),
  quantity: z.string().optional(),
  unit: z.string().optional(),
  name: z.string().optional(),
});

export const ingredientGroupSchema = z.object({
  title: z.string().optional(),
  ingredients: z.array(ingredientSchema).min(1),
});

export const recipeStepSchema = z.object({
  text: z.string().min(1),
});

export const recipeContentSchema = z.object({
  title: z.string().min(1),
  servings: z.string().optional(),
  ingredientGroups: z.array(ingredientGroupSchema).min(1),
  steps: z.array(recipeStepSchema).min(1),
  note: z.string().optional(),
});

export const recipeDraftContentSchema = recipeContentSchema;

export type Ingredient = z.infer<typeof ingredientSchema>;
export type IngredientGroup = z.infer<typeof ingredientGroupSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type RecipeContent = z.infer<typeof recipeContentSchema>;
export type RecipeDraftContent = z.infer<typeof recipeDraftContentSchema>;
