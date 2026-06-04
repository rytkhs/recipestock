import { describe, expect, it, vi } from "vitest";
import {
  derivePlanFromSubscriptions,
  isProSubscription,
  type SubscriptionPlanInput,
  selectBillingSubscriptionSummary,
  shouldApplyStripeEvent,
  syncAppUserPlanFromSubscriptions,
} from "./billing";

const proPriceId = "price_pro";
const now = new Date("2026-06-04T00:00:00.000Z");

const subscription = (overrides: Partial<SubscriptionPlanInput> = {}): SubscriptionPlanInput => ({
  stripePriceId: proPriceId,
  status: "active",
  currentPeriodEnd: null,
  ...overrides,
});

describe("isProSubscription", () => {
  it.each(["active", "trialing"])("%sはPro扱いにする", (status) => {
    expect(isProSubscription(subscription({ status }), { proPriceId, now })).toBe(true);
  });

  it("past_dueはcurrentPeriodEnd以内ならPro扱いにする", () => {
    expect(
      isProSubscription(
        subscription({
          status: "past_due",
          currentPeriodEnd: "2026-06-04T00:00:00.000Z",
        }),
        { proPriceId, now },
      ),
    ).toBe(true);
  });

  it("past_dueはcurrentPeriodEndを超過したらFree扱いにする", () => {
    expect(
      isProSubscription(
        subscription({
          status: "past_due",
          currentPeriodEnd: "2026-06-03T23:59:59.999Z",
        }),
        { proPriceId, now },
      ),
    ).toBe(false);
  });

  it.each([
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
  ])("%sはFree扱いにする", (status) => {
    expect(isProSubscription(subscription({ status }), { proPriceId, now })).toBe(false);
  });

  it("Stripe Price IDが一致しなければstatusに関係なくFree扱いにする", () => {
    expect(
      isProSubscription(subscription({ stripePriceId: "price_other" }), { proPriceId, now }),
    ).toBe(false);
  });
});

describe("derivePlanFromSubscriptions", () => {
  it("Pro相当のsubscriptionが1件でもあればproを返す", () => {
    expect(
      derivePlanFromSubscriptions(
        [subscription({ status: "canceled" }), subscription({ status: "active" })],
        { proPriceId, now },
      ),
    ).toBe("pro");
  });

  it("Pro相当のsubscriptionがなければfreeを返す", () => {
    expect(
      derivePlanFromSubscriptions(
        [
          subscription({ status: "canceled" }),
          subscription({ stripePriceId: "price_other", status: "active" }),
        ],
        { proPriceId, now },
      ),
    ).toBe("free");
  });
});

