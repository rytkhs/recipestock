import { describe, expect, it, vi } from "vitest";
import {
  consumeAiUsage,
  createUsageRepository,
  getCurrentJstMonth,
  getNextJstMonthResetAt,
  resolveAiMonthlyLimit,
} from "./usage";

describe("AI usage", () => {
  it("JSTカレンダー月と次回リセット時刻を計算する", () => {
    expect(getCurrentJstMonth(new Date("2026-05-31T14:59:59.000Z"))).toBe("2026-05");
    expect(getCurrentJstMonth(new Date("2026-05-31T15:00:00.000Z"))).toBe("2026-06");
    expect(getNextJstMonthResetAt(new Date("2026-05-31T14:59:59.000Z"))).toBe(
      "2026-05-31T15:00:00.000Z",
    );
    expect(getNextJstMonthResetAt(new Date("2026-12-15T00:00:00.000Z"))).toBe(
      "2026-12-31T15:00:00.000Z",
    );
  });

  it("Free/ProのAI月次上限を環境変数から解決する", () => {
    expect(resolveAiMonthlyLimit("free", { FREE_AI_MONTHLY_LIMIT: "0" })).toBe(0);
    expect(resolveAiMonthlyLimit("pro", { PRO_AI_MONTHLY_LIMIT: "123" })).toBe(123);
    expect(resolveAiMonthlyLimit("free", {})).toBe(10);
    expect(resolveAiMonthlyLimit("pro", {})).toBe(300);
  });

  it("上限未満の場合だけ現在月の利用回数を消費する", async () => {
    const consume = vi.fn(async () => ({
      status: "consumed" as const,
      usage: { month: "2026-05", used: 10 },
    }));

    await expect(
      consumeAiUsage({
        userId: "user_123",
        env: {
          PRO_AI_MONTHLY_LIMIT: "300",
        },
        repository: {
          getOrCreateAppUser: async (userId) => ({ userId, plan: "pro" }),
          getAiUsage: async () => null,
          consumeAiUsage: consume,
        },
        now: new Date("2026-05-15T00:00:00.000Z"),
        createUsageId: () => "usage_123",
      }),
    ).resolves.toEqual({
      status: "consumed",
      usage: { month: "2026-05", used: 10 },
    });

    expect(consume).toHaveBeenCalledWith({
      userId: "user_123",
      month: "2026-05",
      limit: 300,
      usageId: "usage_123",
    });
  });

  it("月次上限が0の場合は利用回数を消費しない", async () => {
    const consume = vi.fn(async () => ({
      status: "consumed" as const,
      usage: { month: "2026-05", used: 1 },
    }));

    await expect(
      consumeAiUsage({
        userId: "user_123",
        env: {
          FREE_AI_MONTHLY_LIMIT: "0",
        },
        repository: {
          getOrCreateAppUser: async (userId) => ({ userId, plan: "free" }),
          getAiUsage: async () => null,
          consumeAiUsage: consume,
        },
        now: new Date("2026-05-15T00:00:00.000Z"),
        createUsageId: () => "usage_123",
      }),
    ).resolves.toEqual({
      status: "limitExceeded",
    });

    expect(consume).not.toHaveBeenCalled();
  });

  it("同時実行想定で上限到達時の拒否結果を伝播する", async () => {
    let used = 9;

    const results = await Promise.all([
      consumeAiUsage({
        userId: "user_123",
        env: { FREE_AI_MONTHLY_LIMIT: "10" },
        repository: {
          getOrCreateAppUser: async (userId) => ({ userId, plan: "free" }),
          getAiUsage: async () => null,
          consumeAiUsage: async ({ month, limit }) => {
            if (used >= limit) {
              return { status: "limitExceeded" };
            }
            used += 1;
            return { status: "consumed", usage: { month, used } };
          },
        },
        now: new Date("2026-05-15T00:00:00.000Z"),
        createUsageId: () => "usage_1",
      }),
      consumeAiUsage({
        userId: "user_123",
        env: { FREE_AI_MONTHLY_LIMIT: "10" },
        repository: {
          getOrCreateAppUser: async (userId) => ({ userId, plan: "free" }),
          getAiUsage: async () => null,
          consumeAiUsage: async ({ month, limit }) => {
            if (used >= limit) {
              return { status: "limitExceeded" };
            }
            used += 1;
            return { status: "consumed", usage: { month, used } };
          },
        },
        now: new Date("2026-05-15T00:00:00.000Z"),
        createUsageId: () => "usage_2",
      }),
    ]);

    expect(results).toEqual([
      { status: "consumed", usage: { month: "2026-05", used: 10 } },
      { status: "limitExceeded" },
    ]);
  });

  it("原子的な消費SQLが行を返さなければ上限到達として扱う", async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const repository = createUsageRepository({ execute } as never);

    await expect(
      repository.consumeAiUsage({
        userId: "user_123",
        month: "2026-05",
        limit: 10,
        usageId: "usage_123",
      }),
    ).resolves.toEqual({ status: "limitExceeded" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
