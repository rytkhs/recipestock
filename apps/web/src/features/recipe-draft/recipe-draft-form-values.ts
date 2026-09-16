import {
  draftImageRefSchema,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_TOTAL_IMAGES,
} from "@recipestock/schemas";
import { z } from "zod";
import { countFormImages } from "./form-internals";

export const recipeDraftFormSchema = z
  .object({
    title: z.string().trim().min(1, "レシピ名を入力してください"),
    yieldText: z.string().optional(),
    coverImage: draftImageRefSchema.optional(),
    referenceImages: z
      .array(draftImageRefSchema)
      .max(MAX_RECIPE_REFERENCE_IMAGES, `レシピ画像は${MAX_RECIPE_REFERENCE_IMAGES}枚までです。`),
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
        images: z
          .array(draftImageRefSchema)
          .max(
            MAX_RECIPE_STEP_IMAGES,
            `1つの手順に付けられる画像は${MAX_RECIPE_STEP_IMAGES}枚までです。`,
          ),
      }),
    ),
  })
  .superRefine((values, ctx) => {
    if (countFormImages(values) > MAX_RECIPE_TOTAL_IMAGES) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: `画像は全部で${MAX_RECIPE_TOTAL_IMAGES}枚までです。`,
      });
    }
  });

export type RecipeDraftFormValues = z.infer<typeof recipeDraftFormSchema>;

export const createEmptyIngredient = () => ({ name: "", amount: "" });

export const createEmptyIngredientGroup = () => ({
  label: "",
  ingredients: [createEmptyIngredient()],
});

export const createEmptyStep = () => ({ text: "", images: [] });

// 表紙の欄もキーとして持たせる。キーがないと、欄を登録したときに値の側にだけキーが増え、
// 何も変えていなくても変更ありと判定されて、閉じるたびに破棄の確認が出る。
export const createEmptyRecipeDraftFormValues = (): RecipeDraftFormValues => ({
  title: "",
  yieldText: "",
  coverImage: undefined,
  referenceImages: [],
  note: "",
  ingredientGroups: [createEmptyIngredientGroup()],
  steps: [createEmptyStep()],
});
