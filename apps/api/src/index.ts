import { createDb } from "@recipestock/db";
import { Hono } from "hono";
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

export const createApp = (dependencies: AppDependencies = {}) => {
  const app = new Hono<ApiEnv>().basePath("/api");
  const auth = dependencies.auth ?? authService;

  app.onError(() => unknownResponse());

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
  console.error(
    JSON.stringify({
      event: "import_job_queue_error",
      messageId: message.id,
      jobId: message.body.jobId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );

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
  const importJobRepository = createImportJobRepository(db);
  const recipeRepository = createRecipeRepository(db);
  const usageRepository = createUsageRepository(db);
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
