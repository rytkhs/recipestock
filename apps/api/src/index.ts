import { createDb, withoutQueryParams } from "@recipestock/db";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { unknownResponse } from "./api-error";
import { type AuthService, authService } from "./auth";
import { type BillingRepository, createBillingRepository } from "./billing";
import { type ApiEnv } from "./context";
import { type Bindings, createBindingValidationGuard } from "./env";
import { type RecipeImageService } from "./images";
import {
  createImportJobRepository,
  type ImportJobRepository,
  resolveImportJobTimeoutMs,
} from "./import/jobs";
import { handleImportQueueBatch } from "./import/queue";
import { checkImportQueueHealth } from "./import/queue-health";
import { createTextImportJobSubmission } from "./import/text-import-job-submission";
import {
  createUrlImportJobSubmission,
  type UrlImportJobSubmission,
} from "./import/url-import-job-submission";
import { createLogger, type LoggerFactory } from "./logger";
import { createMeRepository, type MeRepository } from "./me";
import {
  createSentryCheckInReporter,
  createSentryOptions,
  type ErrorReporter,
  sentryErrorReporter,
} from "./monitoring";
import {
  createPushSubscriptionRepository,
  type PushSubscriptionRepository,
} from "./push-subscriptions";
import { createRecipeRepository, type RecipeRepository } from "./recipes";
import { createAuthRoutes } from "./routes/auth";
import { createBillingRoutes } from "./routes/billing";
import { createImageRoutes } from "./routes/images";
import { createImportRoutes } from "./routes/import";
import { createIosShareRoutes } from "./routes/ios-share";
import { createMeRoutes } from "./routes/me";
import { createPushSubscriptionRoutes } from "./routes/push-subscriptions";
import { createRecipeRoutes } from "./routes/recipes";
import { createShortcutCredentialRoutes } from "./routes/shortcut-credentials";
import { createStripeRoutes } from "./routes/stripe";
import { createTagRoutes } from "./routes/tags";
import { createUsageRoutes } from "./routes/usage";
import {
  createShortcutCredentialRepository,
  createShortcutCredentials,
  type ShortcutCredentials,
} from "./shortcut-credentials";
import { type StripeBillingClient } from "./stripe-billing";
import { createTagRepository, type TagRepository } from "./tags";
import { createUsageRepository, type UsageRepository } from "./usage";

const IMPORT_QUEUE_HEALTH_MONITOR_SLUG = "import-queue-health";

export type AppDependencies = {
  auth?: AuthService;
  errorReporter?: ErrorReporter;
  loggerFactory?: LoggerFactory;
  meRepository?: MeRepository;
  usageRepository?: UsageRepository;
  billingRepository?: BillingRepository;
  recipeRepository?: RecipeRepository;
  tagRepository?: TagRepository;
  pushSubscriptionRepository?: PushSubscriptionRepository;
  importJobRepository?: ImportJobRepository;
  shortcutCredentials?: ShortcutCredentials;
  urlImportJobSubmission?: UrlImportJobSubmission;
  shortcutClientRateLimiter?: RateLimit;
  shortcutRateLimiter?: RateLimit;
  importQueue?: Queue<{ jobId: string }>;
  imageService?: RecipeImageService;
  stripeBillingClient?: StripeBillingClient;
  createImportJobId?: () => string;
  createRecipeId?: () => string;
  createImageId?: () => string;
  createPushSubscriptionId?: () => string;
  getCurrentMonth?: () => string;
  getCurrentDate?: () => Date;
};

const createLoggerMiddleware = (loggerFactory: LoggerFactory) =>
  createMiddleware<ApiEnv>(async (c, next) => {
    const requestId = crypto.randomUUID();
    const logger = loggerFactory({
      requestId,
      route: c.req.path,
    });
    const startedAt = Date.now();

    c.set("requestId", requestId);
    c.set("logger", logger);

    await next();

    // 問い合わせで受け取った値から、そのままログを引けるようにする。
    c.res.headers.set("X-Request-ID", requestId);

    const status = c.res.status;
    const fields = {
      durationMs: Date.now() - startedAt,
      method: c.req.method,
      status,
      userId: c.var.userId,
    };

    if (status >= 500) {
      logger.error("api_request_completed", fields);
      return;
    }

    if (status >= 400) {
      logger.warn("api_request_completed", fields);
      return;
    }

    logger.info("api_request_completed", fields);
  });

