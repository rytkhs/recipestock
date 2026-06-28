import { draftImageRefSchema } from "@recipestock/schemas";
import { z } from "zod";

export const recipeDraftFormSchema = z.object({
  title: z.string().min(1),
  yieldText: z.string().optional(),
  coverImage: draftImageRefSchema.optional(),
  sourceMedia: z.array(draftImageRefSchema),
  note: z.string().optional(),
  ingredientGroups: z.array(
    z.object({
      label: z.string().optional(),
      ingredients: z.array(
        z.object({
          name: z.string().optional(),
          amount: z.string().optional(),
        }),
      ),
    }),
  ),
  steps: z.array(z.object({ text: z.string().optional(), images: z.array(draftImageRefSchema) })),
});

export type RecipeDraftFormValues = z.infer<typeof recipeDraftFormSchema>;

export const createEmptyIngredientGroup = () => ({
  label: "",
  ingredients: [{ name: "", amount: "" }],
});

export const createEmptyStep = () => ({ text: "", images: [] });

export const createEmptyRecipeDraftFormValues = (): RecipeDraftFormValues => ({
  title: "",
  yieldText: "",
  sourceMedia: [],
  note: "",
  ingredientGroups: [createEmptyIngredientGroup()],
  steps: [createEmptyStep()],
});
