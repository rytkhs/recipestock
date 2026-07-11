import { describe, expect, it } from "vitest";
import { type IosShareService } from "../ios-share";
import { createSilentTestApp } from "../test-helpers";

const env = {
  APP_ENV: "development",
  BETTER_AUTH_URL: "https://app.example.com",
  DATABASE_URL: "postgresql://example",
};

const auth = {
  getSession: async () => ({ user: { id: "user_1", email: "chef@example.com" } }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
};

const createService = (): IosShareService => ({
  provisionChannel: async ({ id, name, token, now }) => ({
    channel: {
      id,
      name,
      tokenSuffix: token.slice(-6),
      createdAt: now.toISOString(),
      lastUsedAt: null,
    },
    token,
  }),
  listChannels: async () => [],
  revokeChannel: async () => true,
  submitHandoff: async ({ id, token, url, origin, now }) =>
    token.startsWith("rssc_")
      ? {
          handoffId: id,
          status: "pending",
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
          fallbackUrl: `${origin}/import/url?url=${encodeURIComponent(url)}`,
        }
      : null,
  findPendingHandoff: async () => ({
    id: "handoff_1",
    url: "https://example.com/recipe",
    createdAt: "2026-07-11T00:00:00.000Z",
  }),
  deliverHandoff: async () => "delivered_to_pwa",
  inspectHandoff: async ({ token }) => (token.startsWith("rssc_") ? "delivered_to_pwa" : null),
});

describe("iOS Share routes", () => {
  it("Shortcut bearer tokenでhandoffを作成する", async () => {
    const app = createSilentTestApp({ auth, iosShareService: createService() });
    const response = await app.request(
      "/api/ios-share/shortcut/handoffs",
      {
        method: "POST",
        headers: {
          authorization: `Bearer rssc_${"a".repeat(64)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "https://example.com/recipe" }),
      },
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ status: "pending" });
  });

  it("Shortcut endpointはCookie sessionだけでは認証しない", async () => {
    const app = createSilentTestApp({ auth, iosShareService: createService() });
    const response = await app.request(
      "/api/ios-share/shortcut/handoffs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/recipe" }),
      },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("認証ユーザーへpending handoffを返してPWA deliveryを受け付ける", async () => {
    const app = createSilentTestApp({ auth, iosShareService: createService() });
    const pending = await app.request("/api/ios-share/handoffs/pending", {}, env);
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toMatchObject({
      handoff: { id: "handoff_1", url: "https://example.com/recipe" },
    });

    const delivered = await app.request(
      "/api/ios-share/handoffs/handoff_1/delivery",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://app.example.com",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ target: "pwa" }),
      },
      env,
    );
    expect(delivered.status).toBe(200);
    await expect(delivered.json()).resolves.toEqual({ status: "delivered_to_pwa" });
  });
});
