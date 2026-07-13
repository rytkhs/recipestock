import { createDb } from "@recipestock/db";
import {
  createImportUrlJobResponseSchema,
  dismissImportJobResponseSchema,
  getImportJobResponseSchema,
  recentImportJobsResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import { invalidUrlResponse, notFoundResponse, recipeLimitExceededResponse } from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import {
  createImportJobRepository,
  getImportJobExpiresBefore,
  type ImportJobRepository,
  resolveImportJobTimeoutMs,
  toImportJobSummary,
} from "../import-jobs";
import { createUrlImportJobSubmission } from "../lib/import/url-import-job-submission";
import { requireAuth } from "../middleware/auth";

type ImportRouteDependencies = {
  auth: AuthService;
  importJobRepository?: ImportJobRepository;
  importQueue?: Queue<{ jobId: string }>;
  createImportJobId?: () => string;
  getCurrentDate?: () => Date;
};

export const createImportRoutes = ({
  auth,
  importJobRepository,
  importQueue,
  createImportJobId: createJobId,
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

      const result = await createUrlImportJobSubmission({
        env: c.env,
        importJobRepository,
        importQueue,
        createImportJobId: createJobId,
        getCurrentDate,
      }).submit({
        userId,
        url,
      });

      if (result.status === "invalidUrl") {
        return invalidUrlResponse();
      }

      if (result.status === "recipeLimitExceeded") {
        return recipeLimitExceededResponse();
      }

      return c.json(
        createImportUrlJobResponseSchema.parse({
          kind: result.status === "created" ? "created" : "existing_active_job",
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
