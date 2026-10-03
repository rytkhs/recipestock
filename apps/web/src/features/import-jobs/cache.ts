import { type CreateImportJobResponse, type RecentImportJobsResponse } from "@recipestock/schemas";
import { type QueryClient } from "@tanstack/react-query";
import { highlightImportJob } from "./highlight";
import { importJobQueryKeys } from "./query-keys";

const updateRecentImportJobs = (
  queryClient: QueryClient,
  update: (jobs: RecentImportJobsResponse["jobs"]) => RecentImportJobsResponse["jobs"],
) => {
  queryClient.setQueryData<RecentImportJobsResponse>(importJobQueryKeys.recent(), (current) => ({
    jobs: update(current?.jobs ?? []),
  }));
};

/**
 * 送ったjobを、取り込み状況を読み直すのを待たずにアイランドへ出す。
 * 同じものがすでに取り込み中だったときは、新しく作らずにそのjobを目立たせる。
 */
export const showSubmittedImportJob = (
  queryClient: QueryClient,
  { job, kind }: CreateImportJobResponse,
) => {
  updateRecentImportJobs(queryClient, (jobs) => [
    { ...job, recipe: null },
    ...jobs.filter((candidate) => candidate.id !== job.id),
  ]);

  if (kind === "existing_active_job") {
    highlightImportJob(job.id);
  }

  void queryClient.invalidateQueries({ queryKey: importJobQueryKeys.recent() });
};

export const removeRecentImportJob = (queryClient: QueryClient, jobId: string) => {
  updateRecentImportJobs(queryClient, (jobs) => jobs.filter((job) => job.id !== jobId));
};
