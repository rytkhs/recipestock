import { type DbClient, recipes } from "@recipestock/db";
import {
  type RecipeContent,
  type RecipeDetail,
  type RecipeDraftContent,
  type RecipeSourceDraft,
  recipeContentSchema,
  type SourcePlatform,
  type SourceType,
} from "@recipestock/schemas";
import { buildSearchText, normalizeUrl } from "@recipestock/shared";
import { and, eq } from "drizzle-orm";

export type RecipeRecord = {
  id: string;
  userId: string;
  title: string;
  content: RecipeContent;
  sourceType: SourceType;
  sourcePlatform: SourcePlatform | null;
  sourceUrl: string | null;
  normalizedSourceUrl: string | null;
  sourceName: string | null;
  searchText: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NewRecipeRecord = RecipeRecord;

export type RecipeRepository = {
  createRecipe(recipe: NewRecipeRecord): Promise<RecipeRecord>;
  getRecipe(userId: string, recipeId: string): Promise<RecipeRecord | null>;
};

export type NormalizedRecipeSource = {
  sourceType: SourceType;
  sourcePlatform: SourcePlatform | null;
  sourceUrl: string | null;
  normalizedSourceUrl: string | null;
  sourceName: string | null;
};

const crockfordBase32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const createRecipeId = (now = Date.now()) => {
  let time = now;
  let encodedTime = "";

  for (let i = 0; i < 10; i += 1) {
    encodedTime = crockfordBase32[time % 32] + encodedTime;
    time = Math.floor(time / 32);
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const encodedRandom = Array.from(bytes, (byte) => crockfordBase32[byte & 31]).join("");

  return `${encodedTime}${encodedRandom}`;
};

const objectKeyFromDraftImage = (image: RecipeDraftContent["coverImage"]) => {
  if (!image) {
    return undefined;
  }

  return image.type === "externalImageUrl" ? undefined : image.key;
};

export const toRecipeContent = (draft: RecipeDraftContent): RecipeContent => {
  return recipeContentSchema.parse({
    title: draft.title,
    servingsText: draft.servingsText,
    coverImageKey: objectKeyFromDraftImage(draft.coverImage),
    ingredientGroups: draft.ingredientGroups,
    steps: draft.steps.map((step) => ({
      text: step.text,
      imageKey: objectKeyFromDraftImage(step.image),
    })),
    note: draft.note,
  });
};

export const normalizeRecipeSource = (source: RecipeSourceDraft): NormalizedRecipeSource => {
  const sourceUrl = source.sourceUrl ?? null;
  return {
    sourceType: source.sourceType,
    sourcePlatform: source.sourcePlatform ?? null,
    sourceUrl,
    normalizedSourceUrl: source.normalizedSourceUrl ?? (sourceUrl ? normalizeUrl(sourceUrl) : null),
    sourceName: source.sourceName ?? null,
  };
};

export const buildRecipeSearchText = ({
  content,
  sourceName,
}: {
  content: RecipeContent;
  sourceName?: string | null;
}) =>
  buildSearchText({
    title: content.title,
    sourceName,
    ingredientTexts: content.ingredientGroups.flatMap((group) =>
      group.ingredients.map((ingredient) => `${ingredient.name} ${ingredient.amount}`),
    ),
    stepTexts: content.steps.map((step) => step.text),
    note: content.note,
  });

export const toRecipeDetail = (recipe: RecipeRecord): RecipeDetail => ({
  id: recipe.id,
  title: recipe.title,
  content: recipe.content,
  source: {
    sourceType: recipe.sourceType,
    sourcePlatform: recipe.sourcePlatform,
    sourceUrl: recipe.sourceUrl,
    normalizedSourceUrl: recipe.normalizedSourceUrl,
    sourceName: recipe.sourceName,
  },
  createdAt: recipe.createdAt.toISOString(),
  updatedAt: recipe.updatedAt.toISOString(),
  locked: false,
});

export const createRecipeRepository = (db: DbClient): RecipeRepository => ({
  async createRecipe(recipe) {
    const [row] = await db
      .insert(recipes)
      .values({
        id: recipe.id,
        userId: recipe.userId,
        title: recipe.title,
        content: recipe.content,
        sourceType: recipe.sourceType,
        sourcePlatform: recipe.sourcePlatform,
        sourceUrl: recipe.sourceUrl,
        normalizedSourceUrl: recipe.normalizedSourceUrl,
        sourceName: recipe.sourceName,
        searchText: recipe.searchText,
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create recipe.");
    }

    return mapRecipeRow(row);
  },
  async getRecipe(userId, recipeId) {
    const [row] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.userId, userId), eq(recipes.id, recipeId)))
      .limit(1);

    return row ? mapRecipeRow(row) : null;
  },
});

const mapRecipeRow = (row: typeof recipes.$inferSelect): RecipeRecord => ({
  id: row.id,
  userId: row.userId,
  title: row.title,
  content: recipeContentSchema.parse(row.content),
  sourceType: (row.sourceType ?? "other") as SourceType,
  sourcePlatform: row.sourcePlatform as SourcePlatform | null,
  sourceUrl: row.sourceUrl,
  normalizedSourceUrl: row.normalizedSourceUrl,
  sourceName: row.sourceName,
  searchText: row.searchText,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