export const createApp = (dependencies: AppDependencies = {}) => {
  const app = new Hono<ApiEnv>().basePath("/api");
  const auth = dependencies.auth ?? authService;
  const errorReporter = dependencies.errorReporter ?? sentryErrorReporter;
  const loggerFactory = dependencies.loggerFactory ?? createLogger;
  const csrfProtection = csrf();
  // fetchの経路で使うrepositoryはここで作り、routesは受け取ったものを使う。
  const planOptionsFor = (env: Bindings) => ({ proPriceId: env.STRIPE_PRO_PRICE_ID });
  const recipeRepositoryFor = (env: Bindings) =>
    dependencies.recipeRepository ??
    createRecipeRepository(createDb(env.DATABASE_URL), planOptionsFor(env));
  const tagRepositoryFor = (env: Bindings) =>
    dependencies.tagRepository ?? createTagRepository(createDb(env.DATABASE_URL));
  const meRepositoryFor = (env: Bindings) =>
    dependencies.meRepository ??
    createMeRepository(createDb(env.DATABASE_URL), planOptionsFor(env));
  const usageRepositoryFor = (env: Bindings) =>
    dependencies.usageRepository ??
    createUsageRepository(createDb(env.DATABASE_URL), planOptionsFor(env));
  const billingRepositoryFor = (env: Bindings) =>
    dependencies.billingRepository ?? createBillingRepository(createDb(env.DATABASE_URL));
  const importJobRepositoryFor = (env: Bindings) =>
    dependencies.importJobRepository ??
    createImportJobRepository(createDb(env.DATABASE_URL), planOptionsFor(env));
  const pushSubscriptionRepositoryFor = (env: Bindings) =>
    dependencies.pushSubscriptionRepository ??
    createPushSubscriptionRepository(createDb(env.DATABASE_URL));
  const shortcutCredentialsFor = (env: Bindings) =>
    dependencies.shortcutCredentials ??
    createShortcutCredentials({
      repository: createShortcutCredentialRepository(createDb(env.DATABASE_URL)),
      getCurrentDate: dependencies.getCurrentDate,
    });
  const urlImportJobSubmissionFor = (env: Bindings) =>
    dependencies.urlImportJobSubmission ??
    createUrlImportJobSubmission({
      env,
      importJobRepository: importJobRepositoryFor(env),
      importQueue: dependencies.importQueue,
      createImportJobId: dependencies.createImportJobId,
      getCurrentDate: dependencies.getCurrentDate,
    });
  const textImportJobSubmissionFor = (env: Bindings) =>
    createTextImportJobSubmission({
      env,
      importJobRepository: importJobRepositoryFor(env),
      importQueue: dependencies.importQueue,
      createImportJobId: dependencies.createImportJobId,
      getCurrentDate: dependencies.getCurrentDate,
    });
  const shortcutRateLimiterFor = (env: Bindings) =>
    dependencies.shortcutRateLimiter ?? env.SHORTCUT_RATE_LIMITER;
  const shortcutClientRateLimiterFor = (env: Bindings) =>
    dependencies.shortcutClientRateLimiter ?? env.SHORTCUT_CLIENT_RATE_LIMITER;

  app.onError((error, c) => {
    const response = error instanceof HTTPException ? error.getResponse() : unknownResponse();
    const logger =
      c.var.logger ??
      loggerFactory({
        requestId: c.var.requestId,
        route: c.req.path,
      });

    logger.error("api_request_failed", {
      error,
      method: c.req.method,
      status: response.status,
      userId: c.var.userId,
    });

    // 4xxのHTTPExceptionは入力や権限による想定内の失敗なので送らない。
    if (response.status >= 500) {
      errorReporter.report(error, {
        tags: { request_id: c.var.requestId, route: routePath(c) },
        userId: c.var.userId,
      });
    }

    return response;
  });
  app.use("*", createLoggerMiddleware(loggerFactory));
  app.use("*", secureHeaders());
  app.use("/billing/*", csrfProtection);
  app.use("/images/*", csrfProtection);
  app.use("/import/*", csrfProtection);
  app.use("/shortcut-credentials", csrfProtection);
  app.use("/shortcut-credentials/*", csrfProtection);
  app.use("/recipes", csrfProtection);
  app.use("/recipes/*", csrfProtection);
  app.use("/push-subscriptions", csrfProtection);
  app.use("/tags", csrfProtection);
  app.use("/tags/*", csrfProtection);

  // 外形監視の宛先。Workerが応答できることだけを示し、DBなど依存先には触れない。
  // bindingの検証はfetchの入口で先に走るので、設定の誤りはここでも500として見える。
  app.get("/health", (c) => c.json({ status: "ok" }, 200, { "Cache-Control": "no-store" }));

  return app
    .route("/auth", createAuthRoutes({ auth }))
    .route(
      "/images",
      createImageRoutes({
        auth,
        imageService: dependencies.imageService,
        createImageId: dependencies.createImageId,
      }),
    )
    .route(
      "/import",
      createImportRoutes({
        auth,
        urlImportJobSubmissionFor,
        textImportJobSubmissionFor,
        importJobRepositoryFor,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/shortcut",
      createIosShareRoutes({
        shortcutCredentialsFor,
        urlImportJobSubmissionFor,
        shortcutClientRateLimiterFor,
        shortcutRateLimiterFor,
      }),
    )
    .route(
      "/shortcut-credentials",
      createShortcutCredentialRoutes({
        auth,
        shortcutCredentialsFor,
      }),
    )
    .route(
      "/push-subscriptions",
      createPushSubscriptionRoutes({
        auth,
        pushSubscriptionRepositoryFor,
        createId: dependencies.createPushSubscriptionId,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/me",
      createMeRoutes({
        auth,
        meRepositoryFor,
        getCurrentMonth: dependencies.getCurrentMonth,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/usage",
      createUsageRoutes({
        auth,
        usageRepositoryFor,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/billing",
      createBillingRoutes({
        auth,
        billingRepositoryFor,
        stripeBillingClient: dependencies.stripeBillingClient,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/stripe",
      createStripeRoutes({
        billingRepositoryFor,
        stripeBillingClient: dependencies.stripeBillingClient,
      }),
    )
    .route(
      "/recipes",
      createRecipeRoutes({
        auth,
        recipeRepositoryFor,
        tagRepositoryFor,
        imageService: dependencies.imageService,
        createRecipeId: dependencies.createRecipeId,
        createImageId: dependencies.createImageId,
      }),
    )
    .route(
      "/tags",
      createTagRoutes({
        auth,
        tagRepositoryFor,
      }),
    );
};

const app = createApp();

export type AppType = ReturnType<typeof createApp>;

/**
 * cronは`wrangler.jsonc`の`triggers.crons`の1本だけで、Import Queueの滞留を見る。
 */
const handleScheduled = (controller: ScheduledController, env: Bindings) =>
  checkImportQueueHealth({
    jobTimeoutMs: resolveImportJobTimeoutMs(env),
    logger: createLogger(),
    now: () => new Date(),
    queue: env.IMPORT_QUEUE,
    reportCheckIn: createSentryCheckInReporter({
      monitorSlug: IMPORT_QUEUE_HEALTH_MONITOR_SLUG,
      cron: controller.cron,
    }),
  });

/**
 * bindingの検証はここだけで行う。route・queue・cronの各処理は、検証済みの前提で
 * 形式を再確認しない。
 */
const validateBindings = createBindingValidationGuard();

/**
 * queueの処理は、最後の配信やDLQでJobを失敗にできなかった例外をhandlerの外へ投げる。
 * 外へ出た例外のメッセージはWorkers Logsにも残るので、ログやSentryと同じく失敗したqueryの引数を除く。
 * 作り直すと例外の型とstackが変わってSentryのissueが分かれるので、同じ例外を書き換える。
 */
const throwWithoutQueryParams = (error: unknown): never => {
  if (error instanceof Error) {
    const message = withoutQueryParams(error.message);

    if (message !== error.message) {
      if (error.stack) {
        error.stack = error.stack.replace(error.message, message);
      }
      error.message = message;
    }
  }

  throw error;
};

const handler: ExportedHandler<Bindings, { jobId: string }> = {
  fetch: (request, env, ctx) => {
    validateBindings(env);
    return app.fetch(request, env, ctx);
  },
  queue: (batch, env) => {
    validateBindings(env);
    return handleImportQueueBatch(batch, env).catch(throwWithoutQueryParams);
  },
  scheduled: (controller, env) => {
    validateBindings(env);
    return handleScheduled(controller, env);
  },
};

/**
 * Sentryの初期化はfetch・queue・cronを1つにまとめて包む。送るかどうかの判断は
 * `onError`とqueueの処理が`ErrorReporter`で行い、ここからhandlerの外へ漏れた例外は
 * SDKがそのまま拾う。
 */
export default Sentry.withSentry(createSentryOptions, handler);
