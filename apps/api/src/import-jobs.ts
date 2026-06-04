import { type DbClient, importJobs } from "@recipestock/db";
import {
  type ImportErrorCode,
  type ImportJobKind,
  type ImportJobStatus,
  type ImportJobSummary,
} from "@recipestock/schemas";
import { normalizeUrl, PLAN_LIMITS } from "@recipestock/shared";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { type Bindings } from "./env";
import { type RecipeImageService } from "./images";
import {
  assertImportUrlAllowed,
  createDefaultRecipeImportAIProvider,
  importRecipeFromUrl,
  type RecipeImportAIProvider,
  RecipeImportError,
  type RecipeImportFetcher,
} from "./import-url";
import {
  deleteObjectsBestEffort,
  finalizeRecipeDraftImages,
  RecipeImageFinalizeError,
} from "./recipe-images";
import {
  buildRecipeSearchText,
  createRecipeId as createDefaultRecipeId,
  normalizeRecipeSource,
  type RecipeRepository,
} from "./recipes";
import { type UsageRepository } from "./usage";

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
  claimQueuedJob(params: {
    jobId: string;
    recipeId: string;
    now: Date;
  }): Promise<ImportJobRecord | null>;
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

export const createImportJobId = () => ulid();

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

export const createImportJobRepository = (db: DbClient): ImportJobRepository => ({
  async createUrlJob({ id, userId, url, normalizedUrl, now }) {
    const nowIso = now.toISOString();
    const result = await db.execute<ImportJobSqlRow>(sql`
      with ensured_user as (
        insert into app_users (user_id)
        values (${userId})
        on conflict (user_id) do nothing
        returning plan
      ),
      selected_user as (
        select ensured_user.plan
        from ensured_user
        union all
        select app_users.plan
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
          and status in ('queued', 'running')
        order by created_at desc
        limit 1
      ),
      recipe_limit as (
        select
          selected_user.plan,
          case
            when selected_user.plan = 'pro' then false
            else (
              select count(*)
              from recipes
              where recipes.user_id = ${userId}
            ) >= ${PLAN_LIMITS.free.savedRecipes}
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
        .where(and(eq(importJobs.userId, userId), inArray(importJobs.status, activeStatuses)))
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
      .orderBy(desc(importJobs.updatedAt), desc(importJobs.id))
      .limit(5);

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
  async claimQueuedJob({ jobId, recipeId, now }) {
    const [row] = await db
      .update(importJobs)
      .set({
        status: "running",
        recipeId,
        startedAt: now,
        updatedAt: now,
      })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "queued")))
      .returning();

    return row ? mapImportJobRow(row) : null;
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
      .where(eq(importJobs.id, jobId));
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
      .where(eq(importJobs.id, jobId));
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
  createRecipeId?: () => string;
  createImageId?: () => string;
  getCurrentDate?: () => Date;
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
  createRecipeId,
  createImageId,
  getCurrentDate,
}: ProcessImportJobDependencies & { jobId: string }) => {
  const now = getCurrentDate?.() ?? new Date();
  const recipeId = createRecipeId?.() ?? createDefaultRecipeId();
  const claimedJob = await importJobRepository.claimQueuedJob({ jobId, recipeId, now });
  const job = claimedJob ?? (await importJobRepository.getJobById(jobId));

  if (!job || job.status !== "running") {
    return;
  }

  if (job.kind !== "url" || !job.url) {
    await importJobRepository.markJobFailed({
      jobId,
      errorCode: "unknown",
      errorMessage: "Import job is invalid.",
      now: getCurrentDate?.() ?? new Date(),
    });
    return;
  }

  try {
    if (job.recipeId) {
      const existingRecipe = await recipeRepository.getRecipe(job.userId, job.recipeId);

      if (existingRecipe) {
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
      aiProvider: aiProvider ?? createDefaultRecipeImportAIProvider(env),
      fetcher,
      now,
    });
    const finalized = await finalizeRecipeDraftImages({
      draft: importResult.recipeDraftContent,
      userId: job.userId,
      recipeId: job.recipeId ?? recipeId,
      imageService,
      createImageId,
    });
    const source = normalizeRecipeSource(importResult.source);
    const createdAt = getCurrentDate?.() ?? new Date();
    const result = await recipeRepository.createRecipeEnforcingPlanLimit({
      id: job.recipeId ?? recipeId,
      userId: job.userId,
      title: finalized.content.title,
      content: finalized.content,
      sourceType: source.sourceType,
      sourcePlatform: source.sourcePlatform,
      sourceUrl: source.sourceUrl,
      normalizedSourceUrl: source.normalizedSourceUrl,
      sourceName: source.sourceName,
      searchText: buildRecipeSearchText({
        content: finalized.content,
        sourceName: source.sourceName,
      }),
      createdAt,
      updatedAt: createdAt,
    });

    if (result.status === "limitExceeded") {
      await deleteObjectsBestEffort(imageService, finalized.copiedKeys);
      await importJobRepository.markJobFailed({
        jobId,
        errorCode: "recipe_limit_exceeded",
        errorMessage: "Recipe limit exceeded.",
        now: getCurrentDate?.() ?? new Date(),
      });
      return;
    }

    await deleteObjectsBestEffort(imageService, finalized.tmpKeys);
    await importJobRepository.markJobSucceeded({
      jobId,
      recipeId: result.recipe.id,
      now: getCurrentDate?.() ?? new Date(),
    });
  } catch (error) {
    if (!(error instanceof RecipeImportError) && !(error instanceof RecipeImageFinalizeError)) {
      throw error;
    }

    const mapped = mapImportJobFailure(error);
    await importJobRepository.markJobFailed({
      jobId,
      errorCode: mapped.code,
      errorMessage: mapped.message,
      now: getCurrentDate?.() ?? new Date(),
    });
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

export const assertImportableUrl = (rawUrl: string) => {
  try {
    const normalizedUrl = normalizeUrl(rawUrl);
    assertImportUrlAllowed(normalizedUrl);
    return normalizedUrl;
  } catch {
    throw new RecipeImportError("invalid_url", "Import URL is invalid.");
  }
};
