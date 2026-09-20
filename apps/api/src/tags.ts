import { type DbClient, recipeTags, tags } from "@recipestock/db";
import { MAX_TAG_NAME_LENGTH, type RecipeTag, type TagWithCount } from "@recipestock/schemas";
import { countTagNameLength, type NormalizedTagName, normalizeTagName } from "@recipestock/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";

export type ReplaceRecipeTagsParams = {
  userId: string;
  recipeId: string;
  names: readonly NormalizedTagName[];
  now: Date;
};

export type RenameTagParams = {
  userId: string;
  tagId: string;
  name: NormalizedTagName;
  now: Date;
};

export type RenameTagResult =
  | { status: "renamed"; tag: RecipeTag }
  | { status: "conflict"; tag: RecipeTag }
  | { status: "notFound" };

export type ReorderTagsParams = {
  userId: string;
  tagIds: readonly string[];
  now: Date;
};

export type MergeTagParams = {
  userId: string;
  tagId: string;
  intoTagId: string;
};

export type MergeTagResult = { status: "merged"; tag: RecipeTag } | { status: "notFound" };

export type TagRepository = {
  listTags(userId: string): Promise<TagWithCount[]>;
  replaceRecipeTags(params: ReplaceRecipeTagsParams): Promise<RecipeTag[] | null>;
  renameTag(params: RenameTagParams): Promise<RenameTagResult>;
  reorderTags(params: ReorderTagsParams): Promise<void>;
  mergeTag(params: MergeTagParams): Promise<MergeTagResult>;
  deleteTag(userId: string, tagId: string): Promise<boolean>;
};

export const createTagId = () => ulid();

export const normalizeRequestedTagName = (name: string) => {
  const normalized = normalizeTagName(name);

  return normalized && countTagNameLength(normalized.name) <= MAX_TAG_NAME_LENGTH
    ? normalized
    : null;
};

// 揃えた名前が同じものは最初の1つだけ残す。空や長すぎる名前が1つでもあればnullを返す。
export const normalizeRequestedTagNames = (
  names: readonly string[],
): NormalizedTagName[] | null => {
  const normalizedNames = new Map<string, NormalizedTagName>();

  for (const name of names) {
    const normalized = normalizeRequestedTagName(name);

    if (!normalized) {
      return null;
    }

    if (!normalizedNames.has(normalized.normalizedName)) {
      normalizedNames.set(normalized.normalizedName, normalized);
    }
  }

  return [...normalizedNames.values()];
};

// Recipeに付いたタグを付けた順に返す。
export const listRecipeTags = (
  db: DbClient,
  userId: string,
  recipeId: string,
): Promise<RecipeTag[]> =>
  db
    .select({ id: tags.id, name: tags.name })
    .from(recipeTags)
    .innerJoin(tags, eq(tags.id, recipeTags.tagId))
    .where(and(eq(recipeTags.recipeId, recipeId), eq(tags.userId, userId)))
    .orderBy(asc(recipeTags.createdAt), asc(recipeTags.tagId));

const textArray = (values: readonly string[]) =>
  sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;

