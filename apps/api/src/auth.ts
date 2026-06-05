import * as schema from "@recipestock/db";
import { appUsers, createDb } from "@recipestock/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { Resend } from "resend";
import { type BillingRepository, createBillingRepository } from "./billing";
import { type Bindings } from "./env";
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

const createAuth = (env: Bindings) => {
  const db = createDb(env.DATABASE_URL);
  const billingRepository = createBillingRepository(db);
  const resend = new Resend(env.RESEND_API_KEY);
  const stripeClient = createStripeBillingClient(env);

  return betterAuth({
    basePath: "/api/auth",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
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
      async sendVerificationEmail({ user, url }) {
        await resend.emails.send({
          from: env.AUTH_EMAIL_FROM,
          to: user.email,
          subject: "Recipe Stock email verification",
          text: `Open this link to verify your Recipe Stock email address: ${url}`,
        });
      },
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
        async sendVerificationOTP({ email, otp, type }) {
          await resend.emails.send({
            from: env.AUTH_EMAIL_FROM,
            to: email,
            subject:
              type === "forget-password"
                ? "Recipe Stock password reset code"
                : "Recipe Stock verification code",
            text: `Your Recipe Stock code is ${otp}.`,
          });
        },
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

export const authService: AuthService = {
  async getSession(request, env) {
    const auth = createAuth(env);
    return auth.api.getSession({
      headers: request.headers,
    }) as Promise<AuthSession | null>;
  },
  async handleAuthRequest(request, env) {
    const auth = createAuth(env);
    return auth.handler(request);
  },
};
