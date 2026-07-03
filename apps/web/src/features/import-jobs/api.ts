import {
  type CreateImportUrlJobResponse,
  type DismissImportJobResponse,
  type RecentImportJobsResponse,
} from "@recipestock/schemas";
import { parseApiResponse } from "../../lib/api";

export const createImportUrlJob = (url: string): Promise<CreateImportUrlJobResponse> =>
  parseApiResponse<CreateImportUrlJobResponse>(
    fetch("/api/import/url/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );

export const fetchRecentImportJobs = (): Promise<RecentImportJobsResponse> =>
  parseApiResponse<RecentImportJobsResponse>(
    fetch("/api/import/jobs/recent", {
      method: "GET",
      credentials: "include",
    }),
  );

export const dismissFinishedImportJob = (jobId: string): Promise<DismissImportJobResponse> =>
  parseApiResponse<DismissImportJobResponse>(
    fetch(`/api/import/jobs/${encodeURIComponent(jobId)}/dismiss`, {
      method: "PATCH",
      credentials: "include",
    }),
  );