export const createTagRepository = (db: DbClient): TagRepository => ({
  async listTags(userId) {
    const recipeCount = sql<number>`count(${recipeTags.recipeId})::int`;

    return db
      .select({ id: tags.id, name: tags.name, recipeCount })
      .from(tags)
      .leftJoin(recipeTags, eq(recipeTags.tagId, tags.id))
      .where(eq(tags.userId, userId))
      .groupBy(tags.id)
      .orderBy(asc(tags.position), asc(tags.createdAt), asc(tags.id));
  },
  async replaceRecipeTags({ userId, recipeId, names, now }) {
    const nowIso = now.toISOString();
    // 自分のRecipeでなければタグも作らない。既存のタグはon conflictで同じ行を返させ、組の置き換えに使う。
    // 新しく作るタグは語彙の末尾に置く。max(position)も文の開始時点を見るので、同じ要求で作る分はordだけずらす。
    // CTEは文の開始時点のスナップショットを見るので、並びは既存の付与日時と今回の時刻から組み立てる。
    // 別のタブや端末から同じRecipeへ同時に送られると、後から始まった文は先の文が足した付与を見られず外せないことがある。
    // 画面は同じRecipeの要求を順に送るので、ここでは直列化しない。
    const result = await db.execute<{ id: string | null; name: string | null }>(sql`
      with target as (
        select id
        from recipes
        where id = ${recipeId}
          and user_id = ${userId}
      ),
      input as (
        select input.id, input.name, input.normalized_name, input.ord
        from unnest(
          ${textArray(names.map(() => createTagId()))},
          ${textArray(names.map((name) => name.name))},
          ${textArray(names.map((name) => name.normalizedName))}
        ) with ordinality as input(id, name, normalized_name, ord)
        where exists (select 1 from target)
      ),
      selected as (
        insert into tags (id, user_id, name, normalized_name, position, created_at, updated_at)
        select id, ${userId}, name, normalized_name,
          ((select coalesce(max(existing.position), -1) from tags existing where existing.user_id = ${userId}) + input.ord)::int,
          ${nowIso}::timestamptz, ${nowIso}::timestamptz
        from input
        on conflict (user_id, normalized_name) do update
          set normalized_name = excluded.normalized_name
        returning id, name
      ),
      removed as (
        delete from recipe_tags
        where recipe_id in (select id from target)
          and tag_id not in (select id from selected)
      ),
      added as (
        insert into recipe_tags (recipe_id, tag_id, created_at)
        select target.id, selected.id, ${nowIso}::timestamptz
        from target, selected
        on conflict (recipe_id, tag_id) do nothing
      )
      select selected.id, selected.name
      from target
      left join selected on true
      left join recipe_tags attached
        on attached.recipe_id = target.id
        and attached.tag_id = selected.id
      order by coalesce(attached.created_at, ${nowIso}::timestamptz), selected.id
    `);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows.flatMap((row) =>
      row.id && row.name ? [{ id: row.id, name: row.name }] : [],
    );
  },
  async renameTag({ userId, tagId, name, now }) {
    // 変更先の名前を別のタグが使っていれば変更せず、そのタグを返して統合を確認させる。
    const result = await db.execute<{
      status: "renamed" | "conflict";
      id: string;
      name: string;
    }>(sql`
      with target as (
        select id
        from tags
        where id = ${tagId}
          and user_id = ${userId}
      ),
      conflicting as (
        select id, name
        from tags
        where user_id = ${userId}
          and normalized_name = ${name.normalizedName}
          and id <> ${tagId}
          and exists (select 1 from target)
      ),
      renamed as (
        update tags
        set name = ${name.name},
          normalized_name = ${name.normalizedName},
          updated_at = ${now.toISOString()}::timestamptz
        where id in (select id from target)
          and not exists (select 1 from conflicting)
        returning id, name
      )
      select 'renamed' as status, id, name from renamed
      union all
      select 'conflict' as status, id, name from conflicting
    `);
    const [row] = result.rows;

    if (!row) {
      return { status: "notFound" };
    }

    return { status: row.status, tag: { id: row.id, name: row.name } };
  },
  async reorderTags({ userId, tagIds, now }) {
    if (tagIds.length === 0) {
      return;
    }

    // 送られたタグを先頭から並べ、送られなかった自分のタグは今の相対順のまま後ろに回す。
    // 自分のものでないidと消えたidはjoinで落ちるので、別の端末で作った・消した直後でも収まる。
    await db.execute(sql`
      with requested as (
        select requested.tag_id, (requested.ord - 1)::int as position
        from unnest(${textArray(tagIds)}) with ordinality as requested(tag_id, ord)
      ),
      reordered as (
        select tag.id,
          coalesce(
            requested.position,
            ${tagIds.length}::int + (row_number() over (order by tag.position, tag.created_at, tag.id))::int
          ) as position
        from tags tag
        left join requested on requested.tag_id = tag.id
        where tag.user_id = ${userId}
      )
      update tags
      set position = reordered.position,
        updated_at = ${now.toISOString()}::timestamptz
      from reordered
      where tags.id = reordered.id
        and tags.user_id = ${userId}
        and tags.position <> reordered.position
    `);
  },
  async mergeTag({ userId, tagId, intoTagId }) {
    // 付与を統合先へ移し、元のタグを消す（元の付与はcascadeで消える）。
    // 付けた順を保つため、移す付与は元の日時のままにし、両方が付いていたRecipeは早い方の日時を残す。
    const result = await db.execute<{ id: string; name: string }>(sql`
      with source as (
        select id
        from tags
        where id = ${tagId}
          and user_id = ${userId}
      ),
      target as (
        select id, name
        from tags
        where id = ${intoTagId}
          and id <> ${tagId}
          and user_id = ${userId}
          and exists (select 1 from source)
      ),
      moved as (
        insert into recipe_tags (recipe_id, tag_id, created_at)
        select attached.recipe_id, target.id, attached.created_at
        from recipe_tags attached, source, target
        where attached.tag_id = source.id
        on conflict (recipe_id, tag_id) do update
          set created_at = least(recipe_tags.created_at, excluded.created_at)
      ),
      deleted as (
        delete from tags
        where id in (select id from source)
          and exists (select 1 from target)
      )
      select id, name
      from target
    `);
    const [row] = result.rows;

    return row ? { status: "merged", tag: { id: row.id, name: row.name } } : { status: "notFound" };
  },
  async deleteTag(userId, tagId) {
    const rows = await db
      .delete(tags)
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
      .returning({ id: tags.id });

    return rows.length > 0;
  },
});
