import { z } from "zod";
import { MAX_RECIPE_TAGS, recipeTagSchema } from "./tag";

export const MAX_RECIPE_REFERENCE_IMAGES = 20;
export const MAX_RECIPE_STEP_IMAGES = 10;
export const MAX_RECIPE_TOTAL_IMAGES = 100;

/**
 * 本文の長さと件数の上限。AIの出力予算(8,192トークン)に収まる大きさを基準にしていて、
 * 手入力でこれを超えるレシピは想定しない。
 *
 * 上限は書き込み経路(recipeDraftContentSchema)にだけ置く。保存済みの本文を読む
 * recipeContentSchemaは読み取りのたびに検証するので、上限を足したり縮めたりすると
 * 既存のRecipeが読めなくなるためである。取り込みは利用者が長さを選べないので、
 * 拒否せずAPI側で末尾から切り詰める。
 */
export const MAX_RECIPE_TITLE_LENGTH = 200;
export const MAX_RECIPE_YIELD_TEXT_LENGTH = 100;
export const MAX_RECIPE_NOTE_LENGTH = 5000;
export const MAX_RECIPE_STEP_TEXT_LENGTH = 2000;
export const MAX_RECIPE_STEPS = 100;
export const MAX_RECIPE_INGREDIENT_GROUPS = 50;
export const MAX_INGREDIENT_GROUP_LABEL_LENGTH = 100;
export const MAX_INGREDIENT_GROUP_INGREDIENTS = 100;
export const MAX_INGREDIENT_NAME_LENGTH = 200;
export const MAX_INGREDIENT_AMOUNT_LENGTH = 100;
export const MAX_RECIPE_SOURCE_NAME_LENGTH = 200;
export const MAX_RECIPE_SOURCE_URL_LENGTH = 4096;

/**
 * 検索語はそれぞれWHEREの条件になるので、語数がそのまま条件の数になる。
 */
export const MAX_RECIPE_SEARCH_QUERY_LENGTH = 200;
export const MAX_RECIPE_SEARCH_TERMS = 8;

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

export const recipeDraftIngredientSchema = z.object({
  name: z.string().min(1).max(MAX_INGREDIENT_NAME_LENGTH),
  amount: z.string().max(MAX_INGREDIENT_AMOUNT_LENGTH),
});

export const recipeDraftIngredientGroupSchema = z.object({
  label: z.string().max(MAX_INGREDIENT_GROUP_LABEL_LENGTH).optional(),
  ingredients: z
    .array(recipeDraftIngredientSchema)
    .max(MAX_INGREDIENT_GROUP_INGREDIENTS)
    .default([]),
});

export const recipeDraftStepSchema = z
  .object({
    text: z.string().min(1).max(MAX_RECIPE_STEP_TEXT_LENGTH).optional(),
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
    title: z.string().min(1).max(MAX_RECIPE_TITLE_LENGTH),
    yieldText: z.string().max(MAX_RECIPE_YIELD_TEXT_LENGTH).optional(),
    coverImage: draftImageRefSchema.optional(),
    referenceImages: z.array(draftImageRefSchema).max(MAX_RECIPE_REFERENCE_IMAGES).default([]),
    ingredientGroups: z
      .array(recipeDraftIngredientGroupSchema)
      .max(MAX_RECIPE_INGREDIENT_GROUPS)
      .default([]),
    steps: z.array(recipeDraftStepSchema).max(MAX_RECIPE_STEPS).default([]),
    note: z.string().max(MAX_RECIPE_NOTE_LENGTH).optional(),
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
  // 付けた順に並べる。
  tags: z.array(recipeTagSchema),
  locked: z.literal(false),
});

export const lockedRecipeDetailSchema = z.strictObject({
  id: z.string().min(1),
  locked: z.literal(true),
});

export const createRecipeRequestSchema = z.object({
  content: recipeDraftContentSchema,
  // 出典の長さも書き込み経路にだけ上限を置く。取り込みの出典名はページ由来で長さを選べないので、
  // このschemaを通らずAPI側で切り詰める。
  source: recipeSourceDraftSchema.extend({
    sourceUrl: webUrlSchema.max(MAX_RECIPE_SOURCE_URL_LENGTH).optional().nullable(),
    sourceName: z.string().max(MAX_RECIPE_SOURCE_NAME_LENGTH).optional().nullable(),
  }),
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

// 一覧は追加日（createdAt）で並べる。Freeのロック判定も同じ軸なので、どちらの向きでもロック中は一続きになる。
export const recipeListSortSchema = z.enum(["newest", "oldest"]);

export const listRecipesQuerySchema = z
  .object({
    q: z.string().max(MAX_RECIPE_SEARCH_QUERY_LENGTH).optional(),
    sort: recipeListSortSchema.default("newest"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
    // 指定したタグがすべて付いたRecipeに絞る。付いている個数で判定するので重複は除く。
    tagId: z
      .array(z.string().min(1))
      .max(MAX_RECIPE_TAGS)
      .default([])
      .transform((tagIds) => [...new Set(tagIds)]),
    // タグが1つも付いていないRecipeに絞る。タグの指定とは同時に使えない。
    untagged: z.stringbool().default(false),
  })
  .refine((query) => !(query.untagged && query.tagId.length > 0), {
    path: ["untagged"],
    message: "untagged cannot be combined with tagId.",
  });

export const recipeListItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  coverImageUrl: z.string().nullable(),
  sourceName: z.string().nullable(),
  createdAt: z.string().min(1),
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
export type RecipeDraftIngredient = z.infer<typeof recipeDraftIngredientSchema>;
export type RecipeDraftIngredientGroup = z.infer<typeof recipeDraftIngredientGroupSchema>;
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
export type RecipeListSort = z.infer<typeof recipeListSortSchema>;
export type ListRecipesQuery = z.infer<typeof listRecipesQuerySchema>;
export type RecipeListItem = z.infer<typeof recipeListItemSchema>;
export type ListRecipesResponse = z.infer<typeof listRecipesResponseSchema>;
export type GetRecipeResponse = z.infer<typeof getRecipeResponseSchema>;
