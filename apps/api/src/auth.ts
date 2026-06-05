import * as schema from "@recipestock/db";
import { appUsers, createDb } from "@recipestock/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { Resend } from "resend";
import { type Bindings } from "./env";

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

const createAuth = (env: Bindings) => {
  const db = createDb(env.DATABASE_URL);
  const resend = new Resend(env.RESEND_API_KEY);

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
      async sendVerificationEmail({ user, url }) {
        await resend.emails.send({
          from: env.AUTH_EMAIL_FROM,
          to: user.email,
          subject: "Recipe Stock email change verification",
          text: `Open this link to verify your Recipe Stock email address change: ${url}`,
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
        overrideDefaultEmailVerification: true,
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
