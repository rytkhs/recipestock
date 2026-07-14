import { describe, expect, it } from "vitest";
import { type PushSubscriptionRepository } from "../push-subscriptions";
import { createSilentTestApp } from "../test-helpers";

const env = {
  APP_ENV: "development",
  BETTER_AUTH_URL: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
  VAPID_PUBLIC_KEY: "BNc-public-key",
};

const auth = {
  getSession: async () => ({ user: { id: "user_1", email: "chef@example.com" } }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const sameOriginHeaders = {
  "content-type": "application/json",
  origin: "https://app.example.com",
  "sec-fetch-site": "same-origin",
};

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

const createStatefulRepository = (): PushSubscriptionRepository => {
  const subscriptions = new Map<
    string,
    { userId: string; endpoint: string; expirationTime: string | null }
  >();

  return {
    async listByUser(userId) {
      return [...subscriptions.values()]
        .filter((item) => item.userId === userId)
        .map(({ endpoint, expirationTime }) => ({ endpoint, expirationTime }));
    },
    async listDeliveryTargets() {
      return [];
    },
    async register(input) {
      const existing = subscriptions.get(input.endpoint);
      if (existing && existing.userId !== input.userId) return null;

      const saved = {
        userId: input.userId,
        endpoint: input.endpoint,
        expirationTime:
          input.expirationTime === null ? null : new Date(input.expirationTime).toISOString(),
      };
      subscriptions.set(input.endpoint, saved);
      return { endpoint: saved.endpoint, expirationTime: saved.expirationTime };
    },
    async revoke({ userId, endpoint }) {
      const existing = subscriptions.get(endpoint);
      if (!existing || existing.userId !== userId) return false;
      return subscriptions.delete(endpoint);
    },
  };
};

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

  it("同じendpointの再登録をユーザー所有のsubscriptionとして更新する", async () => {
    const repository = createStatefulRepository();
    const app = createSilentTestApp({
      auth,
      pushSubscriptionRepository: repository,
      createPushSubscriptionId: () => "push_1",
      getCurrentDate: () => new Date("2026-07-13T00:00:00.000Z"),
    });

    const request = () =>
      app.request(
        "/api/push-subscriptions",
        {
          method: "POST",
          headers: sameOriginHeaders,
          body: JSON.stringify(subscription),
        },
        env,
      );

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);

    const listed = await app.request("/api/push-subscriptions", {}, env);
    await expect(listed.json()).resolves.toMatchObject({
      subscriptions: [{ endpoint: subscription.endpoint }],
    });
  });

  it("別端末のsubscriptionを残したまま指定endpointだけを解除する", async () => {
    const repository = createStatefulRepository();
    const app = createSilentTestApp({
      auth,
      pushSubscriptionRepository: repository,
    });
    const secondSubscription = {
      ...subscription,
      endpoint: "https://push.example.com/subscription/device-2",
    };

    for (const requestBody of [subscription, secondSubscription]) {
      const registered = await app.request(
        "/api/push-subscriptions",
        {
          method: "POST",
          headers: sameOriginHeaders,
          body: JSON.stringify(requestBody),
        },
        env,
      );
      expect(registered.status).toBe(200);
    }

    const response = await app.request(
      "/api/push-subscriptions",
      {
        method: "DELETE",
        headers: sameOriginHeaders,
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: true });

    const listed = await app.request("/api/push-subscriptions", {}, env);
    await expect(listed.json()).resolves.toMatchObject({
      subscriptions: [{ endpoint: secondSubscription.endpoint }],
    });
  });

  it("Shortcut Bearer tokenではsubscriptionを登録、参照、解除できない", async () => {
    const app = createSilentTestApp({
      auth: {
        ...auth,
        getSession: async () => null,
      },
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
            ...sameOriginHeaders,
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
            ...sameOriginHeaders,
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
        headers: sameOriginHeaders,
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
        headers: sameOriginHeaders,
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
