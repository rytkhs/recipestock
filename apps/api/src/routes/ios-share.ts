import { createIosShareImportJobResponseSchema } from "@recipestock/schemas";
import { Hono } from "hono";
import {
  invalidUrlResponse,
  rateLimitExceededResponse,
  recipeLimitExceededResponse,
  temporarilyUnavailableResponse,
  unauthorizedResponse,
} from "../api-error";
import { type ApiEnv } from "../context";
import { toImportJobSummary } from "../import-jobs";
import { type UrlImportJobSubmissionFactory } from "../lib/import/url-import-job-submission";
import { type ShortcutCredentials } from "../shortcut-credentials";

type IosShareRouteDependencies = {
  shortcutCredentialsFor: (env: ApiEnv["Bindings"]) => Pick<ShortcutCredentials, "authenticate">;
  urlImportJobSubmissionFor: UrlImportJobSubmissionFactory;
  shortcutRateLimiterFor: (env: ApiEnv["Bindings"]) => RateLimit;
};

const bearerToken = (header: string | undefined) => {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

export const createIosShareRoutes = ({
  shortcutCredentialsFor,
  urlImportJobSubmissionFor,
  shortcutRateLimiterFor,
}: IosShareRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.post("/shortcut/import-jobs", async (c) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) {
      return unauthorizedResponse();
    }

    const identity = await shortcutCredentialsFor(c.env).authenticate({ token });
    if (!identity) {
      return unauthorizedResponse();
    }

    const limiter = shortcutRateLimiterFor(c.env);
    const { success } = await limiter.limit({ key: identity.credentialId });
    if (!success) {
      return rateLimitExceededResponse();
    }

    const rawBody = await c.req.json().catch(() => null);
    const body =
      typeof rawBody === "object" && rawBody !== null ? (rawBody as Record<string, unknown>) : null;
    const result = await urlImportJobSubmissionFor(c.env).submit({
      userId: identity.userId,
      url: body?.url,
      notifyOnCompletion: true,
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
      createIosShareImportJobResponseSchema.parse({
        kind: result.kind,
        job: toImportJobSummary(result.job),
      }),
      202,
    );
  });
};
