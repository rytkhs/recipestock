import { describe, expect, it } from "vitest";
import { createApp } from "../index";

describe("Usage routes", () => {
  it("現在月のAI利用状況を返す", async () => {
    const calls: string[] = [];
    const testApp = createApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      usageRepository: {
        getOrCreateAppUser: async (userId) => {
          calls.push(`ensure:${userId}`);
          return { userId, plan: "pro" };
        },
        getAiUsage: async (userId, month) => {
          calls.push(`usage:${userId}:${month}`);
          return { month, used: 42 };
        },
        consumeAiUsage: async () => {
          throw new Error("GET /api/usage/ai should not consume usage");
        },
      },
      getCurrentDate: () => new Date("2026-05-15T00:00:00.000Z"),
    });

    const response = await testApp.request("/api/usage/ai", undefined, {
      APP_ENV: "development",
      PRO_AI_MONTHLY_LIMIT: "123",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      month: "2026-05",
      used: 42,
      limit: 123,
      resetAt: "2026-05-31T15:00:00.000Z",
    });
    expect(calls).toEqual(["ensure:user_123", "usage:user_123:2026-05"]);
  });
});
