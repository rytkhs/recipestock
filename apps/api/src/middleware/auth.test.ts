import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type AuthService } from "../auth";
import { type ApiEnv } from "../context";
import { requireAuth } from "./auth";

const createAuth = (result: Awaited<ReturnType<AuthService["getSession"]>>): AuthService => ({
  getSession: async () => result,
  handleAuthRequest: async () => new Response(null, { status: 404 }),
});

const createApp = (auth: AuthService) =>
  new Hono<ApiEnv>().get("/", requireAuth(auth), (c) => c.json({ userId: c.get("userId") }));

describe("requireAuth", () => {
  it("sessionの照会で書かれたSet-Cookieをhandlerの応答に付けて返す", async () => {
    const app = createApp(
      createAuth({
        session: { user: { id: "user_123", email: "user@example.com" } },
        setCookies: ["session_data=refreshed; Path=/", "session_token=renewed; Path=/"],
      }),
    );

    const response = await app.request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ userId: "user_123" });
    expect(response.headers.getSetCookie()).toEqual([
      "session_data=refreshed; Path=/",
      "session_token=renewed; Path=/",
    ]);
  });

  it("sessionが無いときも401にSet-Cookieを付けて失効したcookieを消させる", async () => {
    const app = createApp(
      createAuth({ session: null, setCookies: ["session_token=; Max-Age=0; Path=/"] }),
    );

    const response = await app.request("/");

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual(["session_token=; Max-Age=0; Path=/"]);
  });
});
