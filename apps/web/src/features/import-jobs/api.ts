import {
  type CreateImportJobResponse,
  type DismissImportJobResponse,
  type GetImportJobResponse,
  type RecentImportJobsResponse,
} from "@recipestock/schemas";
import { parseApiResponse } from "../../lib/api";

export const createImportUrlJob = (url: string): Promise<CreateImportJobResponse> =>
  parseApiResponse<CreateImportJobResponse>(
    fetch("/api/import/url/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );

export const createImportTextJob = (text: string): Promise<CreateImportJobResponse> =>
  parseApiResponse<CreateImportJobResponse>(
    fetch("/api/import/text/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );

export const fetchRecentImportJobs = (): Promise<RecentImportJobsResponse> =>
  parseApiResponse<RecentImportJobsResponse>(
    fetch("/api/import/jobs/recent", {
      method: "GET",
      credentials: "include",
    }),
  );

export const fetchImportJob = (jobId: string): Promise<GetImportJobResponse> =>
  parseApiResponse<GetImportJobResponse>(
    fetch(`/api/import/jobs/${encodeURIComponent(jobId)}`, {
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
