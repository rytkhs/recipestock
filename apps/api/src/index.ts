import { env as workerEnv } from "cloudflare:workers";
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
import { type BillingRepository } from "./billing";
import {
  createPushSender,
  notifyImportJobCompletion,
  type PushSender,
} from "./completion-notifications";
import { type ApiEnv } from "./context";
import { type Bindings, createBindingValidationGuard } from "./env";
import { createRecipeImageService, type RecipeImageService } from "./images";
import {
  createImportJobRepository,
  type ImportJobRepository,
  processImportJob,
  resolveImportJobTimeoutMs,
} from "./import-jobs";
import { checkImportQueueHealth } from "./import-queue-health";
import { type RecipeImportAIProvider, type RecipeImportFetcher } from "./import-url";
import { createTextImportJobSubmission } from "./lib/import/text-import-job-submission";
import {
  createUrlImportJobSubmission,
  type UrlImportJobSubmission,
} from "./lib/import/url-import-job-submission";
import { createLogger, type Logger, type LoggerFactory } from "./logger";
import { type MeRepository } from "./me";
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
import { type TagRepository } from "./tags";
import { createUsageRepository, type UsageRepository } from "./usage";

const IMPORT_QUEUE_MAX_DELIVERY_ATTEMPTS = 4;
// `wrangler.jsonc`の`queues.consumers`と同じ名前。queue handlerはこの名前で振り分ける。
const IMPORT_DEAD_LETTER_QUEUE = "recipestock-import-jobs-dlq";
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
  importAIProvider?: RecipeImportAIProvider;
  importFetcher?: RecipeImportFetcher;
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
      importJobRepository: dependencies.importJobRepository,
      importQueue: dependencies.importQueue,
      createImportJobId: dependencies.createImportJobId,
      getCurrentDate: dependencies.getCurrentDate,
    });
  const textImportJobSubmissionFor = (env: Bindings) =>
    createTextImportJobSubmission({
      env,
      importJobRepository: dependencies.importJobRepository,
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
        importJobRepository: dependencies.importJobRepository,
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
        pushSubscriptionRepository: dependencies.pushSubscriptionRepository,
        createId: dependencies.createPushSubscriptionId,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/me",
      createMeRoutes({
        auth,
        meRepository: dependencies.meRepository,
        getCurrentMonth: dependencies.getCurrentMonth,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/usage",
      createUsageRoutes({
        auth,
        usageRepository: dependencies.usageRepository,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/billing",
      createBillingRoutes({
        auth,
        billingRepository: dependencies.billingRepository,
        stripeBillingClient: dependencies.stripeBillingClient,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/stripe",
      createStripeRoutes({
        billingRepository: dependencies.billingRepository,
        stripeBillingClient: dependencies.stripeBillingClient,
      }),
    )
    .route(
      "/recipes",
      createRecipeRoutes({
        auth,
        recipeRepository: dependencies.recipeRepository,
        tagRepository: dependencies.tagRepository,
        imageService: dependencies.imageService,
        createRecipeId: dependencies.createRecipeId,
        createImageId: dependencies.createImageId,
      }),
    )
    .route(
      "/tags",
      createTagRoutes({
        auth,
        tagRepository: dependencies.tagRepository,
      }),
    );
};

const app = createApp();

export type AppType = ReturnType<typeof createApp>;

type ImportQueueMessage = Pick<
  Message<{ jobId: string }>,
  "ack" | "attempts" | "body" | "id" | "retry"
>;

const notifyImportJobCompletionBestEffort = async ({
  importJobRepository,
  jobId,
  logger,
  now,
  pushSender,
}: {
  importJobRepository: ImportJobRepository;
  jobId: string;
  logger: ReturnType<typeof createLogger>;
  now: Date;
  pushSender: PushSender;
}) => {
  try {
    await notifyImportJobCompletion({
      importJobRepository,
      jobId,
      now,
      pushSender,
    });
  } catch (error) {
    logger.error("import_completion_notification_failed", { error });
  }
};

export const handleImportQueueMessageError = async ({
  error,
  errorReporter = sentryErrorReporter,
  importJobRepository,
  message,
  logger = createLogger({ jobId: message.body.jobId, messageId: message.id }),
  notifyCompletion,
  now = new Date(),
}: {
  error: unknown;
  errorReporter?: ErrorReporter;
  importJobRepository: ImportJobRepository;
  message: ImportQueueMessage;
  logger?: Logger;
  notifyCompletion?: () => Promise<void>;
  now?: Date;
}) => {
  logger.error("import_job_queue_error", {
    attempts: message.attempts,
    error,
  });

  if (message.attempts >= IMPORT_QUEUE_MAX_DELIVERY_ATTEMPTS) {
    // 再試行で直った失敗は利用者に見えないので送らない。Jobを失敗にする最後の配信だけを送る。
    errorReporter.report(error, {
      tags: { attempts: message.attempts, job_id: message.body.jobId },
    });
    await importJobRepository.markJobFailed({
      jobId: message.body.jobId,
      errorCode: "unknown",
      errorMessage: error instanceof Error ? error.message : "Unexpected import job error.",
      now,
    });
    await notifyCompletion?.();
    message.ack();
    return;
  }

  message.retry({ delaySeconds: Math.min(30 * 2 ** message.attempts, 600) });
};

export const handleImportQueueMessage = async ({
  errorReporter,
  importJobRepository,
  message,
  processJob,
  pushSender,
  now,
  logger = createLogger({ jobId: message.body.jobId, messageId: message.id }),
}: {
  errorReporter?: ErrorReporter;
  importJobRepository: ImportJobRepository;
  message: ImportQueueMessage;
  processJob: (jobId: string) => Promise<void>;
  pushSender: PushSender;
  now?: Date;
  logger?: Logger;
}) => {
  const notifyCompletion = () =>
    notifyImportJobCompletionBestEffort({
      importJobRepository,
      jobId: message.body.jobId,
      logger,
      now: now ?? new Date(),
      pushSender,
    });

  try {
    await processJob(message.body.jobId);
    await notifyCompletion();
    message.ack();
  } catch (error) {
    await handleImportQueueMessageError({
      error,
      errorReporter,
      importJobRepository,
      message,
      logger,
      notifyCompletion,
      now: now ?? new Date(),
    });
  }
};

export class ImportJobDeadLetteredError extends Error {
  constructor() {
    super("Import job message was moved to the dead letter queue.");
    this.name = "ImportJobDeadLetteredError";
  }
}

/**
 * 通常の失敗は最後の配信でJobを失敗にしてackするので、DLQには届かない。届くのはconsumer自体が
 * 落ちたとき（最後の配信でのDB障害、実行時間の上限など）で、Jobはqueued/runningのまま残っている。
 * ここで失敗に確定させて完了通知を出す。`markJobFailed`は進行中のJobしか書き換えないので、
 * 既に終わったJobの結果は変わらない。DBに書けなければthrowし、DLQ側の再試行に任せる。
 */
export const handleDeadLetteredImportJobMessage = async ({
  errorReporter = sentryErrorReporter,
  importJobRepository,
  message,
  logger = createLogger({ jobId: message.body.jobId, messageId: message.id }),
  notifyCompletion,
  now = new Date(),
}: {
  errorReporter?: ErrorReporter;
  importJobRepository: ImportJobRepository;
  message: ImportQueueMessage;
  logger?: Logger;
  notifyCompletion?: () => Promise<void>;
  now?: Date;
}) => {
  logger.error("import_job_dead_lettered", { attempts: message.attempts });
  errorReporter.report(new ImportJobDeadLetteredError(), {
    tags: { area: "import_dlq", job_id: message.body.jobId },
  });

  await importJobRepository.markJobFailed({
    jobId: message.body.jobId,
    errorCode: "unknown",
    errorMessage: "Import job could not be processed.",
    now,
  });
  await notifyCompletion?.();
  message.ack();
};

const createImportCompletionPushSender = ({
  env,
  logger,
  repository,
}: {
  env: Bindings;
  logger: Logger;
  repository: PushSubscriptionRepository;
}) =>
  createPushSender({
    repository,
    logger,
    vapid: {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
  });

const handleImportQueue = async (
  batch: MessageBatch<{ jobId: string }>,
  env: Bindings,
): Promise<void> => {
  const db = createDb(env.DATABASE_URL);
  const planSyncOptions = { proPriceId: env.STRIPE_PRO_PRICE_ID };
  const importJobRepository = createImportJobRepository(db, planSyncOptions);
  const recipeRepository = createRecipeRepository(db, planSyncOptions);
  const usageRepository = createUsageRepository(db, planSyncOptions);
  const imageService = createRecipeImageService(env);
  const pushSubscriptionRepository = createPushSubscriptionRepository(db);

  for (const message of batch.messages) {
    const logger = createLogger({
      jobId: message.body.jobId,
      messageId: message.id,
    });

    const pushSender = createImportCompletionPushSender({
      env,
      logger,
      repository: pushSubscriptionRepository,
    });
    await handleImportQueueMessage({
      importJobRepository,
      message,
      pushSender,
      logger,
      processJob: (jobId) =>
        processImportJob({
          jobId,
          env,
          importJobRepository,
          recipeRepository,
          usageRepository,
          imageService,
          logger,
        }),
    });
  }
};

const handleImportDeadLetterQueue = async (
  batch: MessageBatch<{ jobId: string }>,
  env: Bindings,
): Promise<void> => {
  const db = createDb(env.DATABASE_URL);
  const importJobRepository = createImportJobRepository(db, {
    proPriceId: env.STRIPE_PRO_PRICE_ID,
  });
  const pushSubscriptionRepository = createPushSubscriptionRepository(db);

  for (const message of batch.messages) {
    const logger = createLogger({
      jobId: message.body.jobId,
      messageId: message.id,
    });
    const pushSender = createImportCompletionPushSender({
      env,
      logger,
      repository: pushSubscriptionRepository,
    });
    const now = new Date();

    await handleDeadLetteredImportJobMessage({
      importJobRepository,
      message,
      logger,
      notifyCompletion: () =>
        notifyImportJobCompletionBestEffort({
          importJobRepository,
          jobId: message.body.jobId,
          logger,
          now,
          pushSender,
        }),
      now,
    });
  }
};

/**
 * cronは`wrangler.jsonc`の`triggers.crons`の1本だけで、Import Queueの滞留を見る。
 *
 * Queueはhandlerに渡るenvでなく`cloudflare:workers`のenvから取る。`withSentry`はenvのQueueを
 * Proxyで包み、本物に結び直すのは`send`と`sendBatch`だけなので、Proxy越しの`metrics()`は
 * Illegal invocationで落ちる（@sentry/cloudflare 10.75.1）。SDKが直ればhandlerのenvに戻す。
 */
const handleScheduled = (controller: ScheduledController, env: Bindings) =>
  checkImportQueueHealth({
    jobTimeoutMs: resolveImportJobTimeoutMs(env),
    logger: createLogger(),
    now: () => new Date(),
    // `cloudflare:workers`のenvはhandlerに渡るenvと同じものだが、型は空の`Env`なので`Bindings`として読む。
    queue: (workerEnv as Bindings).IMPORT_QUEUE,
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

/**
 * Sentryの初期化はfetch・queue・cronを1つにまとめて包む。送るかどうかの判断は
 * `onError`とqueueの処理が`ErrorReporter`で行い、ここからhandlerの外へ漏れた例外は
 * SDKがそのまま拾う。
 */
export default Sentry.withSentry<Bindings, { jobId: string }>(createSentryOptions, {
  fetch: (request, env, ctx) => {
    validateBindings(env);
    return app.fetch(request, env, ctx);
  },
  queue: (batch, env) => {
    validateBindings(env);
    return (
      batch.queue === IMPORT_DEAD_LETTER_QUEUE
        ? handleImportDeadLetterQueue(batch, env)
        : handleImportQueue(batch, env)
    ).catch(throwWithoutQueryParams);
  },
  scheduled: (controller, env) => {
    validateBindings(env);
    return handleScheduled(controller, env);
  },
} satisfies ExportedHandler<Bindings, { jobId: string }>);
