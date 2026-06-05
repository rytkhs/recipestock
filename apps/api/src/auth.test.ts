import { describe, expect, it, vi } from "vitest";
import { syncStripeCustomerEmailForUser } from "./auth";

describe("syncStripeCustomerEmailForUser", () => {
  it("Stripe Customer未作成ユーザーではStripe APIを呼ばない", async () => {
    const updateCustomerEmail = vi.fn();

    await syncStripeCustomerEmailForUser({
      email: "new@example.com",
      repository: {
        getOrCreateAppUserBillingState: async (userId) => ({
          userId,
          plan: "free",
          stripeCustomerId: null,
        }),
      },
      stripeClient: { updateCustomerEmail },
      userId: "user_123",
    });

    expect(updateCustomerEmail).not.toHaveBeenCalled();
  });

  it("Stripe Customer作成済みユーザーでは更新後メールをStripeへ同期する", async () => {
    const updateCustomerEmail = vi.fn(async () => {});

    await syncStripeCustomerEmailForUser({
      email: "new@example.com",
      repository: {
        getOrCreateAppUserBillingState: async (userId) => ({
          userId,
          plan: "pro",
          stripeCustomerId: "cus_123",
        }),
      },
      stripeClient: { updateCustomerEmail },
      userId: "user_123",
    });

    expect(updateCustomerEmail).toHaveBeenCalledWith({
      email: "new@example.com",
      stripeCustomerId: "cus_123",
      userId: "user_123",
    });
  });

  it("Stripe更新失敗時は例外を漏らさずログへ残す", async () => {
    const error = new Error("Stripe update failed.");
    const logger = { error: vi.fn() };

    await expect(
      syncStripeCustomerEmailForUser({
        email: "new@example.com",
        logger,
        repository: {
          getOrCreateAppUserBillingState: async (userId) => ({
            userId,
            plan: "pro",
            stripeCustomerId: "cus_123",
          }),
        },
        stripeClient: {
          updateCustomerEmail: async () => {
            throw error;
          },
        },
        userId: "user_123",
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith("[auth] Stripe customer email sync failed", {
      error,
      stripeCustomerId: "cus_123",
      userId: "user_123",
    });
  });
});
