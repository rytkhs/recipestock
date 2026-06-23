import { type DbClient, recipes } from "@recipestock/db";
import {
  type LockedRecipeDetail,
  type RecipeContent,
  type RecipeDetail,
  type RecipeListItem,
  type RecipeSourceDraft,
  recipeContentSchema,
  recipeContentWithUrlsSchema,
} from "@recipestock/schemas";
import { buildSearchText, normalizeUrl, PLAN_LIMITS, type Plan } from "@recipestock/shared";
import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { type AppUserPlanSyncOptions, syncAppUserPlanForDb } from "./billing";

export type RecipeRecord = {
  id: string;
  userId: string;
  title: string;
  content: RecipeContent;
  originType: "manual" | "url" | "image" | "text";
  sourceUrl: string | null;
  normalizedSourceUrl: string | null;
  sourceName: string | null;
  searchText: string;
  createdAt: Date;
  updatedAt: Date;
  locked?: boolean;
};

export type RecipeListRecord = Pick<
  RecipeRecord,
  "id" | "title" | "sourceName" | "createdAt" | "updatedAt"
> & {
  coverImageObjectKey?: string | null;
  locked?: boolean;
};

export type NewRecipeRecord = RecipeRecord;

export type UpdateRecipeRecord = {
  userId: string;
  recipeId: string;
  title: string;
  content: RecipeContent;
  searchText: string;
  updatedAt: Date;
};

export type CreateRecipeResult =
  | {
      status: "created";
      recipe: RecipeRecord;
    }
  | {
      status: "limitExceeded";
    };

export type ListRecipesParams = {
  userId: string;
  searchTerms: string[];
  limit: number;
  cursor: string | null;
};

export type ListRecipesResult = {
  items: RecipeListRecord[];
  nextCursor: string | null;
};

type LockedAppUser = {
  userId: string;
  plan: Plan;
};

type RecipeSqlRow = {
  id: string;
  userId: string;
  title: string;
  content: unknown;
  originType: "manual" | "url" | "image" | "text";
  sourceUrl: string | null;
  normalizedSourceUrl: string | null;
  sourceName: string | null;
  searchText: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type RecipeWriteSession = {
  ensureAppUser(userId: string): Promise<void>;
  lockAppUser(userId: string): Promise<LockedAppUser | null>;
  countRecipes(userId: string): Promise<number>;
  insertRecipe(recipe: NewRecipeRecord): Promise<RecipeRecord>;
};

export type RecipeRepository = {
  createRecipeEnforcingPlanLimit(recipe: NewRecipeRecord): Promise<CreateRecipeResult>;
  getRecipe(userId: string, recipeId: string): Promise<RecipeRecord | null>;
  listRecipes(params: ListRecipesParams): Promise<ListRecipesResult>;
  updateRecipe(recipe: UpdateRecipeRecord): Promise<RecipeRecord | null>;
  deleteRecipe(userId: string, recipeId: string): Promise<boolean>;
};

export type NormalizedRecipeSource = {
  sourceUrl: string | null;
  normalizedSourceUrl: string | null;
  sourceName: string | null;
};

export const createRecipeId = () => ulid();

export const normalizeRecipeSource = (source: RecipeSourceDraft): NormalizedRecipeSource => {
  const sourceUrl = source.sourceUrl ?? null;
  return {
    sourceUrl,
    normalizedSourceUrl: sourceUrl ? normalizeUrl(sourceUrl) : null,
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
    ingredientNames: content.ingredientGroups.flatMap((group) =>
      group.ingredients.map((ingredient) => ingredient.name),
    ),
    note: content.note,
  });

export const toRecipeListItem = (recipe: RecipeListRecord): RecipeListItem => ({
  id: recipe.id,
  title: recipe.title,
  coverImageUrl: null,
  sourceName: recipe.sourceName,
  createdAt: recipe.createdAt.toISOString(),
  updatedAt: recipe.updatedAt.toISOString(),
  locked: recipe.locked ?? false,
});

export const toRecipeDetail = (recipe: RecipeRecord): RecipeDetail => ({
  id: recipe.id,
  title: recipe.title,
  content: recipeContentWithUrlsSchema.parse(recipe.content),
  source: {
    sourceUrl: recipe.sourceUrl,
    normalizedSourceUrl: recipe.normalizedSourceUrl,
    sourceName: recipe.sourceName,
  },
  createdAt: recipe.createdAt.toISOString(),
  updatedAt: recipe.updatedAt.toISOString(),
  locked: false,
});

export const toLockedRecipeDetail = (recipe: Pick<RecipeRecord, "id">): LockedRecipeDetail => ({
  id: recipe.id,
  locked: true,
});

export const isRecipeLockedForPlan = ({
  plan,
  recipeId,
  unlockedRecipeIds,
}: {
  plan: Plan;
  recipeId: string;
  unlockedRecipeIds: ReadonlySet<string>;
}) => plan === "free" && !unlockedRecipeIds.has(recipeId);

type RecipeListCursor = {
  updatedAt: string;
  id: string;
};

export class InvalidRecipeListCursorError extends Error {
  constructor() {
    super("Invalid recipe list cursor.");
    this.name = "InvalidRecipeListCursorError";
  }
}

const encodeRecipeListCursor = (cursor: RecipeListCursor) => btoa(JSON.stringify(cursor));

const decodeRecipeListCursor = (cursor: string): RecipeListCursor => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    throw new InvalidRecipeListCursorError();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidRecipeListCursorError();
  }

  const { updatedAt, id } = parsed as Record<string, unknown>;

  if (typeof updatedAt !== "string" || typeof id !== "string" || id.length === 0) {
    throw new InvalidRecipeListCursorError();
  }

  if (Number.isNaN(new Date(updatedAt).getTime())) {
    throw new InvalidRecipeListCursorError();
  }

  return { updatedAt, id };
};

