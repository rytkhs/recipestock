import { createDb } from "@recipestock/db";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { unknownResponse } from "./api-error";
import { type AuthService, authService } from "./auth";
import { type BillingRepository } from "./billing";
import { type ApiEnv } from "./context";
import { type Bindings } from "./env";
import { createRecipeImageService, type RecipeImageService } from "./images";
import {
  createImportJobRepository,
  type ImportJobRepository,
  processImportJob,
} from "./import-jobs";
import { type RecipeImportAIProvider, type RecipeImportFetcher } from "./import-url";
import { createLogger } from "./logger";
import { type MeRepository } from "./me";
import { createRecipeRepository, type RecipeRepository } from "./recipes";
import { createAuthRoutes } from "./routes/auth";
import { createBillingRoutes } from "./routes/billing";
import { createImageRoutes } from "./routes/images";
import { createImportRoutes } from "./routes/import";
import { createMeRoutes } from "./routes/me";
import { createRecipeRoutes } from "./routes/recipes";
import { createStripeRoutes } from "./routes/stripe";
import { createUsageRoutes } from "./routes/usage";
import { type StripeBillingClient } from "./stripe-billing";
import { createUsageRepository, type UsageRepository } from "./usage";

const IMPORT_QUEUE_MAX_DELIVERY_ATTEMPTS = 4;

type AppDependencies = {
  auth?: AuthService;
  meRepository?: MeRepository;
  usageRepository?: UsageRepository;
  billingRepository?: BillingRepository;
  recipeRepository?: RecipeRepository;
  importJobRepository?: ImportJobRepository;
  importQueue?: Queue<{ jobId: string }>;
  imageService?: RecipeImageService;
  importAIProvider?: RecipeImportAIProvider;
  importFetcher?: RecipeImportFetcher;
  stripeBillingClient?: StripeBillingClient;
  createImportJobId?: () => string;
  createRecipeId?: () => string;
  createImageId?: () => string;
  getCurrentMonth?: () => string;
  getCurrentDate?: () => Date;
};

const createLoggerMiddleware = () =>
  createMiddleware<ApiEnv>(async (c, next) => {
    const requestId = crypto.randomUUID();
    const logger = createLogger({
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
  const csrfProtection = csrf();

  app.onError((error, c) => {
    const response = error instanceof HTTPException ? error.getResponse() : unknownResponse();
    const logger =
      c.var.logger ??
      createLogger({
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
  app.use("*", createLoggerMiddleware());
  app.use("*", secureHeaders());
  app.use("/billing/*", csrfProtection);
  app.use("/images/*", csrfProtection);
  app.use("/import/*", csrfProtection);
  app.use("/recipes", csrfProtection);
  app.use("/recipes/*", csrfProtection);

  return app
    .route("/auth", createAuthRoutes({ auth }))
    .route(
      "/images",
      createImageRoutes({
        auth,
        recipeRepository: dependencies.recipeRepository,
        imageService: dependencies.imageService,
        createImageId: dependencies.createImageId,
      }),
    )
    .route(
      "/import",
      createImportRoutes({
        auth,
        importJobRepository: dependencies.importJobRepository,
        importQueue: dependencies.importQueue,
        createImportJobId: dependencies.createImportJobId,
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

export const handleImportQueueMessageError = async ({
  error,
  importJobRepository,
  message,
  now = new Date(),
}: {
  error: unknown;
  importJobRepository: ImportJobRepository;
  message: ImportQueueMessage;
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
    message.ack();
    return;
  }

  message.retry({ delaySeconds: Math.min(30 * 2 ** message.attempts, 600) });
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

  for (const message of batch.messages) {
    try {
      await processImportJob({
        jobId: message.body.jobId,
        env,
        importJobRepository,
        recipeRepository,
        usageRepository,
        imageService,
      });
      message.ack();
    } catch (error) {
      await handleImportQueueMessageError({
        error,
        importJobRepository,
        message,
      });
    }
  }
};

export default {
  fetch: app.fetch,
  queue: handleImportQueue,
} satisfies ExportedHandler<Bindings, { jobId: string }>;
