import { describe, expect, it, vi } from "vitest";
import { type PushSubscriptionRepository } from "../push-subscriptions";
import { createSilentTestApp, createTestAuth, sameOriginHeaders } from "../test-helpers";

const env = {
  APP_ENV: "development",
  APP_ORIGIN: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
  VAPID_PUBLIC_KEY: "BNc-public-key",
};

const auth = createTestAuth({ id: "user_1", email: "chef@example.com" });

const jsonHeaders = { "content-type": "application/json", ...sameOriginHeaders };

const subscription = {
  endpoint: "https://push.example.com/subscription/device-1",
  expirationTime: null,
  keys: {
    p256dh: "p256dh-key",
    auth: "auth-key",
  },
};

const createRepository = (
  overrides: Partial<PushSubscriptionRepository> = {},
): PushSubscriptionRepository => ({
  listByUser: async () => [],
  listDeliveryTargets: async () => [],
  register: async ({ endpoint, expirationTime }) => ({
    endpoint,
    expirationTime: expirationTime === null ? null : new Date(expirationTime).toISOString(),
  }),
  revoke: async () => true,
  ...overrides,
});

describe("Push subscription routes", () => {
  it("認証ユーザーがVAPID公開鍵と自分のsubscriptionを参照できる", async () => {
    const app = createSilentTestApp({
      auth,
      pushSubscriptionRepository: createRepository({
        listByUser: async () => [
          {
            endpoint: subscription.endpoint,
            expirationTime: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
    });

    const response = await app.request("/api/push-subscriptions", {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applicationServerKey: "BNc-public-key",
      subscriptions: [
        {
          endpoint: subscription.endpoint,
          expirationTime: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("登録内容を認証ユーザーと現在時刻に結び付けて保存する", async () => {
    const register = vi.fn<PushSubscriptionRepository["register"]>(async () => ({
      endpoint: subscription.endpoint,
      expirationTime: null,
    }));
    const now = new Date("2026-07-13T00:00:00.000Z");
    const app = createSilentTestApp({
      auth,
      pushSubscriptionRepository: createRepository({ register }),
      createPushSubscriptionId: () => "push_1",
      getCurrentDate: () => now,
    });
    const response = await app.request(
      "/api/push-subscriptions",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ ...subscription, userId: "attacker" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(register).toHaveBeenCalledWith({
      id: "push_1",
      userId: "user_1",
      endpoint: subscription.endpoint,
      expirationTime: null,
      p256dh: "p256dh-key",
      auth: "auth-key",
      now,
    });
    await expect(response.json()).resolves.toMatchObject({
      subscription: { endpoint: subscription.endpoint, expirationTime: null },
    });
  });

  it("指定endpointの解除を認証ユーザーの範囲で実行する", async () => {
    const revoke = vi.fn<PushSubscriptionRepository["revoke"]>(async () => true);
    const app = createSilentTestApp({
      auth,
      pushSubscriptionRepository: createRepository({ revoke }),
    });
    const response = await app.request(
      "/api/push-subscriptions",
      {
        method: "DELETE",
        headers: jsonHeaders,
        body: JSON.stringify({ endpoint: subscription.endpoint, userId: "attacker" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith({ userId: "user_1", endpoint: subscription.endpoint });
    await expect(response.json()).resolves.toEqual({ revoked: true });
  });

  it("Shortcut Bearer tokenではsubscriptionを登録、参照、解除できない", async () => {
    const app = createSilentTestApp({
      auth: createTestAuth(null),
      pushSubscriptionRepository: createRepository(),
    });

    const requests = [
      app.request(
        "/api/push-subscriptions",
        { headers: { authorization: "Bearer rssc_shortcut-token" } },
        env,
      ),
      app.request(
        "/api/push-subscriptions",
        {
          method: "POST",
          headers: {
            ...jsonHeaders,
            authorization: "Bearer rssc_shortcut-token",
          },
          body: JSON.stringify(subscription),
        },
        env,
      ),
      app.request(
        "/api/push-subscriptions",
        {
          method: "DELETE",
          headers: {
            ...jsonHeaders,
            authorization: "Bearer rssc_shortcut-token",
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        },
        env,
      ),
    ];

    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  });

  it("別ユーザーが所有するendpointを自分へ登録し直せない", async () => {
    const app = createSilentTestApp({
      auth,
      pushSubscriptionRepository: createRepository({ register: async () => null }),
    });

    const response = await app.request(
      "/api/push-subscriptions",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(subscription),
      },
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("cross-site mutationと不正なsubscriptionを拒否する", async () => {
    const app = createSilentTestApp({ auth, pushSubscriptionRepository: createRepository() });

    const crossSite = await app.request(
      "/api/push-subscriptions",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example.com",
          "sec-fetch-site": "cross-site",
        },
        body: "endpoint=https%3A%2F%2Fpush.example.com%2Fsubscription%2Fdevice-1",
      },
      env,
    );
    const malformed = await app.request(
      "/api/push-subscriptions",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ ...subscription, endpoint: "not-a-url" }),
      },
      env,
    );

    expect(crossSite.status).toBe(403);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
  });
});
