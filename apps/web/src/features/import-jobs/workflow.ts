import { type CreateImportUrlJobResponse, type ImportJobSummary } from "@recipestock/schemas";
import { createImportUrlJob, dismissFinishedImportJob } from "./api";

export const hasActiveImportJob = (jobs: ImportJobSummary[]): boolean =>
  jobs.some((job) => job.status === "queued" || job.status === "running");

export const retryImportUrlJob = async (
  job: ImportJobSummary,
): Promise<CreateImportUrlJobResponse> => {
  if (!job.url) {
    throw new Error("Import job URL is missing.");
  }

  const result = await createImportUrlJob(job.url);
  try {
    await dismissFinishedImportJob(job.id);
  } catch {
    // Retry has already started; dismissing the old finished job is best-effort cleanup.
  }
  return result;
};
