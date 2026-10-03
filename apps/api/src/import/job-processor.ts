import { type ImportErrorCode } from "@recipestock/schemas";
import { type Bindings } from "../env";
import { type RecipeImageService } from "../images";
import { createLogger, type Logger } from "../logger";
import {
  deleteObjectsBestEffort,
  type FinalizedRecipeImages,
  finalizeRecipeDraftImages,
  RecipeImageFinalizeError,
} from "../recipe-images";
import {
  buildRecipeSearchText,
  createRecipeId as createDefaultRecipeId,
  normalizeRecipeSource,
  type RecipeRepository,
} from "../recipes";
import { type AiUsageConsumptionRepository } from "../usage";
import {
  getImportJobExpiresBefore,
  type ImportJobRecord,
  type ImportJobRepository,
  resolveImportJobTimeoutMs,
} from "./jobs";
import { type YouTubeDataClient } from "./source-extraction/youtube-data";
import { importRecipeFromText } from "./text-import";
import { type RecipeImportAIProvider, RecipeImportError, type RecipeImportFetcher } from "./types";
import { importRecipeFromUrl } from "./url-import";

const getImportJobDeadline = (job: ImportJobRecord, timeoutMs: number) =>
  new Date(job.createdAt.getTime() + timeoutMs);

export type ProcessImportJobDependencies = {
  env: Bindings;
  importJobRepository: ImportJobRepository;
  recipeRepository: RecipeRepository;
  usageRepository: AiUsageConsumptionRepository;
  imageService?: RecipeImageService;
  aiProvider?: RecipeImportAIProvider;
  fetcher?: RecipeImportFetcher;
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

  const input = resolveImportJobInput(job);

  if (!input) {
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

    const importResult =
      input.kind === "url"
        ? await importRecipeFromUrl({
            rawUrl: input.url,
            userId: job.userId,
            env,
            usageRepository,
            aiProvider,
            fetcher,
            youtubeDataClient,
            now,
            deadline,
            getCurrentDate,
            logger: jobLogger,
          })
        : await importRecipeFromText({
            sourceText: input.sourceText,
            sourceUrl: input.sourceUrl,
            userId: job.userId,
            env,
            usageRepository,
            aiProvider,
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
        originType: job.kind,
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

const resolveImportJobInput = (job: ImportJobRecord) => {
  if (job.kind === "url" && job.url) {
    return { kind: "url" as const, url: job.url };
  }

  if (job.kind === "text" && job.sourceText) {
    return { kind: "text" as const, sourceText: job.sourceText, sourceUrl: job.url };
  }

  return null;
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
