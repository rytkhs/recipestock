import { createDb } from "@recipestock/db";
import { type Bindings } from "../env";
import { createRecipeImageService } from "../images";
import { createLogger, type Logger } from "../logger";
import { type ErrorReporter, sentryErrorReporter } from "../monitoring";
import {
  createPushSubscriptionRepository,
  type PushSubscriptionRepository,
} from "../push-subscriptions";
import { createRecipeRepository } from "../recipes";
import { createUsageRepository } from "../usage";
import {
  createPushSender,
  notifyImportJobCompletion,
  type PushSender,
} from "./completion-notifications";
import { processImportJob } from "./job-processor";
import { createImportJobRepository, type ImportJobRepository } from "./jobs";

const IMPORT_QUEUE_MAX_DELIVERY_ATTEMPTS = 4;
// `wrangler.jsonc`の`queues.consumers`と同じ名前。queue handlerはこの名前で振り分ける。
const IMPORT_DEAD_LETTER_QUEUE = "recipestock-import-jobs-dlq";

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

export const handleImportQueueBatch = (batch: MessageBatch<{ jobId: string }>, env: Bindings) =>
  batch.queue === IMPORT_DEAD_LETTER_QUEUE
    ? handleImportDeadLetterQueue(batch, env)
    : handleImportQueue(batch, env);
