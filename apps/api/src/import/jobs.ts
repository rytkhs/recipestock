import { type DbClient, importJobs, recipes } from "@recipestock/db";
import {
  type ImportErrorCode,
  type ImportJobKind,
  type ImportJobStatus,
  type ImportJobSummary,
  type RecentImportJob,
} from "@recipestock/schemas";
import { PLAN_LIMITS, type Plan } from "@recipestock/shared";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { type AppUserPlanSyncOptions, syncAppUserPlanForDb } from "../billing";
import { type Bindings } from "../env";
import { createRecipeThumbnailUrl } from "../recipe-thumbnails";
import { isUnlockedOnFree, type NewRecipeRecord, recipeCoverImageObjectKey } from "../recipes";

export type ImportJobRecord = {
  id: string;
  userId: string;
  kind: ImportJobKind;
  status: ImportJobStatus;
  url: string | null;
  normalizedUrl: string | null;
  sourceText: string | null;
  recipeId: string | null;
  errorCode: ImportErrorCode | null;
  errorMessage: string | null;
  dismissedAt: Date | null;
  completionNotificationRequested: boolean;
  completionNotificationSentAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
};

/**
 * 成功したJobが作ったRecipeのうち、取り込み状況に添えて見せる部分。
 * `coverImageObjectKey`はロックされうるRecipeではnullにしてある。
 */
export type ImportedRecipePreviewRecord = {
  title: string;
  coverImageObjectKey: string | null;
};

export type RecentImportJobRecord = ImportJobRecord & {
  recipe: ImportedRecipePreviewRecord | null;
};

export type CreateImportJobResult =
  | {
      status: "created";
      job: ImportJobRecord;
    }
  | {
      status: "existingActiveJob";
      job: ImportJobRecord;
    }
  | {
      status: "recipeLimitExceeded";
    }
  | {
      status: "aiUsageLimitExceeded";
      plan: Plan;
    };

/**
 * AI月次上限の投稿時判定に必要な値。上限はenv由来であり、repositoryはenvを知らないため
 * 呼び出し側が解決して渡す。ここで見るのは当月の利用回数だけで、原子的な消費は
 * キュー処理中の`consumeAiUsage`に残る。
 */
export type ImportJobAiUsageLimits = {
  month: string;
  freeLimit: number;
  proLimit: number;
};

export type CompleteImportJobResult =
  | { status: "succeeded" }
  | { status: "limitExceeded" }
  | { status: "timedOut" }
  | { status: "inactive" };

export type ImportJobRepository = {
  createUrlJob(params: {
    id: string;
    userId: string;
    url: string;
    normalizedUrl: string;
    completionNotificationRequested: boolean;
    shortcutCredentialId: string | null;
    aiUsage: ImportJobAiUsageLimits;
    now: Date;
  }): Promise<CreateImportJobResult>;
  createTextJob(params: {
    id: string;
    userId: string;
    sourceText: string;
    sourceTextDigest: string;
    sourceUrl: string | null;
    aiUsage: ImportJobAiUsageLimits;
    now: Date;
  }): Promise<CreateImportJobResult>;
  listRecentJobs(userId: string): Promise<RecentImportJobRecord[]>;
  getJob(userId: string, jobId: string): Promise<ImportJobRecord | null>;
  getJobById(jobId: string): Promise<ImportJobRecord | null>;
  expireActiveJobsForUser(params: {
    userId: string;
    expiresBefore: Date;
    now: Date;
  }): Promise<number>;
  expireJob(params: { jobId: string; expiresBefore: Date; now: Date }): Promise<boolean>;
  claimQueuedJob(params: {
    jobId: string;
    recipeId: string;
    expiresBefore: Date;
    now: Date;
  }): Promise<ImportJobRecord | null>;
  completeJobWithRecipe(params: {
    jobId: string;
    recipe: NewRecipeRecord;
    expiresBefore: Date;
    now: Date;
  }): Promise<CompleteImportJobResult>;
  markJobSucceeded(params: { jobId: string; recipeId: string; now: Date }): Promise<void>;
  markJobFailed(params: {
    jobId: string;
    errorCode: ImportErrorCode;
    errorMessage: string;
    now: Date;
  }): Promise<void>;
  markCompletionNotificationSent(params: { jobId: string; now: Date }): Promise<boolean>;
  dismissJob(params: { userId: string; jobId: string; now: Date }): Promise<ImportJobRecord | null>;
  /**
   * activeなJobを取り消して閉じる。終わっていたJobは変えずにそのまま返す。
   */
  cancelJob(params: { userId: string; jobId: string; now: Date }): Promise<ImportJobRecord | null>;
};