export const normalizeRecipeSearchTerms = (query?: string) =>
  query
    ?.toLowerCase()
    .normalize("NFKC")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean) ?? [];

export const createRecipeWithPlanLimitInSession = async (
  session: RecipeWriteSession,
  recipe: NewRecipeRecord,
): Promise<CreateRecipeResult> => {
  await session.ensureAppUser(recipe.userId);

  const appUser = await session.lockAppUser(recipe.userId);

  if (!appUser) {
    throw new Error(`App user was not created for ${recipe.userId}`);
  }

  if (appUser.plan === "free") {
    const recipeCount = await session.countRecipes(recipe.userId);

    if (recipeCount >= PLAN_LIMITS.free.savedRecipes) {
      return { status: "limitExceeded" };
    }
  }

  return {
    status: "created",
    recipe: await session.insertRecipe(recipe),
  };
};

export const createRecipeRepository = (
  db: DbClient,
  planSyncOptions: AppUserPlanSyncOptions = {},
): RecipeRepository => ({
  async createRecipeEnforcingPlanLimit(recipe) {
    await syncAppUserPlanForDb(db, recipe.userId, {
      ...planSyncOptions,
      now: planSyncOptions.now ?? recipe.createdAt,
    });

    const result = await db.execute<RecipeSqlRow>(sql`
      with ensured_user as (
        insert into app_users (user_id)
        values (${recipe.userId})
        on conflict (user_id) do nothing
        returning plan
      ),
      selected_user as (
        select ensured_user.plan
        from ensured_user
        union all
        select app_users.plan
        from app_users
        where app_users.user_id = ${recipe.userId}
        limit 1
      ),
      inserted_recipe as (
        insert into recipes (
          id,
          user_id,
          title,
          content,
          origin_type,
          source_url,
          normalized_source_url,
          source_name,
          search_text,
          created_at,
          updated_at
        )
        select
          ${recipe.id},
          ${recipe.userId},
          ${recipe.title},
          ${JSON.stringify(recipe.content)}::jsonb,
          ${recipe.originType},
          ${recipe.sourceUrl},
          ${recipe.normalizedSourceUrl},
          ${recipe.sourceName},
          ${recipe.searchText},
          ${recipe.createdAt.toISOString()}::timestamptz,
          ${recipe.updatedAt.toISOString()}::timestamptz
        from selected_user
        where selected_user.plan = 'pro'
          or (
            selected_user.plan = 'free'
            and (
              select count(*)
              from recipes
              where recipes.user_id = ${recipe.userId}
            ) < ${PLAN_LIMITS.free.savedRecipes}
          )
        returning
          id,
          user_id as "userId",
          title,
          content,
          origin_type as "originType",
          source_url as "sourceUrl",
          normalized_source_url as "normalizedSourceUrl",
          source_name as "sourceName",
          search_text as "searchText",
          created_at as "createdAt",
          updated_at as "updatedAt"
      )
      select *
      from inserted_recipe
    `);

    const row = result.rows[0];

    if (!row) {
      return { status: "limitExceeded" };
    }

    return {
      status: "created",
      recipe: mapRecipeSqlRow(row),
    };
  },
  async getRecipe(userId, recipeId) {
    const [row] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.userId, userId), eq(recipes.id, recipeId)))
      .limit(1);

    if (!row) {
      return null;
    }

    const plan = await syncAppUserPlanForDb(db, userId, planSyncOptions);
    const unlockedRecipeIds =
      plan === "free" ? await getUnlockedRecipeIdSet(db, userId) : new Set<string>();
    const recipe = mapRecipeRow(row);

    return {
      ...recipe,
      locked: isRecipeLockedForPlan({ plan, recipeId: recipe.id, unlockedRecipeIds }),
    };
  },
  async listRecipes({ userId, searchTerms, limit, cursor }) {
    const decodedCursor = cursor ? decodeRecipeListCursor(cursor) : null;
    const cursorUpdatedAt = decodedCursor ? new Date(decodedCursor.updatedAt) : null;
    const whereConditions = [
      eq(recipes.userId, userId),
      ...searchTerms.map((term) => ilike(recipes.searchText, `%${term}%`)),
    ];

    if (decodedCursor && cursorUpdatedAt) {
      whereConditions.push(
        or(
          lt(recipes.updatedAt, cursorUpdatedAt),
          and(eq(recipes.updatedAt, cursorUpdatedAt), lt(recipes.id, decodedCursor.id)),
        ) ?? sql`false`,
      );
    }

    const plan = await syncAppUserPlanForDb(db, userId, planSyncOptions);
    const unlockedRecipeIds =
      plan === "free" ? await getUnlockedRecipeIdSet(db, userId) : new Set<string>();
    const rows = await db
      .select({
        id: recipes.id,
        title: recipes.title,
        sourceName: recipes.sourceName,
        createdAt: recipes.createdAt,
        updatedAt: recipes.updatedAt,
        coverImageObjectKey: sql<string | null>`
          case
            when jsonb_typeof(${recipes.content}->'coverImage'->'objectKey') = 'string'
              then ${recipes.content}->'coverImage'->>'objectKey'
            else null
          end
        `,
      })
      .from(recipes)
      .where(and(...whereConditions))
      .orderBy(desc(recipes.updatedAt), desc(recipes.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const lastRecipe = pageRows.at(-1);

    return {
      items: pageRows.map((recipe) => ({
        ...recipe,
        locked: isRecipeLockedForPlan({ plan, recipeId: recipe.id, unlockedRecipeIds }),
      })),
      nextCursor:
        rows.length > limit && lastRecipe
          ? encodeRecipeListCursor({
              updatedAt: lastRecipe.updatedAt.toISOString(),
              id: lastRecipe.id,
            })
          : null,
    };
  },
  async updateRecipe({ userId, recipeId, title, content, searchText, updatedAt }) {
    const [row] = await db
      .update(recipes)
      .set({
        title,
        content,
        searchText,
        updatedAt,
      })
      .where(and(eq(recipes.userId, userId), eq(recipes.id, recipeId)))
      .returning();

    return row ? mapRecipeRow(row) : null;
  },
  async deleteRecipe(userId, recipeId) {
    const deletedRows = await db
      .delete(recipes)
      .where(and(eq(recipes.userId, userId), eq(recipes.id, recipeId)))
      .returning({ id: recipes.id });

    return deletedRows.length > 0;
  },
});

const getUnlockedRecipeIdSet = async (db: DbClient, userId: string): Promise<Set<string>> => {
  const rows = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(eq(recipes.userId, userId))
    .orderBy(desc(recipes.updatedAt), desc(recipes.id))
    .limit(PLAN_LIMITS.free.savedRecipes);

  return new Set(rows.map((row) => row.id));
};

const mapRecipeSqlRow = (row: RecipeSqlRow): RecipeRecord => ({
  id: row.id,
  userId: row.userId,
  title: row.title,
  content: recipeContentSchema.parse(row.content),
  originType: row.originType,
  sourceUrl: row.sourceUrl,
  normalizedSourceUrl: row.normalizedSourceUrl,
  sourceName: row.sourceName,
  searchText: row.searchText,
  createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
  updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
});

const mapRecipeRow = (row: typeof recipes.$inferSelect): RecipeRecord => ({
  id: row.id,
  userId: row.userId,
  title: row.title,
  content: recipeContentSchema.parse(row.content),
  originType: row.originType,
  sourceUrl: row.sourceUrl,
  normalizedSourceUrl: row.normalizedSourceUrl,
  sourceName: row.sourceName,
  searchText: row.searchText,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
