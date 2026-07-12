import { type DbClient, importJobs } from "@recipestock/db";
import {
  type ImportErrorCode,
  type ImportJobKind,
  type ImportJobStatus,
  type ImportJobSummary,
} from "@recipestock/schemas";
import { PLAN_LIMITS } from "@recipestock/shared";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { type AppUserPlanSyncOptions, syncAppUserPlanForDb } from "./billing";
import { type Bindings } from "./env";
import { type RecipeImageService } from "./images";
import {
  importRecipeFromUrl,
  type RecipeImportAIProvider,
  RecipeImportError,
  type RecipeImportFetcher,
} from "./import-url";
import { type YouTubeDataClient } from "./lib/import/source-extraction/youtube-data";
import { createLogger, type Logger } from "./logger";
import {
  deleteObjectsBestEffort,
  type FinalizedRecipeImages,
  finalizeRecipeDraftImages,
  RecipeImageFinalizeError,
} from "./recipe-images";
import {
  buildRecipeSearchText,
  createRecipeId as createDefaultRecipeId,
  type NewRecipeRecord,
  normalizeRecipeSource,
  type RecipeRepository,
} from "./recipes";
import { type UsageRepository } from "./usage";
import { createYtDlpMetadataClient, type YtDlpMetadataClient } from "./ytdlp-metadata";

export type ImportJobRecord = {
  id: string;
  userId: string;
  kind: ImportJobKind;
  status: ImportJobStatus;
  url: string | null;
  normalizedUrl: string | null;
  recipeId: string | null;
  errorCode: ImportErrorCode | null;
  errorMessage: string | null;
  dismissedAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
};

export type CreateImportUrlJobResult =
  | {
      status: "created";
      job: ImportJobRecord;
    }
  | {
      status: "existingActiveJob";
      job: ImportJobRecord;
    }
  | {
      status: "limitExceeded";
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
    now: Date;
  }): Promise<CreateImportUrlJobResult>;
  listRecentJobs(userId: string): Promise<ImportJobRecord[]>;
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
  dismissJob(params: { userId: string; jobId: string; now: Date }): Promise<ImportJobRecord | null>;
};

type ImportJobSqlRow = {
  id: string;
  userId: string;
  kind: string;
  status: string;
  url: string | null;
  normalizedUrl: string | null;
  recipeId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  dismissedAt: Date | string | null;
  createdAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  updatedAt: Date | string;
};

const activeStatuses: ImportJobStatus[] = ["queued", "running"];
const DEFAULT_IMPORT_JOB_TIMEOUT_MS = 600_000;

export const createImportJobId = () => ulid();

