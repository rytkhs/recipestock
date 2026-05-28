import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const sameOriginPath = (input: RequestInfo | URL) => {
  const url =
    typeof input === "string" || input instanceof URL
      ? new URL(input, window.location.origin)
      : null;

  if (url?.origin === window.location.origin) {
    return `${url.pathname}${url.search}`;
  }

  return input;
};

export const authClient = createAuthClient({
  baseURL: new URL("/api/auth", window.location.origin).toString(),
  fetchOptions: {
    customFetchImpl: (input, init) => fetch(sameOriginPath(input), init),
  },
  plugins: [emailOTPClient()],
});

const assertAuthSuccess = (result: { error: unknown }) => {
  if (result.error) {
    throw new Error("auth_request_failed");
  }
};

export const startGoogleLogin = async () => {
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL: "/recipes",
    disableRedirect: true,
  });
  assertAuthSuccess(result);

  if (result.data?.url) {
    window.location.assign(result.data.url);
  }
};

const buildInternalName = (email: string) => {
  const localPart = email.split("@")[0]?.trim();
  return localPart && localPart.length > 0 ? localPart : "user";
};

export const signInWithEmailPassword = async (email: string, password: string) => {
  const result = await authClient.signIn.email({
    email,
    password,
    callbackURL: "/recipes",
  });
  assertAuthSuccess(result);
};

export const signOut = async () => {
  const result = await authClient.signOut();
  assertAuthSuccess(result);
};

export const useAuthSession = () => authClient.useSession();

export const signUpWithEmailPassword = async (email: string, password: string) => {
  const result = await authClient.signUp.email({
    name: buildInternalName(email),
    email,
    password,
    callbackURL: "/recipes",
  });
  assertAuthSuccess(result);
};

export const verifySignUpOtp = async (email: string, otp: string) => {
  const result = await authClient.emailOtp.verifyEmail({
    email,
    otp,
  });
  assertAuthSuccess(result);
};

export const requestPasswordResetOtp = async (email: string) => {
  const result = await authClient.emailOtp.requestPasswordReset({
    email,
  });
  assertAuthSuccess(result);
};

export const resetPasswordWithOtp = async (email: string, otp: string, password: string) => {
  const result = await authClient.emailOtp.resetPassword({
    email,
    otp,
    password,
  });
  assertAuthSuccess(result);
};
