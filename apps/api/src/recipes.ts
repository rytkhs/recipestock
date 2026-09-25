import { type DbClient, recipes, recipeTags, tags } from "@recipestock/db";
import {
  type LockedRecipeDetail,
  MAX_RECIPE_SEARCH_TERMS,
  MAX_RECIPE_SOURCE_NAME_LENGTH,
  type RecipeContent,
  type RecipeDetail,
  type RecipeListItem,
  type RecipeListSort,
  type RecipeSourceDraft,
  type RecipeTag,
  recipeContentSchema,
  recipeContentWithUrlsSchema,
} from "@recipestock/schemas";
import {
  buildSearchText,
  normalizeUrl,
  PLAN_LIMITS,
  type Plan,
  truncateText,
} from "@recipestock/shared";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { ulid } from "ulid";
import {
  type AppUserPlanSyncOptions,
  deriveAppUserPlanForDb,
  syncAppUserPlanForDb,
} from "./billing";
import { listRecipeTags } from "./tags";

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

export type RecipeListRecord = Pick<RecipeRecord, "id" | "title" | "sourceName" | "createdAt"> & {
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
  // 指定したタグがすべて付いたRecipeに絞る。
  tagIds: string[];
  // タグが1つも付いていないRecipeに絞る。
  untagged: boolean;
  sort: RecipeListSort;
  limit: number;
  cursor: string | null;
};

export type ListRecipesResult = {
  items: RecipeListRecord[];
  nextCursor: string | null;
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

export type RecipeWithTagsRecord = RecipeRecord & {
  tags: RecipeTag[];
};

export type RecipeRepository = {
  createRecipeEnforcingPlanLimit(recipe: NewRecipeRecord): Promise<CreateRecipeResult>;
  getRecipe(userId: string, recipeId: string): Promise<RecipeWithTagsRecord | null>;
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
    // 取り込みの出典名はページ由来で長さを選べないので、保存要求のschemaではなくここで収める。
    sourceName: source.sourceName
      ? truncateText(source.sourceName, MAX_RECIPE_SOURCE_NAME_LENGTH)
      : null,
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
  locked: recipe.locked ?? false,
});

export const toRecipeDetail = (recipe: RecipeRecord, tags: readonly RecipeTag[]): RecipeDetail => ({
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
  tags: [...tags],
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
  sort: RecipeListSort;
  createdAt: string;
  id: string;
};

export class InvalidRecipeListCursorError extends Error {
  constructor() {
    super("Invalid recipe list cursor.");
    this.name = "InvalidRecipeListCursorError";
  }
}

const encodeRecipeListCursor = (cursor: RecipeListCursor) => btoa(JSON.stringify(cursor));

// cursorは並び順ごとに発行する。向きの違うcursorで続きを引くと抜けや重複が出るので、入力エラーにする。
const decodeRecipeListCursor = (cursor: string, sort: RecipeListSort): RecipeListCursor => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(atob(cursor));
  } catch {
    throw new InvalidRecipeListCursorError();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidRecipeListCursorError();
  }

  const { sort: cursorSort, createdAt, id } = parsed as Record<string, unknown>;

  if (
    cursorSort !== sort ||
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    id.length === 0
  ) {
    throw new InvalidRecipeListCursorError();
  }

  if (Number.isNaN(new Date(createdAt).getTime())) {
    throw new InvalidRecipeListCursorError();
  }

  return { sort, createdAt, id };
};

/**
 * 検索語はそれぞれWHEREの条件になるので、語数を抑えて条件の数を抑える。
 */
export const normalizeRecipeSearchTerms = (query?: string) =>
  (
    query
      ?.toLowerCase()
      .normalize("NFKC")
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean) ?? []
  ).slice(0, MAX_RECIPE_SEARCH_TERMS);

