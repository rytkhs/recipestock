import { describe, expect, it, vi } from "vitest";
import { createPushSender, type SendWebPush } from "./completion-notifications";
import { createLogger, createMemoryLogSink } from "./logger";
import { type PushDeliveryTarget, type PushSubscriptionRepository } from "./push-subscriptions";

const targets: PushDeliveryTarget[] = [
  {
    endpoint: "https://push.example.com/device-1",
    p256dh: "p256dh-1",
    auth: "auth-1",
  },
  {
    endpoint: "https://push.example.com/device-2",
    p256dh: "p256dh-2",
    auth: "auth-2",
  },
];

const createRepository = (
  overrides: Partial<PushSubscriptionRepository> = {},
): PushSubscriptionRepository =>
  ({
    listDeliveryTargets: async () => targets,
    revoke: async () => true,
    ...overrides,
  }) as PushSubscriptionRepository;

const vapid = {
  subject: "https://github.com/rytkhs/recipestock",
  publicKey: "public-key",
  privateKey: "private-key",
};

describe("Push sender", () => {
  it("購読中の全端末へprivacy-safeな完了payloadを送信する", async () => {
    const sendNotification = vi.fn<SendWebPush>(async () => ({ statusCode: 201 }));
    const sender = createPushSender({
      repository: createRepository(),
      sendNotification,
      vapid,
    });

    await expect(
      sender.sendToUser({
        userId: "user_1",
        payload: { outcome: "succeeded", recipeId: "recipe_1" },
      }),
    ).resolves.toEqual({ acceptedCount: 2 });

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification.mock.calls.map(([subscription]) => subscription.endpoint)).toEqual([
      targets[0]?.endpoint,
      targets[1]?.endpoint,
    ]);
    for (const [, payload, options] of sendNotification.mock.calls) {
      expect(JSON.parse(payload)).toEqual({ outcome: "succeeded", recipeId: "recipe_1" });
      expect(payload).not.toMatch(/url|title|source|error/i);
      expect(options).toEqual({ contentEncoding: "aes128gcm", vapidDetails: vapid });
    }
  });

  it("失効応答だけを解除しtransient failureを残したままaccepted件数を返す", async () => {
    const deliveryTargets = [
      ...targets,
      { endpoint: "https://push.example.com/device-3", p256dh: "p256dh-3", auth: "auth-3" },
      { endpoint: "https://push.example.com/device-4", p256dh: "p256dh-4", auth: "auth-4" },
    ];
    const revoked: string[] = [];
    const sink = createMemoryLogSink();
    const sendNotification = vi.fn<SendWebPush>(async (subscription) => {
      if (subscription.endpoint.endsWith("device-1")) return { statusCode: 201 };
      if (subscription.endpoint.endsWith("device-2")) throw { statusCode: 404 };
      if (subscription.endpoint.endsWith("device-3")) throw { statusCode: 410 };
      throw new Error("push service unavailable");
    });
    const sender = createPushSender({
      repository: createRepository({
        listDeliveryTargets: async () => deliveryTargets,
        revoke: async ({ endpoint }) => {
          revoked.push(endpoint);
          return true;
        },
      }),
      sendNotification,
      vapid,
      logger: createLogger({}, { sink }),
    });

    await expect(
      sender.sendToUser({ userId: "user_1", payload: { outcome: "failed" } }),
    ).resolves.toEqual({ acceptedCount: 1 });

    expect(sendNotification).toHaveBeenCalledTimes(4);
    expect(revoked).toEqual([
      "https://push.example.com/device-2",
      "https://push.example.com/device-3",
    ]);
    expect(sink.entries).toHaveLength(3);
  });

  it("購読がなければ送信せずaccepted件数0を返す", async () => {
    const sendNotification = vi.fn<SendWebPush>();
    const sender = createPushSender({
      repository: createRepository({ listDeliveryTargets: async () => [] }),
      sendNotification,
      vapid,
    });

    await expect(
      sender.sendToUser({ userId: "user_1", payload: { outcome: "failed" } }),
    ).resolves.toEqual({ acceptedCount: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("失効subscriptionの削除失敗が他端末のaccepted結果を失わせない", async () => {
    const sink = createMemoryLogSink();
    const sendNotification = vi.fn<SendWebPush>(async (subscription) => {
      if (subscription.endpoint.endsWith("device-1")) return { statusCode: 201 };
      throw { statusCode: 410 };
    });
    const sender = createPushSender({
      repository: createRepository({
        revoke: async () => {
          throw new Error("database unavailable");
        },
      }),
      sendNotification,
      vapid,
      logger: createLogger({}, { sink }),
    });

    await expect(
      sender.sendToUser({ userId: "user_1", payload: { outcome: "failed" } }),
    ).resolves.toEqual({ acceptedCount: 1 });
    expect(sink.entries.map((entry) => entry.event)).toEqual([
      "push_subscription_retirement_failed",
      "import_completion_push_failed",
    ]);
  });
});
