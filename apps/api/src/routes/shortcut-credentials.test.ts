import { describe, expect, it, vi } from "vitest";
import { type ShortcutCredentials } from "../shortcut-credentials";
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

const csrfHeaders = {
  "content-type": "application/json",
  origin: "https://app.example.com",
  "sec-fetch-site": "same-origin",
};

const createCredentials = (): ShortcutCredentials => ({
  issue: async ({ name }) => ({
    credential: {
      id: "credential_1",
      name,
      tokenSuffix: "aaaaaa",
      createdAt: "2026-07-11T00:00:00.000Z",
    },
    token: `rssc_${"a".repeat(64)}`,
  }),
  list: async () => [
    {
      id: "credential_1",
      name: "iPhone",
      tokenSuffix: "aaaaaa",
      createdAt: "2026-07-11T00:00:00.000Z",
    },
  ],
  revoke: async () => true,
  authenticate: async () => null,
});

describe("Shortcut credential routes", () => {
  it("credentialを発行し、平文tokenを一度返す", async () => {
    const issue = vi.fn(createCredentials().issue);
    const credentials = { ...createCredentials(), issue };
    const app = createSilentTestApp({ auth, shortcutCredentials: credentials });
    const response = await app.request(
      "/api/shortcut-credentials",
      {
        method: "POST",
        headers: csrfHeaders,
        body: JSON.stringify({ name: " iPhone " }),
      },
      env,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      credential: { id: "credential_1", name: "iPhone" },
      token: `rssc_${"a".repeat(64)}`,
    });
    expect(issue).toHaveBeenCalledWith({ userId: "user_1", name: "iPhone" });
  });

  it("active credentialを一覧する", async () => {
    const app = createSilentTestApp({ auth, shortcutCredentials: createCredentials() });
    const response = await app.request("/api/shortcut-credentials", {}, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      credentials: [{ id: "credential_1", name: "iPhone" }],
    });
  });

  it("所有するcredentialをrevokeする", async () => {
    const revoke = vi.fn(createCredentials().revoke);
    const credentials = { ...createCredentials(), revoke };
    const app = createSilentTestApp({ auth, shortcutCredentials: credentials });
    const response = await app.request(
      "/api/shortcut-credentials/credential_1",
      { method: "DELETE", headers: csrfHeaders },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: true });
    expect(revoke).toHaveBeenCalledWith({
      credentialId: "credential_1",
      userId: "user_1",
    });
  });

  it("存在しないcredentialのrevokeは404を返す", async () => {
    const credentials = createCredentials();
    credentials.revoke = async () => false;
    const app = createSilentTestApp({ auth, shortcutCredentials: credentials });
    const response = await app.request(
      "/api/shortcut-credentials/missing",
      { method: "DELETE", headers: csrfHeaders },
      env,
    );

    expect(response.status).toBe(404);
  });
});
