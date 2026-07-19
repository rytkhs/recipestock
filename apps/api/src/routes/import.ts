import { createDb } from "@recipestock/db";
import {
  createImportUrlJobResponseSchema,
  dismissImportJobResponseSchema,
  getImportJobResponseSchema,
  recentImportJobsResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import {
  invalidUrlResponse,
  notFoundResponse,
  recipeLimitExceededResponse,
  temporarilyUnavailableResponse,
} from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import {
  createImportJobRepository,
  getImportJobExpiresBefore,
  type ImportJobRepository,
  resolveImportJobTimeoutMs,
  toImportJobSummary,
} from "../import-jobs";
import { type UrlImportJobSubmissionFactory } from "../lib/import/url-import-job-submission";
import { requireAuth } from "../middleware/auth";

type ImportRouteDependencies = {
  auth: AuthService;
  urlImportJobSubmissionFor: UrlImportJobSubmissionFactory;
  importJobRepository?: ImportJobRepository;
  getCurrentDate?: () => Date;
};

export const createImportRoutes = ({
  auth,
  urlImportJobSubmissionFor,
  importJobRepository,
  getCurrentDate,
}: ImportRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes
    .post("/url/jobs", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const rawBody = await c.req.json().catch(() => null);
      const url =
        typeof rawBody === "object" && rawBody !== null && "url" in rawBody
          ? rawBody.url
          : undefined;

      const result = await urlImportJobSubmissionFor(c.env).submit({
        userId,
        url,
        notifyOnCompletion: false,
      });

      if (result.status === "invalidUrl") {
        return invalidUrlResponse();
      }

      if (result.status === "recipeLimitExceeded") {
        return recipeLimitExceededResponse();
      }

      if (result.status === "temporarilyUnavailable") {
        return temporarilyUnavailableResponse();
      }

      return c.json(
        createImportUrlJobResponseSchema.parse({
          kind: result.kind,
          job: toImportJobSummary(result.job),
        }),
        202,
      );
    })
    .get("/jobs/recent", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const now = getCurrentDate?.() ?? new Date();
      const repository =
        importJobRepository ?? createImportJobRepository(createDb(c.env.DATABASE_URL));
      await repository.expireActiveJobsForUser({
        userId,
        expiresBefore: getImportJobExpiresBefore(now, resolveImportJobTimeoutMs(c.env)),
        now,
      });
      const jobs = await repository.listRecentJobs(userId);

      return c.json(
        recentImportJobsResponseSchema.parse({
          jobs: jobs.map(toImportJobSummary),
        }),
      );
    })
    .get("/jobs/:jobId", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository =
        importJobRepository ?? createImportJobRepository(createDb(c.env.DATABASE_URL));
      const job = await repository.getJob(userId, c.req.param("jobId"));

      if (!job) {
        return notFoundResponse("Import job was not found.");
      }

      return c.json(getImportJobResponseSchema.parse({ job: toImportJobSummary(job) }));
    })
    .patch("/jobs/:jobId/dismiss", requireAuth(auth), async (c) => {
      const userId = c.get("userId");
      const repository =
        importJobRepository ?? createImportJobRepository(createDb(c.env.DATABASE_URL));
      const job = await repository.dismissJob({
        userId,
        jobId: c.req.param("jobId"),
        now: getCurrentDate?.() ?? new Date(),
      });

      if (!job) {
        return notFoundResponse("Import job was not found.");
      }

      return c.json(dismissImportJobResponseSchema.parse({ job: toImportJobSummary(job) }));
    });
};
