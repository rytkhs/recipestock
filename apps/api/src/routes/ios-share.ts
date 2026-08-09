import {
  type IosShareShortcutImportReason,
  iosShareShortcutImportRequestSchema,
  iosShareShortcutImportResponseSchema,
} from "@recipestock/schemas";
import { extractFirstUrl } from "@recipestock/shared";
import { type Context, Hono } from "hono";
import { type ApiEnv } from "../context";
import { buildIosShareShortcutImportResult } from "../ios-share-notices";
import { type UrlImportJobSubmissionFactory } from "../lib/import/url-import-job-submission";
import { type ShortcutCredentials } from "../shortcut-credentials";

type IosShareRouteDependencies = {
  shortcutCredentialsFor: (env: ApiEnv["Bindings"]) => Pick<ShortcutCredentials, "authenticate">;
  urlImportJobSubmissionFor: UrlImportJobSubmissionFactory;
  shortcutClientRateLimiterFor: (env: ApiEnv["Bindings"]) => RateLimit;
  shortcutRateLimiterFor: (env: ApiEnv["Bindings"]) => RateLimit;
};

type ShortcutImportLogFields = {
  credentialId?: string;
  rateLimitScope?: "client" | "credential";
  sourceHost?: string;
  userId?: string;
};

const bearerToken = (header: string | undefined) => {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

/**
 * Cloudflareの背後では常に付与される。欠落するのはlocal devとtestだけであり、
 * そこで制限を素通りさせると迂回路になるため、単一のbucketへまとめる。
 * IPは監視ログへ残さない。発信元の追跡はCloudflare側の分析に委ねる。
 */
const clientRateLimitKey = (c: Context<ApiEnv>) => c.req.header("cf-connecting-ip") ?? "unknown";

const sourceHostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

/**
 * 200で返す以上、HTTPステータスからlevelを決める`api_request_completed`では拾えない。
 * 従来4xx/5xxとしてwarnになっていた結果は、このlevelで引き続きアラートできるようにする。
 */
const warnedReasons = new Set<IosShareShortcutImportReason>([
  "malformed_request",
  "unauthorized",
  "rate_limit_exceeded",
  "temporarily_unavailable",
  /**
   * freeのAI上限到達はコンバージョン機会であり通常の利用結果だが、proの枠切れは
   * 容量または濫用の兆候である。到達人口が異なるため、監視上も別の事象として扱う。
   */
  "ai_usage_quota_exhausted",
]);

/**
 * Shortcutの`URLの内容を取得`は非2xxで実行ごと停止し、こちらの文言を一切表示できない。
 * 想定内の結果はすべて200 + noticeで返し、`reason`をHTTPステータスに代わる監視の軸にする。
 */
const respondWithNotice = (
  c: Context<ApiEnv>,
  reason: IosShareShortcutImportReason,
  logFields: ShortcutImportLogFields = {},
) => {
  const result = buildIosShareShortcutImportResult({
    reason,
    appOrigin: c.env.APP_ORIGIN,
  });
  const logger = c.get("logger");
  const fields = {
    ...logFields,
    outcome: result.outcome,
    reason,
    shortcutVersion: c.req.header("x-shortcut-version"),
  };

  if (warnedReasons.has(reason)) {
    logger.warn("ios_share_shortcut_import_submitted", fields);
  } else {
    logger.info("ios_share_shortcut_import_submitted", fields);
  }

  return c.json(iosShareShortcutImportResponseSchema.parse(result), 200);
};

export const createIosShareRoutes = ({
  shortcutCredentialsFor,
  urlImportJobSubmissionFor,
  shortcutClientRateLimiterFor,
  shortcutRateLimiterFor,
}: IosShareRouteDependencies) => {
  const routes = new Hono<ApiEnv>();

  return routes.post("/import-jobs", async (c) => {
    /**
     * `credentialId`単位の制限は認証を通過したrequestにしか効かない。無効なtokenは
     * 1requestごとにhash照合のDBアクセスを起こすため、認証へ到達する前にも上限を置く。
     */
    const clientLimiter = shortcutClientRateLimiterFor(c.env);
    const clientLimit = await clientLimiter.limit({ key: clientRateLimitKey(c) });
    if (!clientLimit.success) {
      return respondWithNotice(c, "rate_limit_exceeded", { rateLimitScope: "client" });
    }

    const token = bearerToken(c.req.header("authorization"));
    if (!token) {
      return respondWithNotice(c, "unauthorized");
    }

    const identity = await shortcutCredentialsFor(c.env).authenticate({ token });
    if (!identity) {
      return respondWithNotice(c, "unauthorized");
    }

    const logFields: ShortcutImportLogFields = {
      credentialId: identity.credentialId,
      userId: identity.userId,
    };

    const limiter = shortcutRateLimiterFor(c.env);
    const { success } = await limiter.limit({ key: identity.credentialId });
    if (!success) {
      return respondWithNotice(c, "rate_limit_exceeded", {
        ...logFields,
        rateLimitScope: "credential",
      });
    }

    const request = iosShareShortcutImportRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!request.success) {
      return respondWithNotice(c, "malformed_request", logFields);
    }

    const url = extractFirstUrl(request.data.input);
    if (!url) {
      return respondWithNotice(c, "no_url_in_input", logFields);
    }

    const result = await urlImportJobSubmissionFor(c.env).submit({
      userId: identity.userId,
      url,
      notifyOnCompletion: true,
    });
    const submissionLogFields = { ...logFields, sourceHost: sourceHostOf(url) };

    if (result.status === "invalidUrl") {
      return respondWithNotice(c, "invalid_url", submissionLogFields);
    }

    if (result.status === "recipeLimitExceeded") {
      return respondWithNotice(c, "recipe_limit_exceeded", submissionLogFields);
    }

    if (result.status === "aiUsageLimitExceeded") {
      return respondWithNotice(
        c,
        result.plan === "pro" ? "ai_usage_quota_exhausted" : "ai_usage_limit_exceeded",
        submissionLogFields,
      );
    }

    if (result.status === "temporarilyUnavailable") {
      return respondWithNotice(c, "temporarily_unavailable", submissionLogFields);
    }

    return respondWithNotice(
      c,
      result.kind === "created" ? "created" : "existing_active_job",
      submissionLogFields,
    );
  });
};
