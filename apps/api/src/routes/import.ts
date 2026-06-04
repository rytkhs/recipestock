import { createDb } from "@recipestock/db";
import {
  createImportUrlJobResponseSchema,
  dismissImportJobResponseSchema,
  getImportJobResponseSchema,
  importUrlRequestSchema,
  recentImportJobsResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import { invalidUrlResponse, notFoundResponse, recipeLimitExceededResponse } from "../api-error";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import {
  assertImportableUrl,
  createImportJobId,
  createImportJobRepository,
  type ImportJobRepository,
  toImportJobSummary,
} from "../import-jobs";
import { RecipeImportError } from "../import-url";
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
      const request = importUrlRequestSchema.safeParse(rawBody);

      if (!request.success) {
        return invalidUrlResponse();
      }

      let normalizedUrl: string;

      try {
        normalizedUrl = assertImportableUrl(request.data.url);
      } catch (error) {
        if (error instanceof RecipeImportError && error.code === "invalid_url") {
          return invalidUrlResponse();
        }

        throw error;
      }

      const repository =
        importJobRepository ?? createImportJobRepository(createDb(c.env.DATABASE_URL));
      const result = await repository.createUrlJob({
        id: createJobId?.() ?? createImportJobId(),
        userId,
        url: request.data.url,
        normalizedUrl,
        now: getCurrentDate?.() ?? new Date(),
      });

      if (result.status === "limitExceeded") {
        return recipeLimitExceededResponse();
      }

      if (result.status === "created") {
        try {
          await (importQueue ?? c.env.IMPORT_QUEUE).send(
            { jobId: result.job.id },
            { contentType: "json" },
          );
        } catch (error) {
          await repository.markJobFailed({
            jobId: result.job.id,
            errorCode: "unknown",
            errorMessage: error instanceof Error ? error.message : "Import queue send failed.",
            now: getCurrentDate?.() ?? new Date(),
          });
          throw error;
        }
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
      const repository =
        importJobRepository ?? createImportJobRepository(createDb(c.env.DATABASE_URL));
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