type ImportJobSqlRow = {
  id: string;
  userId: string;
  kind: string;
  status: string;
  url: string | null;
  normalizedUrl: string | null;
  sourceText: string | null;
  recipeId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  dismissedAt: Date | string | null;
  completionNotificationRequested: boolean;
  completionNotificationSentAt: Date | string | null;
  createdAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  updatedAt: Date | string;
};

const activeStatuses: ImportJobStatus[] = ["queued", "running"];
const DEFAULT_IMPORT_JOB_TIMEOUT_MS = 600_000;
const IMPORT_JOB_TEXT_PREVIEW_MAX_LENGTH = 80;

export const createImportJobId = () => ulid();

export const resolveImportJobTimeoutMs = (env?: Partial<Bindings>) => {
  const value = Number(env?.IMPORT_JOB_TIMEOUT_MS ?? DEFAULT_IMPORT_JOB_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_IMPORT_JOB_TIMEOUT_MS;
};

export const getImportJobExpiresBefore = (now: Date, timeoutMs: number) =>
  new Date(now.getTime() - timeoutMs);

/**
 * 取り込み状況はpollingで繰り返し取得するので、原文全体は載せずに最初の行だけを渡す。
 */
const toTextPreview = (sourceText: string | null) => {
  const firstLine = sourceText
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine
    ? Array.from(firstLine).slice(0, IMPORT_JOB_TEXT_PREVIEW_MAX_LENGTH).join("")
    : null;
};

export const toImportJobSummary = (job: ImportJobRecord): ImportJobSummary => ({
  id: job.id,
  kind: job.kind,
  status: job.status,
  url: job.url,
  textPreview: toTextPreview(job.sourceText),
  recipeId: job.status === "succeeded" ? job.recipeId : null,
  errorCode: job.errorCode,
  createdAt: job.createdAt.toISOString(),
  startedAt: job.startedAt?.toISOString() ?? null,
  finishedAt: job.finishedAt?.toISOString() ?? null,
});

export const toRecentImportJob = (job: RecentImportJobRecord): RecentImportJob => ({
  ...toImportJobSummary(job),
  recipe: job.recipe
    ? {
        title: job.recipe.title,
        coverImageUrl: job.recipe.coverImageObjectKey
          ? createRecipeThumbnailUrl({ objectKey: job.recipe.coverImageObjectKey })
          : null,
      }
    : null,
});

const mapImportJobRow = (row: typeof importJobs.$inferSelect): ImportJobRecord => ({
  id: row.id,
  userId: row.userId,
  kind: row.kind,
  status: row.status,
  url: row.url,
  normalizedUrl: row.normalizedUrl,
  sourceText: row.sourceText,
  recipeId: row.recipeId,
  errorCode: row.errorCode as ImportErrorCode | null,
  errorMessage: row.errorMessage,
  dismissedAt: row.dismissedAt,
  completionNotificationRequested: row.completionNotificationRequested,
  completionNotificationSentAt: row.completionNotificationSentAt,
  createdAt: row.createdAt,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  updatedAt: row.updatedAt,
});

const dateFromSql = (value: Date | string | null) =>
  value === null ? null : value instanceof Date ? value : new Date(value);

const mapImportJobSqlRow = (row: ImportJobSqlRow): ImportJobRecord => ({
  id: row.id,
  userId: row.userId,
  kind: row.kind as ImportJobKind,
  status: row.status as ImportJobStatus,
  url: row.url,
  normalizedUrl: row.normalizedUrl,
  sourceText: row.sourceText,
  recipeId: row.recipeId,
  errorCode: row.errorCode as ImportErrorCode | null,
  errorMessage: row.errorMessage,
  dismissedAt: dateFromSql(row.dismissedAt),
  completionNotificationRequested: row.completionNotificationRequested,
  completionNotificationSentAt: dateFromSql(row.completionNotificationSentAt),
  createdAt: dateFromSql(row.createdAt) ?? new Date(),
  startedAt: dateFromSql(row.startedAt),
  finishedAt: dateFromSql(row.finishedAt),
  updatedAt: dateFromSql(row.updatedAt) ?? new Date(),
});

type NewImportJobInput =
  | { kind: "url"; url: string; normalizedUrl: string }
  | { kind: "text"; sourceText: string; sourceTextDigest: string; sourceUrl: string | null };

/**
 * 投稿時の判定をURLとテキストで共有する。active Jobの再利用、保存上限、AI上限の順に単一SQLで
 * 判定し(ADR 0001、ADR 0002)、入力の種類で変わるのは同じImport Jobとみなす列だけである。
 */
const createImportJobWithSubmissionLimits = async (
  db: DbClient,
  planSyncOptions: AppUserPlanSyncOptions,
  {
    id,
    userId,
    input,
    completionNotificationRequested,
    shortcutCredentialId,
    aiUsage,
    now,
  }: {
    id: string;
    userId: string;
    input: NewImportJobInput;
    completionNotificationRequested: boolean;
    shortcutCredentialId: string | null;
    aiUsage: ImportJobAiUsageLimits;
    now: Date;
  },
): Promise<CreateImportJobResult> => {
  await syncAppUserPlanForDb(db, userId, planSyncOptions, now);

  const nowIso = now.toISOString();
  const url = input.kind === "url" ? input.url : input.sourceUrl;
  const normalizedUrl = input.kind === "url" ? input.normalizedUrl : null;
  const sourceText = input.kind === "text" ? input.sourceText : null;
  const sourceTextDigest = input.kind === "text" ? input.sourceTextDigest : null;
  const sameActiveJob =
    input.kind === "url"
      ? sql`import_jobs.normalized_url = ${input.normalizedUrl}`
      : sql`import_jobs.source_text_digest = ${input.sourceTextDigest}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await db.execute<
      ImportJobSqlRow & {
        resultStatus: string;
        blockReason: string | null;
        plan: string | null;
      }
    >(sql`
      with ensured_user as (
        insert into app_users (user_id)
        values (${userId})
        on conflict (user_id) do nothing
        returning plan
      ),
      selected_user as (
        select ensured_user.plan, 0 as saved_recipe_count
        from ensured_user
        union all
        select app_users.plan, app_users.saved_recipe_count
        from app_users
        where app_users.user_id = ${userId}
        limit 1
      ),
      active_candidate as materialized (
        select import_jobs.*
        from import_jobs
        where import_jobs.user_id = ${userId}
          and ${sameActiveJob}
          and import_jobs.status in ('queued', 'running')
        order by import_jobs.created_at desc, import_jobs.id desc
        limit 1
      ),
      touched_active_job as (
        update import_jobs
        set
          completion_notification_requested =
            import_jobs.completion_notification_requested or ${completionNotificationRequested},
          updated_at = ${nowIso}::timestamptz
        where import_jobs.id = (select active_candidate.id from active_candidate)
          and import_jobs.status in ('queued', 'running')
        returning
          import_jobs.id,
          import_jobs.user_id,
          import_jobs.kind,
          import_jobs.status,
          import_jobs.url,
          import_jobs.normalized_url,
          import_jobs.source_text,
          import_jobs.recipe_id,
          import_jobs.error_code,
          import_jobs.error_message,
          import_jobs.dismissed_at,
          import_jobs.completion_notification_requested,
          import_jobs.completion_notification_sent_at,
          import_jobs.created_at,
          import_jobs.started_at,
          import_jobs.finished_at,
          import_jobs.updated_at
      ),
      submission_limits as materialized (
        select
          selected_user.plan,
          case
            when selected_user.plan = 'pro' then false
            else selected_user.saved_recipe_count >= ${PLAN_LIMITS.free.savedRecipes}
          end as recipe_exceeded,
          coalesce(ai_usage.count, 0) >= case
            when selected_user.plan = 'pro' then ${aiUsage.proLimit}::int
            else ${aiUsage.freeLimit}::int
          end as ai_exceeded
        from selected_user
        left join ai_usage_monthly as ai_usage
          on ai_usage.user_id = ${userId}
          and ai_usage.month = ${aiUsage.month}
        where not exists (select 1 from touched_active_job)
      ),
      inserted_job as (
        insert into import_jobs (
          id,
          user_id,
          kind,
          status,
          url,
          normalized_url,
          source_text,
          source_text_digest,
          completion_notification_requested,
          shortcut_credential_id,
          created_at,
          updated_at
        )
        select
          ${id},
          ${userId},
          ${input.kind},
          'queued',
          ${url},
          ${normalizedUrl},
          ${sourceText},
          ${sourceTextDigest},
          ${completionNotificationRequested},
          ${shortcutCredentialId},
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz
        from submission_limits
        where submission_limits.recipe_exceeded = false
          and submission_limits.ai_exceeded = false
          and not exists (select 1 from active_candidate)
          and not exists (select 1 from touched_active_job)
        on conflict do nothing
        returning
          import_jobs.id,
          import_jobs.user_id,
          import_jobs.kind,
          import_jobs.status,
          import_jobs.url,
          import_jobs.normalized_url,
          import_jobs.source_text,
          import_jobs.recipe_id,
          import_jobs.error_code,
          import_jobs.error_message,
          import_jobs.dismissed_at,
          import_jobs.completion_notification_requested,
          import_jobs.completion_notification_sent_at,
          import_jobs.created_at,
          import_jobs.started_at,
          import_jobs.finished_at,
          import_jobs.updated_at
      ),
      result_candidates as (
        select
          touched_active_job.id,
          touched_active_job.user_id,
          touched_active_job.kind,
          touched_active_job.status,
          touched_active_job.url,
          touched_active_job.normalized_url,
          touched_active_job.source_text,
          touched_active_job.recipe_id,
          touched_active_job.error_code,
          touched_active_job.error_message,
          touched_active_job.dismissed_at,
          touched_active_job.completion_notification_requested,
          touched_active_job.completion_notification_sent_at,
          touched_active_job.created_at,
          touched_active_job.started_at,
          touched_active_job.finished_at,
          touched_active_job.updated_at,
          'existingActiveJob'::text as result_status,
          null::text as block_reason,
          null::text as plan
        from touched_active_job
        union all
        select
          inserted_job.id,
          inserted_job.user_id,
          inserted_job.kind,
          inserted_job.status,
          inserted_job.url,
          inserted_job.normalized_url,
          inserted_job.source_text,
          inserted_job.recipe_id,
          inserted_job.error_code,
          inserted_job.error_message,
          inserted_job.dismissed_at,
          inserted_job.completion_notification_requested,
          inserted_job.completion_notification_sent_at,
          inserted_job.created_at,
          inserted_job.started_at,
          inserted_job.finished_at,
          inserted_job.updated_at,
          'created'::text as result_status,
          null::text as block_reason,
          null::text as plan
        from inserted_job
        union all
        select
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          'limitExceeded'::text,
          case
            when submission_limits.recipe_exceeded then 'recipe'
            else 'ai_usage'
          end,
          submission_limits.plan
        from submission_limits
        where (submission_limits.recipe_exceeded or submission_limits.ai_exceeded)
          and not exists (select 1 from touched_active_job)
          and not exists (select 1 from inserted_job)
        union all
        select
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          'retry'::text,
          null::text,
          null::text
        from submission_limits
        where submission_limits.recipe_exceeded = false
          and submission_limits.ai_exceeded = false
          and not exists (select 1 from touched_active_job)
          and not exists (select 1 from inserted_job)
      )
      select
        id,
        user_id as "userId",
        kind,
        status,
        url,
        normalized_url as "normalizedUrl",
        source_text as "sourceText",
        recipe_id as "recipeId",
        error_code as "errorCode",
        error_message as "errorMessage",
        dismissed_at as "dismissedAt",
        completion_notification_requested as "completionNotificationRequested",
        completion_notification_sent_at as "completionNotificationSentAt",
        created_at as "createdAt",
        started_at as "startedAt",
        finished_at as "finishedAt",
        updated_at as "updatedAt",
        result_status as "resultStatus",
        block_reason as "blockReason",
        plan
      from result_candidates
      limit 1
    `);

    const row = result.rows[0];
    if (!row || row.resultStatus === "retry") {
      continue;
    }

    if (row.resultStatus === "limitExceeded") {
      return row.blockReason === "ai_usage"
        ? { status: "aiUsageLimitExceeded", plan: row.plan as Plan }
        : { status: "recipeLimitExceeded" };
    }

    const job = mapImportJobSqlRow(row);
    return {
      status: row.resultStatus === "created" ? "created" : "existingActiveJob",
      job,
    };
  }

  throw new Error("Could not resolve concurrent import job submission.");
};

const getUserImportJob = async (db: DbClient, userId: string, jobId: string) => {
  const [row] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), eq(importJobs.id, jobId)))
    .limit(1);

  return row ? mapImportJobRow(row) : null;
};

export const createImportJobRepository = (
  db: DbClient,
  planSyncOptions: AppUserPlanSyncOptions,
): ImportJobRepository => ({
  async createUrlJob({
    id,
    userId,
    url,
    normalizedUrl,
    completionNotificationRequested,
    shortcutCredentialId,
    aiUsage,
    now,
  }) {
    return createImportJobWithSubmissionLimits(db, planSyncOptions, {
      id,
      userId,
      input: { kind: "url", url, normalizedUrl },
      completionNotificationRequested,
      shortcutCredentialId,
      aiUsage,
      now,
    });
  },
  // テキストはアプリの画面からしか送れないので、連携キーを持たない。
  async createTextJob({ id, userId, sourceText, sourceTextDigest, sourceUrl, aiUsage, now }) {
    return createImportJobWithSubmissionLimits(db, planSyncOptions, {
      id,
      userId,
      input: { kind: "text", sourceText, sourceTextDigest, sourceUrl },
      completionNotificationRequested: false,
      shortcutCredentialId: null,
      aiUsage,
      now,
    });
  },
  async listRecentJobs(userId) {
    const rows = await db
      .select({
        job: importJobs,
        recipeTitle: recipes.title,
        coverImageObjectKey: recipeCoverImageObjectKey,
        // planを引かずに済むよう、どのplanでもロックされない新しい範囲のRecipeにだけ表紙を添える。
        coverUnlocked: isUnlockedOnFree(db, userId),
      })
      .from(importJobs)
      .leftJoin(
        recipes,
        and(
          eq(importJobs.status, "succeeded"),
          eq(recipes.userId, importJobs.userId),
          eq(recipes.id, importJobs.recipeId),
        ),
      )
      .where(
        and(
          eq(importJobs.userId, userId),
          or(inArray(importJobs.status, activeStatuses), isNull(importJobs.dismissedAt)),
        ),
      )
      .orderBy(
        sql`case ${importJobs.status}
          when 'running' then 0
          when 'queued' then 1
          when 'failed' then 2
          when 'succeeded' then 3
          else 4
        end`,
        desc(importJobs.updatedAt),
        desc(importJobs.id),
      );

    return rows.map(({ job, recipeTitle, coverImageObjectKey, coverUnlocked }) => ({
      ...mapImportJobRow(job),
      recipe:
        recipeTitle === null
          ? null
          : {
              title: recipeTitle,
              coverImageObjectKey: coverUnlocked ? coverImageObjectKey : null,
            },
    }));
  },
  async getJob(userId, jobId) {
    return getUserImportJob(db, userId, jobId);
  },
  async getJobById(jobId) {
    const [row] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
    return row ? mapImportJobRow(row) : null;
  },
  async expireActiveJobsForUser({ userId, expiresBefore, now }) {
    const rows = await db
      .update(importJobs)
      .set({
        status: "failed",
        errorCode: "job_timeout",
        errorMessage: "Import job timed out.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(importJobs.userId, userId),
          inArray(importJobs.status, activeStatuses),
          sql`${importJobs.createdAt} <= ${expiresBefore}`,
        ),
      )
      .returning({ id: importJobs.id });

    return rows.length;
  },
  async expireJob({ jobId, expiresBefore, now }) {
    const [row] = await db
      .update(importJobs)
      .set({
        status: "failed",
        errorCode: "job_timeout",
        errorMessage: "Import job timed out.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(importJobs.id, jobId),
          inArray(importJobs.status, activeStatuses),
          sql`${importJobs.createdAt} <= ${expiresBefore}`,
        ),
      )
      .returning({ id: importJobs.id });

    return Boolean(row);
  },
  async claimQueuedJob({ jobId, recipeId, expiresBefore, now }) {
    const [row] = await db
      .update(importJobs)
      .set({
        status: "running",
        recipeId,
        startedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(importJobs.id, jobId),
          eq(importJobs.status, "queued"),
          sql`${importJobs.createdAt} > ${expiresBefore}`,
        ),
      )
      .returning();

    return row ? mapImportJobRow(row) : null;
  },
  async completeJobWithRecipe({ jobId, recipe, expiresBefore, now }) {
    await syncAppUserPlanForDb(db, recipe.userId, planSyncOptions, now);

    const result = await db.execute<{ resultStatus: string }>(sql`
      with locked_job as materialized (
        select id, status, created_at
        from import_jobs
        where id = ${jobId}
          and user_id = ${recipe.userId}
        for update
      ),
      eligible_job as (
        select locked_job.id
        from locked_job
        where locked_job.status = 'running'
          and locked_job.created_at > ${expiresBefore.toISOString()}::timestamptz
      ),
      reserved_user as (
        update app_users
        set saved_recipe_count = saved_recipe_count + 1
        where user_id = ${recipe.userId}
          and exists (select 1 from eligible_job)
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
        from eligible_job
        cross join reserved_user
        returning id
      ),
      succeeded_job as (
        update import_jobs
        set
          status = 'succeeded',
          recipe_id = ${recipe.id},
          error_code = null,
          error_message = null,
          finished_at = ${now.toISOString()}::timestamptz,
          updated_at = ${now.toISOString()}::timestamptz
        where id in (select id from eligible_job)
          and exists (select 1 from inserted_recipe)
        returning id
      ),
      limit_failed_job as (
        update import_jobs
        set
          status = 'failed',
          error_code = 'recipe_limit_exceeded',
          error_message = 'Recipe limit exceeded.',
          finished_at = ${now.toISOString()}::timestamptz,
          updated_at = ${now.toISOString()}::timestamptz
        where id in (select id from eligible_job)
          and not exists (select 1 from reserved_user)
        returning id
      ),
      timed_out_job as (
        update import_jobs
        set
          status = 'failed',
          error_code = 'job_timeout',
          error_message = 'Import job timed out.',
          finished_at = ${now.toISOString()}::timestamptz,
          updated_at = ${now.toISOString()}::timestamptz
        where id in (
          select id
          from locked_job
          where status in ('queued', 'running')
            and created_at <= ${expiresBefore.toISOString()}::timestamptz
        )
        returning id
      )
      select 'succeeded'::text as "resultStatus"
      where exists (select 1 from succeeded_job)
      union all
      select 'limitExceeded'::text as "resultStatus"
      where exists (select 1 from limit_failed_job)
      union all
      select 'timedOut'::text as "resultStatus"
      where exists (select 1 from timed_out_job)
      union all
      select 'inactive'::text as "resultStatus"
      where not exists (select 1 from succeeded_job)
        and not exists (select 1 from limit_failed_job)
        and not exists (select 1 from timed_out_job)
      limit 1
    `);

    const resultStatus = result.rows[0]?.resultStatus;
    if (
      resultStatus === "succeeded" ||
      resultStatus === "limitExceeded" ||
      resultStatus === "timedOut"
    ) {
      return { status: resultStatus };
    }

    return { status: "inactive" };
  },
  async markJobSucceeded({ jobId, recipeId, now }) {
    await db
      .update(importJobs)
      .set({
        status: "succeeded",
        recipeId,
        errorCode: null,
        errorMessage: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "running")));
  },
  async markJobFailed({ jobId, errorCode, errorMessage, now }) {
    await db
      .update(importJobs)
      .set({
        status: "failed",
        errorCode,
        errorMessage,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(importJobs.id, jobId), inArray(importJobs.status, activeStatuses)));
  },
  async markCompletionNotificationSent({ jobId, now }) {
    const [row] = await db
      .update(importJobs)
      .set({ completionNotificationSentAt: now, updatedAt: now })
      .where(
        and(
          eq(importJobs.id, jobId),
          inArray(importJobs.status, ["succeeded", "failed"]),
          eq(importJobs.completionNotificationRequested, true),
          isNull(importJobs.completionNotificationSentAt),
        ),
      )
      .returning({ id: importJobs.id });
    return Boolean(row);
  },
  async dismissJob({ userId, jobId, now }) {
    const [row] = await db
      .update(importJobs)
      .set({
        dismissedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(importJobs.userId, userId),
          eq(importJobs.id, jobId),
          inArray(importJobs.status, ["succeeded", "failed"]),
        ),
      )
      .returning();

    return row ? mapImportJobRow(row) : null;
  },
  async cancelJob({ userId, jobId, now }) {
    // 取り消したJobは、どの完了処理もactiveを条件にしているのでRecipeを作らない。
    // 始まっていた外部の処理は止まらず、使ったAI利用回数も戻さない。
    const [canceled] = await db
      .update(importJobs)
      .set({
        status: "canceled",
        finishedAt: now,
        dismissedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(importJobs.userId, userId),
          eq(importJobs.id, jobId),
          inArray(importJobs.status, activeStatuses),
        ),
      )
      .returning();

    if (canceled) {
      return mapImportJobRow(canceled);
    }

    return getUserImportJob(db, userId, jobId);
  },
});
