import * as schema from "@recipestock/db";
import { appUsers, createDb } from "@recipestock/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { type BillingRepository, createBillingRepository } from "./billing";
import { type Bindings } from "./env";
import { createResendEmailSender, type EmailSender } from "./lib/email/resend";
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

type StripeCustomerEmailSyncLogger = {
  error(...data: unknown[]): void;
};

export type SyncStripeCustomerEmailForUserParams = {
  email: string;
  logger?: StripeCustomerEmailSyncLogger;
  repository: Pick<BillingRepository, "getOrCreateAppUserBillingState">;
  stripeClient: Pick<StripeBillingClient, "updateCustomerEmail">;
  userId: string;
};

export const syncStripeCustomerEmailForUser = async ({
  email,
  logger = console,
  repository,
  stripeClient,
  userId,
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
    logger.error("[auth] Stripe customer email sync failed", {
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
  async sendVerificationEmail({ user, url }: { user: { email: string }; url: string }) {
    await emailSender.send({
      from,
      to: user.email,
      subject: "Recipe Stock email verification",
      text: `Open this link to verify your Recipe Stock email address: ${url}`,
    });
  },
  async sendVerificationOTP({ email, otp, type }: { email: string; otp: string; type: string }) {
    await emailSender.send({
      from,
      to: email,
      subject:
        type === "forget-password"
          ? "Recipe Stock password reset code"
          : "Recipe Stock verification code",
      text: `Your Recipe Stock code is ${otp}.`,
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
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      changeEmail: {
        enabled: true,
      },
    },
    emailVerification: {
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
        otpLength: 6,
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
              console.error("[auth] Stripe customer email sync hook failed", {
                error,
                userId: user.id,
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
