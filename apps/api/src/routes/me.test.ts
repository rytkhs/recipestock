import { describe, expect, it } from "vitest";
import { createSilentTestApp } from "../test-helpers";

describe("Me routes", () => {
  it("現在ユーザー取得で未ログイン時に統一形式のunauthorizedを返す", async () => {
    const testApp = createSilentTestApp({
      auth: {
        getSession: async () => null,
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      meRepository: {
        getAppUserPlan: async () => {
          throw new Error("should not read plans without a session");
        },
        countRecipes: async () => 0,
        getAiUsage: async () => null,
      },
    });

    const response = await testApp.request("/api/me", undefined, {
      APP_ENV: "development",
      FREE_AI_MONTHLY_LIMIT: "17",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication is required.",
      },
    });
  });

  it("現在ユーザーの基礎情報を返しアプリユーザーを作成または再利用する", async () => {
    const calls: string[] = [];
    const testApp = createSilentTestApp({
      auth: {
        getSession: async () => ({
          user: { id: "user_123", email: "user@example.com" },
        }),
        handleAuthRequest: async () => new Response(null, { status: 404 }),
      },
      meRepository: {
        getAppUserPlan: async (userId) => {
          calls.push(`plan:${userId}`);
          return "free";
        },
        countRecipes: async (userId) => {
          calls.push(`recipes:${userId}`);
          return 5;
        },
        getAiUsage: async (userId, month) => {
          calls.push(`ai:${userId}:${month}`);
          return { month, used: 3 };
        },
      },
      getCurrentMonth: () => "2026-05",
    });

    const response = await testApp.request("/api/me", undefined, {
      APP_ENV: "development",
      FREE_AI_MONTHLY_LIMIT: "17",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: "user_123",
      email: "user@example.com",
      plan: "free",
      recipeCount: 5,
      recipeLimit: 5,
      isRecipeLimitReached: true,
      aiUsage: {
        month: "2026-05",
        used: 3,
        limit: 17,
        resetAt: "2026-05-31T15:00:00.000Z",
      },
    });
    expect(calls).toEqual(["plan:user_123", "recipes:user_123", "ai:user_123:2026-05"]);
  });
});
