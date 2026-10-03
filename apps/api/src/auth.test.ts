import { describe, expect, it, vi } from "vitest";
import { createAuthEmailCallbacks, syncStripeCustomerEmailForUser } from "./auth";
import { type EmailSender } from "./lib/email/resend";
import { createLogger, createMemoryLogSink } from "./logger";

describe("createAuthEmailCallbacks", () => {
  it("email verification linkを送る", async () => {
    const send = vi.fn<EmailSender["send"]>(async () => ({ id: "email-1" }));
    const callbacks = createAuthEmailCallbacks({
      emailSender: { send },
      from: "Recipe Stock <login@example.com>",
    });

    await callbacks.sendVerificationEmail({
      user: { email: "user@example.com" },
      url: "https://recipestock.example/verify/token",
    });

    expect(send).toHaveBeenCalledWith({
      from: "Recipe Stock <login@example.com>",
      to: "user@example.com",
      subject: "【Recipe Stock】メールアドレスの確認",
      text: expect.stringContaining("https://recipestock.example/verify/token"),
    });
  });

  it("パスワード再設定のOTPを送る", async () => {
    const send = vi.fn<EmailSender["send"]>(async () => ({ id: "email-1" }));
    const callbacks = createAuthEmailCallbacks({
      emailSender: { send },
      from: "Recipe Stock <login@example.com>",
    });

    await callbacks.sendVerificationOTP({
      email: "user@example.com",
      otp: "123456",
      type: "forget-password",
    });

    expect(send).toHaveBeenCalledWith({
      from: "Recipe Stock <login@example.com>",
      to: "user@example.com",
      subject: "【Recipe Stock】パスワード再設定の確認コード",
      text: expect.stringContaining("123456"),
    });
  });

  it("メール確認のOTPを宛先へ送る", async () => {
    const send = vi.fn<EmailSender["send"]>(async () => ({ id: "email-1" }));
    const callbacks = createAuthEmailCallbacks({
      emailSender: { send },
      from: "Recipe Stock <login@example.com>",
    });

    await callbacks.sendVerificationOTP({
      email: "user@example.com",
      otp: "123456",
      type: "email-verification",
    });

    expect(send).toHaveBeenCalledWith({
      from: "Recipe Stock <login@example.com>",
      to: "user@example.com",
      subject: "【Recipe Stock】確認コード",
      text: expect.stringContaining("123456"),
    });
  });

  it("email送信失敗を認証処理へ伝播する", async () => {
    const error = new Error("email send failed");
    const callbacks = createAuthEmailCallbacks({
      emailSender: {
        send: vi.fn<EmailSender["send"]>(async () => {
          throw error;
        }),
      },
      from: "Recipe Stock <login@example.com>",
    });

    await expect(
      callbacks.sendVerificationOTP({
        email: "user@example.com",
        otp: "123456",
        type: "email-verification",
      }),
    ).rejects.toBe(error);
  });
});

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
    const sink = createMemoryLogSink();
    const logger = createLogger({}, { sink });

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

    expect(sink.entries).toEqual([
      expect.objectContaining({
        event: "stripe_customer_email_sync_failed",
        level: "error",
        error: { message: "Stripe update failed.", name: "Error", stack: expect.any(String) },
        stripeCustomerId: "cus_123",
        userId: "user_123",
      }),
    ]);
  });
});
