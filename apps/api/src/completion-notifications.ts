import { type ImportCompletionPushPayload } from "@recipestock/shared";
import { buildImportCompletionPushPayload } from "./import-completion-notices";
import { type ImportJobRepository } from "./import-jobs";
import { type Logger } from "./logger";
import { type PushDeliveryTarget, type PushSubscriptionRepository } from "./push-subscriptions";

type WebPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type WebPushOptions = {
  contentEncoding: "aes128gcm";
  vapidDetails: {
    subject: string;
    publicKey: string;
    privateKey: string;
  };
};

export type SendWebPush = (
  subscription: WebPushSubscription,
  payload: string,
  options: WebPushOptions,
) => Promise<{ statusCode: number }>;

export type PushSender = {
  sendToUser(input: {
    userId: string;
    payload: ImportCompletionPushPayload;
  }): Promise<{ acceptedCount: number }>;
};

export const notifyImportJobCompletion = async ({
  jobId,
  importJobRepository,
  pushSender,
  now = new Date(),
}: {
  jobId: string;
  importJobRepository: ImportJobRepository;
  pushSender: PushSender;
  now?: Date;
}) => {
  const job = await importJobRepository.getJobById(jobId);
  if (
    !job ||
    (job.status !== "succeeded" && job.status !== "failed") ||
    !job.completionNotificationRequested ||
    job.completionNotificationSentAt
  ) {
    return false;
  }

  if (job.status === "succeeded" && !job.recipeId) return false;

  const payload = buildImportCompletionPushPayload(
    job.status === "succeeded"
      ? { outcome: "succeeded", recipeId: job.recipeId as string }
      : { outcome: "failed" },
  );
  const { acceptedCount } = await pushSender.sendToUser({ userId: job.userId, payload });
  if (acceptedCount === 0) return false;

  return importJobRepository.markCompletionNotificationSent({ jobId, now });
};

const toWebPushSubscription = (target: PushDeliveryTarget): WebPushSubscription => ({
  endpoint: target.endpoint,
  keys: {
    p256dh: target.p256dh,
    auth: target.auth,
  },
});

const getStatusCode = (error: unknown) => {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === "number" ? statusCode : null;
};

// 送るのはQueueの完了通知だけなので、web-pushは依存（bn.js、asn1.jsなど）ごと、isolateの起動時ではなく
// 最初の送信のときに評価する。CommonJSでbundle上は元から遅延初期化されるので、ほかのmoduleは巻き込まない（ADR 0015）。
const sendWebPush: SendWebPush = async (subscription, payload, options) => {
  const webPush = await import("web-push");
  return (webPush.sendNotification as SendWebPush)(subscription, payload, options);
};

export const createPushSender = ({
  repository,
  vapid,
  logger,
  sendNotification = sendWebPush,
}: {
  repository: PushSubscriptionRepository;
  vapid: WebPushOptions["vapidDetails"];
  logger?: Logger;
  sendNotification?: SendWebPush;
}): PushSender => ({
  async sendToUser({ userId, payload }) {
    const targets = await repository.listDeliveryTargets(userId);
    const serializedPayload = JSON.stringify(payload);
    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          await sendNotification(toWebPushSubscription(target), serializedPayload, {
            contentEncoding: "aes128gcm",
            vapidDetails: vapid,
          });
          return true;
        } catch (error) {
          const statusCode = getStatusCode(error);
          if (statusCode === 404 || statusCode === 410) {
            try {
              await repository.revoke({ userId, endpoint: target.endpoint });
            } catch (retirementError) {
              logger?.error("push_subscription_retirement_failed", {
                endpoint: target.endpoint,
                error: retirementError,
                userId,
              });
            }
          }
          logger?.warn("import_completion_push_failed", {
            endpoint: target.endpoint,
            error,
            statusCode,
            userId,
          });
          return false;
        }
      }),
    );

    return { acceptedCount: results.filter(Boolean).length };
  },
});