export const resolveImportJobTimeoutMs = (env?: Partial<Bindings>) => {
  const value = Number(env?.IMPORT_JOB_TIMEOUT_MS ?? DEFAULT_IMPORT_JOB_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_IMPORT_JOB_TIMEOUT_MS;
};

export const getImportJobExpiresBefore = (now: Date, timeoutMs: number) =>
  new Date(now.getTime() - timeoutMs);

const getImportJobDeadline = (job: ImportJobRecord, timeoutMs: number) =>
  new Date(job.createdAt.getTime() + timeoutMs);

export const toImportJobSummary = (job: ImportJobRecord): ImportJobSummary => ({
  id: job.id,
  kind: job.kind,
  status: job.status,
  url: job.url,
  recipeId: job.status === "succeeded" ? job.recipeId : null,
  errorCode: job.errorCode,
  createdAt: job.createdAt.toISOString(),
  startedAt: job.startedAt?.toISOString() ?? null,
  finishedAt: job.finishedAt?.toISOString() ?? null,
});

const mapImportJobRow = (row: typeof importJobs.$inferSelect): ImportJobRecord => ({
  id: row.id,
  userId: row.userId,
  kind: row.kind,
  status: row.status,
  url: row.url,
  normalizedUrl: row.normalizedUrl,
  recipeId: row.recipeId,
  errorCode: row.errorCode as ImportErrorCode | null,
  errorMessage: row.errorMessage,
  dismissedAt: row.dismissedAt,
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
  recipeId: row.recipeId,
  errorCode: row.errorCode as ImportErrorCode | null,
  errorMessage: row.errorMessage,
  dismissedAt: dateFromSql(row.dismissedAt),
  createdAt: dateFromSql(row.createdAt) ?? new Date(),
  startedAt: dateFromSql(row.startedAt),
  finishedAt: dateFromSql(row.finishedAt),
  updatedAt: dateFromSql(row.updatedAt) ?? new Date(),
});

export const createImportJobRepository = (
  db: DbClient,
  planSyncOptions?: AppUserPlanSyncOptions,
): ImportJobRepository => ({
  async createUrlJob({ id, userId, url, normalizedUrl, now }) {
    if (planSyncOptions) {
      await syncAppUserPlanForDb(db, userId, {
        ...planSyncOptions,
        now: planSyncOptions.now ?? now,
      });
    }

    const nowIso = now.toISOString();
    const result = await db.execute<ImportJobSqlRow>(sql`
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
      active_job as (
        select
          id,
          user_id as "userId",
          kind,
          status,
          url,
          normalized_url as "normalizedUrl",
          recipe_id as "recipeId",
          error_code as "errorCode",
          error_message as "errorMessage",
          dismissed_at as "dismissedAt",
          created_at as "createdAt",
          started_at as "startedAt",
          finished_at as "finishedAt",
          updated_at as "updatedAt",
          'existingActiveJob'::text as "resultStatus"
        from import_jobs
        where user_id = ${userId}
          and normalized_url = ${normalizedUrl}
          and status in ('queued', 'running')
        order by created_at desc
        limit 1
      ),
      recipe_limit as (
        select
          selected_user.plan,
          case
            when selected_user.plan = 'pro' then false
            else selected_user.saved_recipe_count >= ${PLAN_LIMITS.free.savedRecipes}
          end as exceeded
        from selected_user
      ),
      inserted_job as (
        insert into import_jobs (
          id,
          user_id,
          kind,
          status,
          url,
          normalized_url,
          created_at,
          updated_at
        )
        select
          ${id},
          ${userId},
          'url',
          'queued',
          ${url},
          ${normalizedUrl},
          ${nowIso}::timestamptz,
          ${nowIso}::timestamptz
        from recipe_limit
        where recipe_limit.exceeded = false
          and not exists (select 1 from active_job)
        on conflict do nothing
        returning
          id,
          user_id as "userId",
          kind,
          status,
          url,
          normalized_url as "normalizedUrl",
          recipe_id as "recipeId",
          error_code as "errorCode",
          error_message as "errorMessage",
          dismissed_at as "dismissedAt",
          created_at as "createdAt",
          started_at as "startedAt",
          finished_at as "finishedAt",
          updated_at as "updatedAt",
          'created'::text as "resultStatus"
      )
      select *
      from inserted_job
      union all
      select *
      from active_job
      union all
      select
        null as id,
        null as "userId",
        null as kind,
        null as status,
        null as url,
        null as "normalizedUrl",
        null as "recipeId",
        null as "errorCode",
        null as "errorMessage",
        null as "dismissedAt",
        null as "createdAt",
        null as "startedAt",
        null as "finishedAt",
        null as "updatedAt",
        'limitExceeded'::text as "resultStatus"
      from recipe_limit
      where recipe_limit.exceeded = true
        and not exists (select 1 from active_job)
        and not exists (select 1 from inserted_job)
      limit 1
    `);

    const row = result.rows[0] as (ImportJobSqlRow & { resultStatus: string }) | undefined;

    if (!row) {
      const [activeJob] = await db
        .select()
        .from(importJobs)
        .where(
          and(
            eq(importJobs.userId, userId),
            eq(importJobs.normalizedUrl, normalizedUrl),
            inArray(importJobs.status, activeStatuses),
          ),
        )
        .orderBy(desc(importJobs.createdAt), desc(importJobs.id))
        .limit(1);

      if (activeJob) {
        return {
          status: "existingActiveJob",
          job: mapImportJobRow(activeJob),
        };
      }

      return { status: "limitExceeded" };
    }

    if (row.resultStatus === "limitExceeded") {
      return { status: "limitExceeded" };
    }

    return {
      status: row.resultStatus === "created" ? "created" : "existingActiveJob",
      job: mapImportJobSqlRow(row),
    };
  },
  async listRecentJobs(userId) {
    const rows = await db
      .select()
      .from(importJobs)
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

    return rows.map(mapImportJobRow);
  },
  async getJob(userId, jobId) {
    const [row] = await db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.userId, userId), eq(importJobs.id, jobId)))
      .limit(1);

    return row ? mapImportJobRow(row) : null;
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
    await syncAppUserPlanForDb(db, recipe.userId, {
      ...planSyncOptions,
      now: planSyncOptions?.now ?? now,
    });

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
});