describe("selectBillingSubscriptionSummary", () => {
  type SummarySubscription = {
    stripePriceId: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAt: Date | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodStart: Date | null;
    updatedAt: Date;
  };

  const summarySubscription = (
    overrides: Partial<SummarySubscription> = {},
  ): SummarySubscription => ({
    stripePriceId: proPriceId,
    status: "active",
    currentPeriodStart: new Date("2026-06-04T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-07-04T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    updatedAt: new Date("2026-06-04T00:00:00.000Z"),
    ...overrides,
  });

  it("Pro判定に使われるsubscriptionを優先して返す", () => {
    expect(
      selectBillingSubscriptionSummary(
        [
          summarySubscription({
            status: "canceled",
            currentPeriodStart: new Date("2026-07-04T00:00:00.000Z"),
          }),
          summarySubscription({
            status: "active",
            cancelAtPeriodEnd: true,
          }),
        ],
        { proPriceId, now },
      ),
    ).toEqual({
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date("2026-07-04T00:00:00.000Z"),
      cancelAt: null,
    });
  });

  it("Pro対象Price IDのsubscriptionがなければnullを返す", () => {
    expect(
      selectBillingSubscriptionSummary(
        [summarySubscription({ stripePriceId: "price_other", status: "active" })],
        { proPriceId, now },
      ),
    ).toBeNull();
  });
});

describe("shouldApplyStripeEvent", () => {
  it("最後に反映したeventより古いeventは反映しない", () => {
    expect(
      shouldApplyStripeEvent({
        latestEventCreatedAt: "2026-06-04T00:00:00.000Z",
        eventCreatedAt: "2026-06-03T23:59:59.999Z",
      }),
    ).toBe(false);
  });

  it("同時刻以降のeventは反映する", () => {
    expect(
      shouldApplyStripeEvent({
        latestEventCreatedAt: "2026-06-04T00:00:00.000Z",
        eventCreatedAt: "2026-06-04T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("syncAppUserPlanFromSubscriptions", () => {
  it("app userを作成保証し、導出したplanを保存して返す", async () => {
    const ensureAppUser = vi.fn<(userId: string) => Promise<void>>(async () => {});
    const getAppUserPlan = vi.fn<(userId: string) => Promise<"free" | "pro">>(async () => "free");
    const listSubscriptionsByUserId = vi.fn<(userId: string) => Promise<SubscriptionPlanInput[]>>(
      async () => [subscription({ status: "trialing" })],
    );
    const updateAppUserPlan = vi.fn<(userId: string, plan: "free" | "pro") => Promise<void>>(
      async () => {},
    );

    await expect(
      syncAppUserPlanFromSubscriptions({
        userId: "user_123",
        proPriceId,
        now,
        repository: {
          ensureAppUser,
          getAppUserPlan,
          listSubscriptionsByUserId,
          updateAppUserPlan,
        },
      }),
    ).resolves.toBe("pro");

    expect(ensureAppUser).toHaveBeenCalledWith("user_123");
    expect(getAppUserPlan).toHaveBeenCalledWith("user_123");
    expect(listSubscriptionsByUserId).toHaveBeenCalledWith("user_123");
    expect(updateAppUserPlan).toHaveBeenCalledWith("user_123", "pro");
  });

  it("保存済みplanと導出planが同じ場合は更新しない", async () => {
    const updateAppUserPlan = vi.fn<(userId: string, plan: "free" | "pro") => Promise<void>>(
      async () => {},
    );

    await expect(
      syncAppUserPlanFromSubscriptions({
        userId: "user_123",
        proPriceId,
        now,
        repository: {
          ensureAppUser: async () => {},
          getAppUserPlan: async () => "pro",
          listSubscriptionsByUserId: async () => [subscription({ status: "active" })],
          updateAppUserPlan,
        },
      }),
    ).resolves.toBe("pro");

    expect(updateAppUserPlan).not.toHaveBeenCalled();
  });

  it("期限切れpast_dueで保存済みproならfreeへ同期する", async () => {
    const updateAppUserPlan = vi.fn<(userId: string, plan: "free" | "pro") => Promise<void>>(
      async () => {},
    );

    await expect(
      syncAppUserPlanFromSubscriptions({
        userId: "user_123",
        proPriceId,
        now,
        repository: {
          ensureAppUser: async () => {},
          getAppUserPlan: async () => "pro",
          listSubscriptionsByUserId: async () => [
            subscription({
              status: "past_due",
              currentPeriodEnd: "2026-06-03T23:59:59.999Z",
            }),
          ],
          updateAppUserPlan,
        },
      }),
    ).resolves.toBe("free");

    expect(updateAppUserPlan).toHaveBeenCalledWith("user_123", "free");
  });

  it("Price ID不一致のsubscriptionだけならfreeへ同期する", async () => {
    const updateAppUserPlan = vi.fn<(userId: string, plan: "free" | "pro") => Promise<void>>(
      async () => {},
    );

    await expect(
      syncAppUserPlanFromSubscriptions({
        userId: "user_123",
        proPriceId,
        now,
        repository: {
          ensureAppUser: async () => {},
          getAppUserPlan: async () => "pro",
          listSubscriptionsByUserId: async () => [
            subscription({ stripePriceId: "price_other", status: "active" }),
          ],
          updateAppUserPlan,
        },
      }),
    ).resolves.toBe("free");

    expect(updateAppUserPlan).toHaveBeenCalledWith("user_123", "free");
  });
});
