import { type CreateImportJobResponse, type ImportJobSummary } from "@recipestock/schemas";
import { createImportTextJob, createImportUrlJob, dismissFinishedImportJob } from "./api";

export const isActiveImportJob = (job: Pick<ImportJobSummary, "status">): boolean =>
  job.status === "queued" || job.status === "running";

export const hasActiveImportJob = (jobs: readonly ImportJobSummary[]): boolean =>
  jobs.some(isActiveImportJob);

const dismissRetriedImportJob = async (jobId: string) => {
  try {
    await dismissFinishedImportJob(jobId);
  } catch {
    // Retry has already started; dismissing the old finished job is best-effort cleanup.
  }
};

export const retryImportUrlJob = async (
  job: ImportJobSummary,
): Promise<CreateImportJobResponse> => {
  if (!job.url) {
    throw new Error("Import job URL is missing.");
  }

  const result = await createImportUrlJob(job.url);
  await dismissRetriedImportJob(job.id);
  return result;
};

/**
 * 送る原文は失敗したjobではなく入力画面から受け取る。テキストは原文を直してから、
 * URLは読み取れなかったページの本文を貼ってから送り直す。
 */
export const retryImportTextJob = async ({
  jobId,
  text,
  sourceUrl,
}: {
  jobId: string;
  text: string;
  sourceUrl?: string;
}): Promise<CreateImportJobResponse> => {
  const result = await createImportTextJob(text, sourceUrl);
  await dismissRetriedImportJob(jobId);
  return result;
};
