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

export const authRedirect = {
  assign: (url: string) => {
    window.location.assign(url);
  },
};

// better-authは失敗の理由を`code`で返す(例: INVALID_PASSWORD)。
// 画面が「現在のパスワードが違う」と「それ以外」を分けて伝えられるよう、codeを捨てずに運ぶ。
export class AuthRequestError extends Error {
  readonly code?: string;

  constructor(code?: string) {
    super("auth_request_failed");
    this.name = "AuthRequestError";
    this.code = code;
  }
}

const assertAuthSuccess = (result: { error: { code?: string } | null }) => {
  if (result.error) {
    throw new AuthRequestError(result.error.code);
  }
};

export const startGoogleLogin = async (callbackURL = "/recipes") => {
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL,
    disableRedirect: true,
  });
  assertAuthSuccess(result);

  if (result.data?.url) {
    authRedirect.assign(result.data.url);
  }
};

const buildInternalName = (email: string) => {
  const localPart = email.split("@")[0]?.trim();
  return localPart && localPart.length > 0 ? localPart : "user";
};

export const signInWithEmailPassword = async (
  email: string,
  password: string,
  callbackURL = "/recipes",
) => {
  const result = await authClient.signIn.email({
    email,
    password,
    callbackURL,
  });
  assertAuthSuccess(result);
};

export const signOut = async () => {
  const result = await authClient.signOut();
  assertAuthSuccess(result);
};

// 確認メールは新しいメールアドレス宛に届き、リンクを開いた時点で変更が完了する。
// 戻り先をメールアドレスのページにして、開いた人が今のメールアドレスを確かめられるようにする。
export const changeEmail = async (newEmail: string) => {
  const result = await authClient.changeEmail({
    newEmail,
    callbackURL: "/settings/email",
  });
  assertAuthSuccess(result);
};

export const changePassword = async (currentPassword: string, newPassword: string) => {
  const result = await authClient.changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: true,
  });
  assertAuthSuccess(result);
};

// better-authはパスワードを"credential"というproviderIdのaccountとして持つ。
// ログイン中の利用者はaccountを必ず1つ以上持つので、providerの一覧がそのままログイン方法になる。
export const listAccountProviders = async () => {
  const result = await authClient.listAccounts();
  assertAuthSuccess(result);

  if (!result.data) {
    throw new AuthRequestError();
  }

  return result.data.map((account) => account.providerId);
};

export const useAuthSession = () => authClient.useSession();

export const getAuthSession = () => authClient.getSession();

// 401回復は「sessionがまだ生きているか」をDBに問う経路。cookie cacheから答えると
// 必ずauthenticatedが返り、回復が空回りしてexhaustedに落ちる。
export const getFreshAuthSession = () =>
  authClient.getSession({ query: { disableCookieCache: true } });

export const signUpWithEmailPassword = async (
  email: string,
  password: string,
  callbackURL = "/recipes",
) => {
  const result = await authClient.signUp.email({
    name: buildInternalName(email),
    email,
    password,
    callbackURL,
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
