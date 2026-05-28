import { describe, expect, it } from "vitest";
import app, { createApp } from "./index";

describe("API app composition", () => {
  it("ヘルスチェックに応答する", async () => {
    const response = await app.request("/api/health", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      environment: "development",
    });
  });

  it("Auth APIは認証middlewareを通さずBetter Authへ委譲する", async () => {
    let getSessionCalls = 0;
    const testApp = createApp({
      auth: {
        getSession: async () => {
          getSessionCalls += 1;
          return null;
        },
        handleAuthRequest: async () =>
          Response.json(
            {
              ok: true,
            },
            { status: 202 },
          ),
      },
    });

    const response = await testApp.request(
      "/api/auth/sign-out",
      {
        method: "POST",
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(getSessionCalls).toBe(0);
  });
});
