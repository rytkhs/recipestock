import { z } from "zod";

export const recipeDraftFormSchema = z.object({
  title: z.string().min(1),
  servingsText: z.string().optional(),
  sourceName: z.string().optional(),
  sourceUrl: z.string().optional(),
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
  steps: z.array(z.object({ text: z.string().optional() })),
});

export type RecipeDraftFormValues = z.infer<typeof recipeDraftFormSchema>;

export const createEmptyIngredientGroup = () => ({
  label: "",
  ingredients: [{ name: "", amount: "" }],
});

export const createEmptyStep = () => ({ text: "" });

export const createEmptyRecipeDraftFormValues = (): RecipeDraftFormValues => ({
  title: "",
  servingsText: "",
  sourceName: "",
  sourceUrl: "",
  note: "",
  ingredientGroups: [createEmptyIngredientGroup()],
  steps: [createEmptyStep()],
});
