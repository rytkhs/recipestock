import { createDb } from "@recipestock/db";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
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
import { type Bindings } from "./env";
import { createRecipeImageService, type RecipeImageService } from "./images";
import {
  createImportJobRepository,
  type ImportJobRepository,
  processImportJob,
} from "./import-jobs";
import { type RecipeImportAIProvider, type RecipeImportFetcher } from "./import-url";
import {
  createUrlImportJobSubmission,
  type UrlImportJobSubmission,
} from "./lib/import/url-import-job-submission";
import { createLogger, type LoggerFactory } from "./logger";
import { type MeRepository } from "./me";
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
import { createUsageRoutes } from "./routes/usage";
import {
  createShortcutCredentialRepository,
  createShortcutCredentials,
  type ShortcutCredentials,
} from "./shortcut-credentials";
import { type StripeBillingClient } from "./stripe-billing";
import { createUsageRepository, type UsageRepository } from "./usage";

export { YtDlpMetadataContainer } from "./ytdlp-metadata-container";

const IMPORT_QUEUE_MAX_DELIVERY_ATTEMPTS = 4;

export type AppDependencies = {
  auth?: AuthService;
  loggerFactory?: LoggerFactory;
  meRepository?: MeRepository;
  usageRepository?: UsageRepository;
  billingRepository?: BillingRepository;
  recipeRepository?: RecipeRepository;
  pushSubscriptionRepository?: PushSubscriptionRepository;
  importJobRepository?: ImportJobRepository;
  shortcutCredentials?: ShortcutCredentials;
  urlImportJobSubmission?: UrlImportJobSubmission;
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
  const shortcutRateLimiterFor = (env: Bindings) =>
    dependencies.shortcutRateLimiter ?? env.SHORTCUT_RATE_LIMITER;

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
        importJobRepository: dependencies.importJobRepository,
        getCurrentDate: dependencies.getCurrentDate,
      }),
    )
    .route(
      "/ios-share",
      createIosShareRoutes({
        shortcutCredentialsFor,
        urlImportJobSubmissionFor,
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
        imageService: dependencies.imageService,
        createRecipeId: dependencies.createRecipeId,
        createImageId: dependencies.createImageId,
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
  importJobRepository,
  message,
  notifyCompletion,
  now = new Date(),
}: {
  error: unknown;
  importJobRepository: ImportJobRepository;
  message: ImportQueueMessage;
  notifyCompletion?: () => Promise<void>;
  now?: Date;
}) => {
  createLogger().error("import_job_queue_error", {
    attempts: message.attempts,
    error,
    jobId: message.body.jobId,
    messageId: message.id,
  });

  if (message.attempts >= IMPORT_QUEUE_MAX_DELIVERY_ATTEMPTS) {
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
  importJobRepository,
  message,
  processJob,
  pushSender,
  now,
  logger = createLogger({ jobId: message.body.jobId, messageId: message.id }),
}: {
  importJobRepository: ImportJobRepository;
  message: ImportQueueMessage;
  processJob: (jobId: string) => Promise<void>;
  pushSender: PushSender;
  now?: Date;
  logger?: ReturnType<typeof createLogger>;
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
      importJobRepository,
      message,
      notifyCompletion,
      now: now ?? new Date(),
    });
  }
};

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

    const pushSender = createPushSender({
      repository: pushSubscriptionRepository,
      logger,
      vapid: {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
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

export default {
  fetch: app.fetch,
  queue: handleImportQueue,
} satisfies ExportedHandler<Bindings, { jobId: string }>;
