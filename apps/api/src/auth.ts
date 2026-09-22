import * as schema from "@recipestock/db";
import { appUsers, createDb } from "@recipestock/db";
import {
  EMAIL_CHANGE_LINK_EXPIRES_IN_HOURS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  OTP_LENGTH,
} from "@recipestock/shared";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { type EmailOTPOptions, emailOTP } from "better-auth/plugins/email-otp";
import { type BillingRepository, createBillingRepository } from "./billing";
import { type Bindings } from "./env";
import { createResendEmailSender, type EmailSender } from "./lib/email/resend";
import { createLogger, type Logger } from "./logger";
import { createStripeBillingClient, type StripeBillingClient } from "./stripe-billing";

export type AuthSession = {
  user: {
    email: string;
    id: string;
  };
};

export type AuthService = {
  getSession(request: Request, env: Bindings): Promise<AuthSession | null>;
  handleAuthRequest(request: Request, env: Bindings): Promise<Response>;
};

type AuthInstance = {
  api: {
    getSession(input: { headers: Headers }): Promise<AuthSession | null>;
  };
  handler(request: Request): Promise<Response>;
};

type AuthFactory = (env: Bindings) => AuthInstance;

type SendVerificationOTPData = Parameters<EmailOTPOptions["sendVerificationOTP"]>[0];

export type SyncStripeCustomerEmailForUserParams = {
  email: string;
  logger?: Logger;
  repository: Pick<BillingRepository, "getOrCreateAppUserBillingState">;
  stripeClient: Pick<StripeBillingClient, "updateCustomerEmail">;
  userId: string;
};

export const syncStripeCustomerEmailForUser = async ({
  email,
  repository,
  stripeClient,
  userId,
  logger = createLogger({ userId }),
}: SyncStripeCustomerEmailForUserParams) => {
  const appUser = await repository.getOrCreateAppUserBillingState(userId);

  if (!appUser.stripeCustomerId) {
    return;
  }

  try {
    await stripeClient.updateCustomerEmail({
      email,
      stripeCustomerId: appUser.stripeCustomerId,
      userId,
    });
  } catch (error) {
    logger.error("stripe_customer_email_sync_failed", {
      error,
      stripeCustomerId: appUser.stripeCustomerId,
      userId,
    });
  }
};

export const createAuthEmailCallbacks = ({
  emailSender,
  from,
}: {
  emailSender: EmailSender;
  from: string;
}) => ({
  // 登録の確認はコード(OTP)で行うので、リンクを送るのはメールアドレスの変更だけ。宛先は新しいアドレス。
  // リンクを開くまで変更は完了しない。
  async sendVerificationEmail({ user, url }: { user: { email: string }; url: string }) {
    await emailSender.send({
      from,
      to: user.email,
      subject: "【Recipe Stock】メールアドレスの確認",
      text: [
        "次のリンクを開くと、このメールアドレスをRecipe Stockで使えるようになります。",
        "",
        url,
        "",
        `リンクの有効期限は${EMAIL_CHANGE_LINK_EXPIRES_IN_HOURS}時間です。開くまで、Recipe Stockのメールアドレスは変わりません。`,
        "心当たりがない場合は、このメールを破棄してください。",
      ].join("\n"),
    });
  },
  async sendVerificationOTP({ email, otp, type }: SendVerificationOTPData) {
    const isPasswordReset = type === "forget-password";

    await emailSender.send({
      from,
      to: email,
      subject: isPasswordReset
        ? "【Recipe Stock】パスワード再設定の確認コード"
        : "【Recipe Stock】確認コード",
      text: [
        isPasswordReset
          ? `パスワード再設定の確認コードは ${otp} です。`
          : `確認コードは ${otp} です。`,
        "Recipe Stockの画面に入力してください。",
        "",
        isPasswordReset
          ? "心当たりがない場合は、このメールを破棄してください。パスワードは変わりません。"
          : "心当たりがない場合は、このメールを破棄してください。",
      ].join("\n"),
    });
  },
});

const createAuth = (env: Bindings) => {
  const db = createDb(env.DATABASE_URL);
  const billingRepository = createBillingRepository(db);
  const emailSender = createResendEmailSender(env.RESEND_API_KEY);
  const emailCallbacks = createAuthEmailCallbacks({
    emailSender,
    from: env.AUTH_EMAIL_FROM,
  });
  const stripeClient = createStripeBillingClient(env);

  return betterAuth({
    basePath: "/api/auth",
    baseURL: env.APP_ORIGIN,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    // requireAuthは毎requestでsessionを引き、サムネイル画像1枚ごとにもNeonを往復していた。
    // get-sessionがDBを引いたときに署名付きcookieを配り、以降のrequestはそれを検証して返す。
    // 引き換えに他端末のsession遮断とuser情報の反映が最大maxAge分遅れる。
    session: {
      cookieCache: { enabled: true, maxAge: 60 },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      changeEmail: {
        enabled: true,
      },
    },
    emailVerification: {
      // リンクで確かめるのはメールアドレスの変更だけ。登録と再設定のコードの期限はemailOTP側で決まる。
      expiresIn: EMAIL_CHANGE_LINK_EXPIRES_IN_HOURS * 60 * 60,
      autoSignInAfterVerification: true,
      sendOnSignUp: false,
      sendVerificationEmail: emailCallbacks.sendVerificationEmail,
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        sendVerificationOnSignUp: true,
        sendVerificationOTP: emailCallbacks.sendVerificationOTP,
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db.insert(appUsers).values({ userId: user.id }).onConflictDoNothing();
          },
        },
        update: {
          after: async (user) => {
            try {
              await syncStripeCustomerEmailForUser({
                email: user.email,
                repository: billingRepository,
                stripeClient,
                userId: user.id,
              });
            } catch (error) {
              createLogger({ userId: user.id }).error("stripe_customer_email_sync_failed", {
                error,
              });
            }
          },
        },
      },
    },
  });
};

// betterAuthの構築はplugin初期化とroute table生成を伴い、Resendとstripe clientも作り直す。
// isolate内で使い回せる。保持するのは設定とfetchベースのclientだけで、
// request scopeのI/OやExecutionContextを掴まない。
export const createAuthService = (authFactory: AuthFactory): AuthService => {
  let cachedAuth: AuthInstance | null = null;
  const getAuth = (env: Bindings) => (cachedAuth ??= authFactory(env));

  return {
    async getSession(request, env) {
      return getAuth(env).api.getSession({
        headers: request.headers,
      });
    },
    async handleAuthRequest(request, env) {
      return getAuth(env).handler(request);
    },
  };
};

export const authService = createAuthService((env) => createAuth(env) as AuthInstance);
