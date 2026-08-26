import { describe, expect, it, vi } from "vitest";
import {
  createAuthEmailCallbacks,
  createAuthService,
  syncStripeCustomerEmailForUser,
} from "./auth";
import { type Bindings } from "./env";
import { type EmailSender } from "./lib/email/resend";

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
      subject: "Recipe Stock email verification",
      text: "Open this link to verify your Recipe Stock email address: https://recipestock.example/verify/token",
    });
  });

  it.each([
    ["sign-in", "Recipe Stock verification code"],
    ["email-verification", "Recipe Stock verification code"],
    ["forget-password", "Recipe Stock password reset code"],
    ["change-email", "Recipe Stock verification code"],
  ] as const)("%s OTPを送る", async (type, subject) => {
    const send = vi.fn<EmailSender["send"]>(async () => ({ id: "email-1" }));
    const callbacks = createAuthEmailCallbacks({
      emailSender: { send },
      from: "Recipe Stock <login@example.com>",
    });

    await callbacks.sendVerificationOTP({
      email: "user@example.com",
      otp: "123456",
      type,
    });

    expect(send).toHaveBeenCalledWith({
      from: "Recipe Stock <login@example.com>",
      to: "user@example.com",
      subject,
      text: "Your Recipe Stock code is 123456.",
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

describe("createAuthService", () => {
  // betterAuth instanceはisolate内で使い回す。Workersは別requestのI/Oを跨いだ利用を
  // 拒否するため、2request目が同じinstanceで通ることを固定する。
  it("同一isolateの複数requestで同じauth instanceを使い回せる", async () => {
    let nextInstanceId = 1;
    const authService = createAuthService(() => {
      const instanceId = `instance-${nextInstanceId}`;
      nextInstanceId += 1;

      return {
        api: {
          async getSession() {
            return {
              user: {
                email: `${instanceId}@example.com`,
                id: instanceId,
              },
            };
          },
        },
        async handler() {
          return new Response(null, { status: 204 });
        },
      };
    });
    const env = {
      DATABASE_URL: "postgresql://user:password@db.example/recipestock",
      APP_ORIGIN: "https://recipestock.example",
      BETTER_AUTH_SECRET: "test-secret",
      AUTH_EMAIL_FROM: "noreply@recipestock.example",
      RESEND_API_KEY: "re_test",
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_PRO_PRICE_ID: "price_test",
    } as Bindings;
    const request = () => new Request("https://recipestock.example/api/me");

    const firstSession = await authService.getSession(request(), env);
    const secondSession = await authService.getSession(request(), env);

    expect([firstSession?.user.id, secondSession?.user.id]).toEqual(["instance-1", "instance-1"]);
  });
});
