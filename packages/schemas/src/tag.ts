import { z } from "zod";

export const MAX_TAG_NAME_LENGTH = 20;
export const MAX_RECIPE_TAGS = 10;
// 語彙の数に上限はないが、並びの置き換えで受け取る配列の長さは決めておく。
export const MAX_TAG_ORDER_IDS = 500;

export const recipeTagSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const tagWithCountSchema = recipeTagSchema.extend({
  recipeCount: z.number().int().nonnegative(),
});

export const listTagsResponseSchema = z.object({
  tags: z.array(tagWithCountSchema),
});

// 名前はAPIで揃えてから空・長さ・重複を判定する。ここでは形と個数だけを見る。
export const replaceRecipeTagsRequestSchema = z.object({
  names: z.array(z.string()).max(MAX_RECIPE_TAGS),
});

export const replaceRecipeTagsResponseSchema = z.object({
  tags: z.array(recipeTagSchema),
});

// 並びは全体を送って置き換える。送られなかったタグは今の相対順のまま後ろに回る。
export const reorderTagsRequestSchema = z.object({
  tagIds: z.array(z.string().min(1)).max(MAX_TAG_ORDER_IDS),
});

export const reorderTagsResponseSchema = z.object({
  ok: z.literal(true),
});

export const renameTagRequestSchema = z.object({
  name: z.string(),
});

export const renameTagResponseSchema = z.object({
  tag: recipeTagSchema,
});

// 名前の変更先が既存のタグと重なったときに返す。画面はこのタグへの統合を確認する。
export const tagNameConflictDetailsSchema = z.object({
  tag: recipeTagSchema,
});

export const mergeTagRequestSchema = z.object({
  intoTagId: z.string().min(1),
});

export const mergeTagResponseSchema = z.object({
  tag: recipeTagSchema,
});

export const deleteTagResponseSchema = z.object({
  ok: z.literal(true),
});

export type RecipeTag = z.infer<typeof recipeTagSchema>;
export type TagWithCount = z.infer<typeof tagWithCountSchema>;
export type ListTagsResponse = z.infer<typeof listTagsResponseSchema>;
export type ReplaceRecipeTagsRequest = z.infer<typeof replaceRecipeTagsRequestSchema>;
export type ReplaceRecipeTagsResponse = z.infer<typeof replaceRecipeTagsResponseSchema>;
export type ReorderTagsRequest = z.infer<typeof reorderTagsRequestSchema>;
export type ReorderTagsResponse = z.infer<typeof reorderTagsResponseSchema>;
export type RenameTagRequest = z.infer<typeof renameTagRequestSchema>;
export type RenameTagResponse = z.infer<typeof renameTagResponseSchema>;
export type TagNameConflictDetails = z.infer<typeof tagNameConflictDetailsSchema>;
export type MergeTagRequest = z.infer<typeof mergeTagRequestSchema>;
export type MergeTagResponse = z.infer<typeof mergeTagResponseSchema>;
export type DeleteTagResponse = z.infer<typeof deleteTagResponseSchema>;
