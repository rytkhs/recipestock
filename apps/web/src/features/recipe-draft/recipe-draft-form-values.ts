import {
  draftImageRefSchema,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_TOTAL_IMAGES,
} from "@recipestock/schemas";
import { z } from "zod";

const countRecipeDraftFormImages = (values: {
  coverImage?: unknown;
  referenceImages?: unknown[];
  steps?: { images?: unknown[] }[];
}) =>
  (values.coverImage ? 1 : 0) +
  (values.referenceImages?.length ?? 0) +
  (values.steps ?? []).reduce((count, step) => count + (step.images?.length ?? 0), 0);

export const recipeDraftFormSchema = z
  .object({
    title: z.string().min(1),
    yieldText: z.string().optional(),
    coverImage: draftImageRefSchema.optional(),
    referenceImages: z.array(draftImageRefSchema).max(MAX_RECIPE_REFERENCE_IMAGES),
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
    steps: z.array(
      z.object({
        text: z.string().optional(),
        images: z.array(draftImageRefSchema).max(MAX_RECIPE_STEP_IMAGES),
      }),
    ),
  })
  .superRefine((values, ctx) => {
    if (countRecipeDraftFormImages(values) > MAX_RECIPE_TOTAL_IMAGES) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: `Recipe images must be at most ${MAX_RECIPE_TOTAL_IMAGES}.`,
      });
    }
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
  referenceImages: [],
  note: "",
  ingredientGroups: [createEmptyIngredientGroup()],
  steps: [createEmptyStep()],
});