export type ProcessImportJobDependencies = {
  env: Bindings;
  importJobRepository: ImportJobRepository;
  recipeRepository: RecipeRepository;
  usageRepository: UsageRepository;
  imageService?: RecipeImageService;
  aiProvider?: RecipeImportAIProvider;
  fetcher?: RecipeImportFetcher;
  ytdlpMetadataClient?: YtDlpMetadataClient;
  youtubeDataClient?: YouTubeDataClient;
  createRecipeId?: () => string;
  createImageId?: () => string;
  getCurrentDate?: () => Date;
  logger?: Logger;
};

export const processImportJob = async ({
  jobId,
  env,
  importJobRepository,
  recipeRepository,
  usageRepository,
  imageService,
  aiProvider,
  fetcher,
  ytdlpMetadataClient,
  youtubeDataClient,
  createRecipeId,
  createImageId,
  getCurrentDate,
  logger,
}: ProcessImportJobDependencies & { jobId: string }) => {
  const now = getCurrentDate?.() ?? new Date();
  const timeoutMs = resolveImportJobTimeoutMs(env);
  const expiresBefore = getImportJobExpiresBefore(now, timeoutMs);
  const expired = await importJobRepository.expireJob({ jobId, expiresBefore, now });

  if (expired) {
    return;
  }

  const recipeId = createRecipeId?.() ?? createDefaultRecipeId();
  const claimedJob = await importJobRepository.claimQueuedJob({
    jobId,
    recipeId,
    expiresBefore,
    now,
  });
  const job = claimedJob ?? (await importJobRepository.getJobById(jobId));

  if (!job || job.status !== "running") {
    return;
  }

  const deadline = getImportJobDeadline(job, timeoutMs);
  const sourceHost = resolveImportSourceHost(job.normalizedUrl ?? job.url);
  const jobLogger =
    logger ??
    createLogger({
      jobId,
      sourceHost,
      userId: job.userId,
    });

  if (job.kind !== "url" || !job.url) {
    jobLogger.warn("recipe_import_job_failed", {
      errorCode: "unknown",
      errorMessage: "Import job is invalid.",
      jobId,
      sourceHost,
      userId: job.userId,
    });
    await importJobRepository.markJobFailed({
      jobId,
      errorCode: "unknown",
      errorMessage: "Import job is invalid.",
      now: getCurrentDate?.() ?? new Date(),
    });
    return;
  }

  let finalized: FinalizedRecipeImages | null = null;
  let recipeCreated = false;

  try {
    if (job.recipeId) {
      const existingRecipe = await recipeRepository.getRecipe(job.userId, job.recipeId);

      if (existingRecipe) {
        await assertImportJobIsActive({
          deadline,
          getCurrentDate,
          importJobRepository,
          jobId,
          timeoutMs,
        });
        await importJobRepository.markJobSucceeded({
          jobId,
          recipeId: job.recipeId,
          now: getCurrentDate?.() ?? new Date(),
        });
        return;
      }
    }

    const importResult = await importRecipeFromUrl({
      rawUrl: job.url,
      userId: job.userId,
      env,
      usageRepository,
      aiProvider,
      fetcher,
      ytdlpMetadataClient:
        ytdlpMetadataClient ??
        createYtDlpMetadataClient({
          binding: env.YTDLP_METADATA_CONTAINER,
        }),
      youtubeDataClient,
      now,
      deadline,
      getCurrentDate,
      logger: jobLogger,
    });
    await assertImportJobIsActive({
      deadline,
      getCurrentDate,
      importJobRepository,
      jobId,
      timeoutMs,
    });
    finalized = await finalizeRecipeDraftImages({
      draft: importResult.recipeDraftContent,
      userId: job.userId,
      recipeId: job.recipeId ?? recipeId,
      imageService,
      createImageId,
    });
    await assertImportJobIsActive({
      deadline,
      getCurrentDate,
      importJobRepository,
      jobId,
      timeoutMs,
    });
    const source = normalizeRecipeSource(importResult.source);
    const createdAt = getCurrentDate?.() ?? new Date();
    const result = await importJobRepository.completeJobWithRecipe({
      jobId,
      expiresBefore: getImportJobExpiresBefore(createdAt, timeoutMs),
      now: createdAt,
      recipe: {
        id: job.recipeId ?? recipeId,
        userId: job.userId,
        title: finalized.content.title,
        content: finalized.content,
        originType: "url",
        sourceUrl: source.sourceUrl,
        normalizedSourceUrl: source.normalizedSourceUrl,
        sourceName: source.sourceName,
        searchText: buildRecipeSearchText({
          content: finalized.content,
          sourceName: source.sourceName,
        }),
        createdAt,
        updatedAt: createdAt,
      },
    });

    if (result.status === "limitExceeded") {
      await deleteObjectsBestEffort(imageService, finalized.copiedKeys);
      jobLogger.warn("recipe_import_job_failed", {
        errorCode: "recipe_limit_exceeded",
        errorMessage: "Recipe limit exceeded.",
        jobId,
        sourceHost,
        userId: job.userId,
      });
      return;
    }

    if (result.status === "timedOut") {
      await deleteObjectsBestEffort(imageService, finalized.copiedKeys);
      jobLogger.warn("recipe_import_job_failed", {
        errorCode: "job_timeout",
        errorMessage: "Import job timed out.",
        jobId,
        sourceHost,
        userId: job.userId,
      });
      return;
    }

    if (result.status === "inactive") {
      await deleteObjectsBestEffort(imageService, finalized.copiedKeys);
      return;
    }

    recipeCreated = true;
    await deleteObjectsBestEffort(imageService, finalized.tmpKeys);
  } catch (error) {
    if (finalized && !recipeCreated) {
      await deleteObjectsBestEffort(imageService, finalized.copiedKeys);
    }

    let failure = error;
    const failedAt = getCurrentDate?.() ?? new Date();
    if (failedAt.getTime() >= deadline.getTime()) {
      await importJobRepository.expireJob({
        jobId,
        expiresBefore: getImportJobExpiresBefore(failedAt, timeoutMs),
        now: failedAt,
      });
      failure = new RecipeImportError("job_timeout", "Import job timed out.");
    }

    if (!(failure instanceof RecipeImportError) && !(failure instanceof RecipeImageFinalizeError)) {
      jobLogger.error("recipe_import_job_unexpected_error", {
        error: failure,
        jobId,
        sourceHost,
        userId: job.userId,
      });
      throw failure;
    }

    const mapped = mapImportJobFailure(failure);
    await importJobRepository.markJobFailed({
      jobId,
      errorCode: mapped.code,
      errorMessage: mapped.message,
      now: getCurrentDate?.() ?? new Date(),
    });
    jobLogger.warn("recipe_import_job_failed", {
      error: failure,
      errorCode: mapped.code,
      errorMessage: mapped.message,
      jobId,
      sourceHost,
      userId: job.userId,
    });
  }
};

const assertImportJobIsActive = async ({
  deadline,
  getCurrentDate,
  importJobRepository,
  jobId,
  timeoutMs,
}: {
  deadline: Date;
  getCurrentDate?: () => Date;
  importJobRepository: ImportJobRepository;
  jobId: string;
  timeoutMs: number;
}) => {
  const now = getCurrentDate?.() ?? new Date();
  if (now.getTime() < deadline.getTime()) return;

  await importJobRepository.expireJob({
    jobId,
    expiresBefore: getImportJobExpiresBefore(now, timeoutMs),
    now,
  });
  throw new RecipeImportError("job_timeout", "Import job timed out.");
};

const resolveImportSourceHost = (sourceUrl: string | null) => {
  if (!sourceUrl) return undefined;

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

const mapImportJobFailure = (
  error: unknown,
): {
  code: ImportErrorCode;
  message: string;
} => {
  if (error instanceof RecipeImportError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof RecipeImageFinalizeError) {
    return {
      code: "unknown",
      message: error.message,
    };
  }

  return {
    code: "unknown",
    message: error instanceof Error ? error.message : "Unexpected error occurred.",
  };
};
