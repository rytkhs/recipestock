import { createDb } from "@recipestock/db";
import { createIosShareImportJobResponseSchema } from "@recipestock/schemas";
import { Hono } from "hono";
import {
  invalidUrlResponse,
  rateLimitExceededResponse,
  recipeLimitExceededResponse,
  unauthorizedResponse,
} from "../api-error";
import { type ApiEnv } from "../context";
import { createImportJobId, type ImportJobRepository, toImportJobSummary } from "../import-jobs";
import {
  createUrlImportJobSubmission,
  type UrlImportJobSubmission,
} from "../lib/import/url-import-job-submission";
import {
  createShortcutCredentialRepository,
  createShortcutCredentials,
  type ShortcutCredentials,
} from "../shortcut-credentials";

type IosShareRouteDependencies = {
  shortcutCredentials?: Pick<ShortcutCredentials, "authenticate">;
  urlImportJobSubmission?: UrlImportJobSubmission;
  importJobRepository?: ImportJobRepository;
  importQueue?: Queue<{ jobId: string }>;
  createImportJobId?: () => string;
  shortcutRateLimiter?: RateLimit;
  getCurrentDate?: () => Date;
};

const bearerToken = (header: string | undefined) => {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

export const createIosShareRoutes = ({
  shortcutCredentials,
  urlImportJobSubmission,
  importJobRepository,
  importQueue,
  createImportJobId: createJobId,
  shortcutRateLimiter,
  getCurrentDate,
}: IosShareRouteDependencies) => {
  const routes = new Hono<ApiEnv>();
  const credentialsFor = (env: ApiEnv["Bindings"]) =>
    shortcutCredentials ??
    createShortcutCredentials({
      repository: createShortcutCredentialRepository(createDb(env.DATABASE_URL)),
      getCurrentDate,
    });
  const submissionFor = (env: ApiEnv["Bindings"]) =>
    urlImportJobSubmission ??
    createUrlImportJobSubmission({
      env,
      importJobRepository,
      importQueue,
      createImportJobId: createJobId ?? createImportJobId,
      getCurrentDate,
    });

  return routes.post("/shortcut/import-jobs", async (c) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) {
      return unauthorizedResponse();
    }

    const identity = await credentialsFor(c.env).authenticate({ token });
    if (!identity) {
      return unauthorizedResponse();
    }

    const limiter = shortcutRateLimiter ?? c.env.SHORTCUT_RATE_LIMITER;
    const { success } = await limiter.limit({ key: identity.credentialId });
    if (!success) {
      return rateLimitExceededResponse();
    }

    const rawBody = await c.req.json().catch(() => null);
    const body =
      typeof rawBody === "object" && rawBody !== null ? (rawBody as Record<string, unknown>) : null;
    const result = await submissionFor(c.env).submit({
      entryPoint: "ios_shortcut",
      userId: identity.userId,
      url: body?.url,
    });

    if (result.status === "invalidUrl") {
      return invalidUrlResponse();
    }

    if (result.status === "recipeLimitExceeded") {
      return recipeLimitExceededResponse();
    }

    return c.json(
      createIosShareImportJobResponseSchema.parse({
        kind: result.kind,
        job: toImportJobSummary(result.job),
      }),
      202,
    );
  });
};
