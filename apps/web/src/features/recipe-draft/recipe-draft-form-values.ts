import {
  draftImageRefSchema,
  MAX_INGREDIENT_AMOUNT_LENGTH,
  MAX_INGREDIENT_GROUP_INGREDIENTS,
  MAX_INGREDIENT_GROUP_LABEL_LENGTH,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_RECIPE_INGREDIENT_GROUPS,
  MAX_RECIPE_NOTE_LENGTH,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_TOTAL_IMAGES,
  MAX_RECIPE_YIELD_TEXT_LENGTH,
} from "@recipestock/schemas";
import { z } from "zod";
import { countFormImages } from "./form-internals";

export const recipeDraftFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "レシピ名を入力してください")
      .max(MAX_RECIPE_TITLE_LENGTH, `レシピ名は${MAX_RECIPE_TITLE_LENGTH}文字までです。`),
    yieldText: z
      .string()
      .max(
        MAX_RECIPE_YIELD_TEXT_LENGTH,
        `できあがり量は${MAX_RECIPE_YIELD_TEXT_LENGTH}文字までです。`,
      )
      .optional(),
    coverImage: draftImageRefSchema.optional(),
    referenceImages: z
      .array(draftImageRefSchema)
      .max(MAX_RECIPE_REFERENCE_IMAGES, `レシピ画像は${MAX_RECIPE_REFERENCE_IMAGES}枚までです。`),
    note: z
      .string()
      .max(MAX_RECIPE_NOTE_LENGTH, `メモは${MAX_RECIPE_NOTE_LENGTH}文字までです。`)
      .optional(),
    ingredientGroups: z
      .array(
        z.object({
          label: z
            .string()
            .max(
              MAX_INGREDIENT_GROUP_LABEL_LENGTH,
              `グループ名は${MAX_INGREDIENT_GROUP_LABEL_LENGTH}文字までです。`,
            )
            .optional(),
          ingredients: z
            .array(
              z.object({
                name: z
                  .string()
                  .max(
                    MAX_INGREDIENT_NAME_LENGTH,
                    `材料名は${MAX_INGREDIENT_NAME_LENGTH}文字までです。`,
                  )
                  .optional(),
                amount: z
                  .string()
                  .max(
                    MAX_INGREDIENT_AMOUNT_LENGTH,
                    `分量は${MAX_INGREDIENT_AMOUNT_LENGTH}文字までです。`,
                  )
                  .optional(),
              }),
            )
            .max(
              MAX_INGREDIENT_GROUP_INGREDIENTS,
              `1つのグループの材料は${MAX_INGREDIENT_GROUP_INGREDIENTS}個までです。`,
            ),
        }),
      )
      .max(
        MAX_RECIPE_INGREDIENT_GROUPS,
        `材料のグループは${MAX_RECIPE_INGREDIENT_GROUPS}個までです。`,
      ),
    steps: z
      .array(
        z.object({
          text: z
            .string()
            .max(
              MAX_RECIPE_STEP_TEXT_LENGTH,
              `1つの手順は${MAX_RECIPE_STEP_TEXT_LENGTH}文字までです。`,
            )
            .optional(),
          images: z
            .array(draftImageRefSchema)
            .max(
              MAX_RECIPE_STEP_IMAGES,
              `1つの手順に付けられる画像は${MAX_RECIPE_STEP_IMAGES}枚までです。`,
            ),
        }),
      )
      .max(MAX_RECIPE_STEPS, `手順は${MAX_RECIPE_STEPS}個までです。`),
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
