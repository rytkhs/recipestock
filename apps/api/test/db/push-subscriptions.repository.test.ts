import { neonConfig } from "@neondatabase/serverless";
import { createDb } from "@recipestock/db";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createPushSubscriptionRepository,
  type PushSubscriptionRepository,
  type RegisterPushSubscriptionInput,
} from "../../src/push-subscriptions";

const now = new Date("2026-07-13T00:00:00.000Z");
const input = (userId: string): RegisterPushSubscriptionInput => {
  const id = crypto.randomUUID();
  return {
    id,
    userId,
    endpoint: `https://push.example.com/${id}`,
    expirationTime: null,
    p256dh: "original-p256dh",
    auth: "original-auth",
    now,
  };
};

describe("Push subscription repository with Neon Postgres", () => {
  let repository: PushSubscriptionRepository;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for database integration tests.");
    const connectionUrl = new URL(databaseUrl);
    neonConfig.fetchEndpoint = `http://${connectionUrl.hostname}:${connectionUrl.port}/sql`;
    neonConfig.poolQueryViaFetch = true;
    neonConfig.useSecureWebSocket = false;
    repository = createPushSubscriptionRepository(createDb(databaseUrl));
  });

  it("同じendpointの再登録は行を増やさず暗号鍵と有効期限を更新する", async () => {
    const first = input(`dbtest_user_${crypto.randomUUID()}`);
    await repository.register(first);
    const expirationTime = new Date("2026-08-01T00:00:00.000Z").getTime();
    await repository.register({
      ...first,
      id: crypto.randomUUID(),
      expirationTime,
      p256dh: "updated-p256dh",
      auth: "updated-auth",
    });

    await expect(repository.listByUser(first.userId)).resolves.toEqual([
      { endpoint: first.endpoint, expirationTime: "2026-08-01T00:00:00.000Z" },
    ]);
    await expect(repository.listDeliveryTargets(first.userId)).resolves.toEqual([
      { endpoint: first.endpoint, p256dh: "updated-p256dh", auth: "updated-auth" },
    ]);
  });

  it("他人のendpointは参照・再登録・解除できず、自分の別端末も解除しない", async () => {
    const ownerId = `dbtest_owner_${crypto.randomUUID()}`;
    const otherId = `dbtest_other_${crypto.randomUUID()}`;
    const owned = input(ownerId);
    const secondDevice = input(ownerId);
    const other = input(otherId);
    await repository.register(owned);
    await repository.register(secondDevice);
    await repository.register(other);

    await expect(
      repository.register({ ...owned, id: crypto.randomUUID(), userId: otherId, auth: "attacker" }),
    ).resolves.toBeNull();
    await expect(repository.revoke({ userId: otherId, endpoint: owned.endpoint })).resolves.toBe(
      false,
    );
    await expect(repository.listByUser(otherId)).resolves.toEqual([
      { endpoint: other.endpoint, expirationTime: null },
    ]);
    await expect(repository.listDeliveryTargets(ownerId)).resolves.toEqual(
      expect.arrayContaining([
        { endpoint: owned.endpoint, p256dh: "original-p256dh", auth: "original-auth" },
        { endpoint: secondDevice.endpoint, p256dh: "original-p256dh", auth: "original-auth" },
      ]),
    );

    await expect(repository.revoke({ userId: ownerId, endpoint: owned.endpoint })).resolves.toBe(
      true,
    );
    await expect(repository.listByUser(ownerId)).resolves.toEqual([
      { endpoint: secondDevice.endpoint, expirationTime: null },
    ]);
    await expect(repository.listByUser(otherId)).resolves.toEqual([
      { endpoint: other.endpoint, expirationTime: null },
    ]);
  });
});
