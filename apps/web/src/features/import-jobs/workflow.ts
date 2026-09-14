import { type CreateImportJobResponse, type ImportJobSummary } from "@recipestock/schemas";
import { createImportTextJob, createImportUrlJob, dismissFinishedImportJob } from "./api";

export const hasActiveImportJob = (jobs: ImportJobSummary[]): boolean =>
  jobs.some((job) => job.status === "queued" || job.status === "running");

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
 * テキストは原文を直してから送り直すので、送る原文は失敗したjobではなく入力画面から受け取る。
 */
export const retryImportTextJob = async ({
  jobId,
  text,
}: {
  jobId: string;
  text: string;
}): Promise<CreateImportJobResponse> => {
  const result = await createImportTextJob(text);
  await dismissRetriedImportJob(jobId);
  return result;
};
