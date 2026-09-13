import { createDb } from "@recipestock/db";
import {
  createImportJobResponseSchema,
  dismissImportJobResponseSchema,
  getImportJobResponseSchema,
  recentImportJobsResponseSchema,
} from "@recipestock/schemas";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  aiUsageLimitExceededResponse,
  invalidUrlResponse,
  notFoundResponse,
  recipeLimitExceededResponse,
  temporarilyUnavailableResponse,
  validationFailedResponse,
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
import { type TextImportJobSubmissionFactory } from "../lib/import/text-import-job-submission";
import { type UrlImportJobSubmissionFactory } from "../lib/import/url-import-job-submission";
import { requireAuth } from "../middleware/auth";

/**
 * 原文の文字数はJSONを読んでから検証するので、読む前に本文の大きさを抑える。
 * 上限文字数の原文がJSONのエスケープで膨らんでも収まる大きさにしている。
 */
const IMPORT_TEXT_REQUEST_MAX_BYTES = 64 * 1024;

type ImportRouteDependencies = {
  auth: AuthService;
  urlImportJobSubmissionFor: UrlImportJobSubmissionFactory;
  textImportJobSubmissionFor: TextImportJobSubmissionFactory;
  importJobRepository?: ImportJobRepository;
  getCurrentDate?: () => Date;
};

export const createImportRoutes = ({
  auth,
  urlImportJobSubmissionFor,
  textImportJobSubmissionFor,
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

      if (result.status === "aiUsageLimitExceeded") {
        return aiUsageLimitExceededResponse();
      }

      if (result.status === "temporarilyUnavailable") {
        return temporarilyUnavailableResponse();
      }

      return c.json(
        createImportJobResponseSchema.parse({
          kind: result.kind,
          job: toImportJobSummary(result.job),
        }),
        202,
      );
    })
    .post(
      "/text/jobs",
      requireAuth(auth),
      bodyLimit({
        maxSize: IMPORT_TEXT_REQUEST_MAX_BYTES,
        onError: () => validationFailedResponse(undefined),
      }),
      async (c) => {
        const userId = c.get("userId");
        const rawBody = await c.req.json().catch(() => null);
        const text =
          typeof rawBody === "object" && rawBody !== null && "text" in rawBody
            ? rawBody.text
            : undefined;

        const result = await textImportJobSubmissionFor(c.env).submit({ userId, text });

        if (result.status === "invalidText") {
          return validationFailedResponse(result.issues);
        }

        if (result.status === "recipeLimitExceeded") {
          return recipeLimitExceededResponse();
        }

        if (result.status === "aiUsageLimitExceeded") {
          return aiUsageLimitExceededResponse();
        }

        if (result.status === "temporarilyUnavailable") {
          return temporarilyUnavailableResponse();
        }

        return c.json(
          createImportJobResponseSchema.parse({
            kind: result.kind,
            job: toImportJobSummary(result.job),
          }),
          202,
        );
      },
    )
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

      return c.json(
        getImportJobResponseSchema.parse({
          job: toImportJobSummary(job),
          sourceText: job.sourceText,
        }),
      );
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
