import { type AuthService, type AuthSession } from "./auth";
import { type AppDependencies, createApp } from "./index";
import { createLogger, createNoopLogSink, type LoggerFactory } from "./logger";

export const createNoopLoggerFactory = (): LoggerFactory => {
  const sink = createNoopLogSink();

  return (baseFields) => createLogger(baseFields, { sink });
};

export const createSilentTestApp = (dependencies: AppDependencies = {}) =>
  createApp({
    ...dependencies,
    loggerFactory: dependencies.loggerFactory ?? createNoopLoggerFactory(),
  });

// nullを渡すと未ログインのセッションになる。
export const createTestAuth = (
  user: AuthSession["user"] | null = { id: "user_123", email: "user@example.com" },
): AuthService => ({
  getSession: async () => ({ session: user ? { user } : null, setCookies: [] }),
  handleAuthRequest: async () => new Response(null, { status: 404 }),
});

export const sameOriginHeaders = {
  origin: "https://app.example.com",
  "sec-fetch-site": "same-origin",
};