/**
 * ILIKEのパターンとして扱われる文字を、入力された文字そのものとして照合する。
 * エスケープしないと`%`だけの検索語が全件に当たる。
 */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;

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
      with reserved_user as (
        update app_users
        set saved_recipe_count = saved_recipe_count + 1
        where user_id = ${recipe.userId}
          and (
            plan = 'pro'
            or saved_recipe_count < ${PLAN_LIMITS.free.savedRecipes}
          )
        returning user_id
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
        from reserved_user
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
    // 行とタグの取得、planの導出、unlocked判定は互いに独立なので同じ波で引く。
    // unlocked判定はfreeでしか使わないが、planを待ってから引くと1往復増えるのでplanによらず引く。
    const [rows, plan, attachedTags, unlockedRecipeIds] = await Promise.all([
      db
        .select()
        .from(recipes)
        .where(and(eq(recipes.userId, userId), eq(recipes.id, recipeId)))
        .limit(1),
      deriveAppUserPlanForDb(db, userId, planSyncOptions),
      listRecipeTags(db, userId, recipeId),
      getUnlockedRecipeIdSet(db, userId),
    ]);
    const [row] = rows;

    if (!row) {
      return null;
    }

    const recipe = mapRecipeRow(row);

    return {
      ...recipe,
      tags: attachedTags,
      locked: isRecipeLockedForPlan({ plan, recipeId: recipe.id, unlockedRecipeIds }),
    };
  },
  async listRecipes({ userId, searchTerms, tagIds, untagged, sort, limit, cursor }) {
    const decodedCursor = cursor ? decodeRecipeListCursor(cursor, sort) : null;
    // 追加日で並べ、同時刻はidで同じ向きに並べてcursorの位置を一意にする。
    const order = sort === "newest" ? desc : asc;
    const isPastCursor = sort === "newest" ? lt : gt;
    // 検索語は語ごとに、searchTextかタグ名のどちらかに当たればよい。タグ名はsearchTextへ書き込まず、
    // 名前を変えても全Recipeを書き換えずに済むように、読み取りのたびに照合する。
    const whereConditions = [
      eq(recipes.userId, userId),
      ...searchTerms.map(
        (term) =>
          or(
            ilike(recipes.searchText, likePattern(term)),
            exists(
              db
                .select({ tagId: recipeTags.tagId })
                .from(recipeTags)
                .innerJoin(tags, eq(tags.id, recipeTags.tagId))
                .where(
                  and(
                    eq(recipeTags.recipeId, recipes.id),
                    ilike(tags.normalizedName, likePattern(term)),
                  ),
                ),
            ),
          ) ?? sql`false`,
      ),
    ];

    if (tagIds.length > 0) {
      // 指定したタグがすべて付いたRecipeだけを残す。tagIdsは重複を除いてあるので個数で判定できる。
      whereConditions.push(
        inArray(
          recipes.id,
          db
            .select({ recipeId: recipeTags.recipeId })
            .from(recipeTags)
            .where(inArray(recipeTags.tagId, tagIds))
            .groupBy(recipeTags.recipeId)
            .having(sql`count(*) = ${tagIds.length}`),
        ),
      );
    }

    if (untagged) {
      whereConditions.push(
        notExists(
          db
            .select({ tagId: recipeTags.tagId })
            .from(recipeTags)
            .where(eq(recipeTags.recipeId, recipes.id)),
        ),
      );
    }

    if (decodedCursor) {
      const cursorCreatedAt = new Date(decodedCursor.createdAt);

      whereConditions.push(
        or(
          isPastCursor(recipes.createdAt, cursorCreatedAt),
          and(eq(recipes.createdAt, cursorCreatedAt), isPastCursor(recipes.id, decodedCursor.id)),
        ) ?? sql`false`,
      );
    }

    // 一覧本体とunlocked判定はplanに依存しないので同じ波で引く。
    // unlocked判定はfreeでしか使わないが、planを待ってから引くと1往復増えるのでplanによらず引く。
    const [plan, rows, unlockedRecipeIds] = await Promise.all([
      deriveAppUserPlanForDb(db, userId, planSyncOptions),
      db
        .select({
          id: recipes.id,
          title: recipes.title,
          sourceName: recipes.sourceName,
          createdAt: recipes.createdAt,
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
        .orderBy(order(recipes.createdAt), order(recipes.id))
        .limit(limit + 1),
      getUnlockedRecipeIdSet(db, userId),
    ]);
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
              sort,
              createdAt: lastRecipe.createdAt.toISOString(),
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
    const result = await db.execute<{ id: string }>(sql`
      with deleted_recipe as (
        delete from recipes
        where user_id = ${userId}
          and id = ${recipeId}
        returning id
      ),
      updated_user as (
        update app_users
        set saved_recipe_count = greatest(saved_recipe_count - 1, 0)
        where user_id = ${userId}
          and exists (select 1 from deleted_recipe)
        returning user_id
      )
      select id
      from deleted_recipe
    `);

    return result.rows.length > 0;
  },
});

// Freeで開けておくのは新しく保存した5件。一覧と同じ追加日の軸で選ぶので、
// 並び順や検索によらずロック中のRecipeは一続きになる。
const getUnlockedRecipeIdSet = async (db: DbClient, userId: string): Promise<Set<string>> => {
  const rows = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(eq(recipes.userId, userId))
    .orderBy(desc(recipes.createdAt), desc(recipes.id))
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
