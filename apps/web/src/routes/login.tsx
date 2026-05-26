import { type FormEvent, useState } from "react";
import {
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  startGoogleLogin,
  verifySignUpOtp,
} from "../lib/auth";

type LoginMode = "signIn" | "signUp" | "verifySignUp" | "requestReset" | "resetPassword";

export const LoginRoute = () => {
  const [mode, setMode] = useState<LoginMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (nextMode: LoginMode) => {
    setMode(nextMode);
    setOtp("");
    setMessage(null);
    setError(null);
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await signInWithEmailPassword(email, password);
      window.location.assign("/recipes");
    } catch {
      setError("メールアドレスまたはパスワードが正しくありません。");
    }
  };

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await signUpWithEmailPassword(email, password);
      setMode("verifySignUp");
      setPassword("");
      setMessage("確認コードを送信しました。");
    } catch {
      setError("登録できませんでした。");
    }
  };

  const handleVerifySignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await verifySignUpOtp(email, otp);
      window.location.assign("/recipes");
    } catch {
      setError("確認コードを検証できませんでした。");
    }
  };

  const handleRequestReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await requestPasswordResetOtp(email);
      setMode("resetPassword");
      setPassword("");
      setOtp("");
      setMessage("パスワード再設定コードを送信しました。");
    } catch {
      setError("パスワード再設定コードを送信できませんでした。");
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await resetPasswordWithOtp(email, otp, password);
      setMode("signIn");
      setPassword("");
      setOtp("");
      setMessage("パスワードを再設定しました。新しいパスワードでログインしてください。");
    } catch {
      setError("パスワードを再設定できませんでした。");
    }
  };

  return (
    <section className="page login-page">
      <h1>ログイン</h1>
      <div className="login-panel">
        <button className="primary-button" type="button" onClick={() => void startGoogleLogin()}>
          Googleでログイン
        </button>

        {mode === "signIn" ? (
          <form className="login-form" onSubmit={handleSignIn}>
            <label htmlFor="login-email">メールアドレス</label>
            <input
              id="login-email"
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <label htmlFor="login-password">パスワード</label>
            <input
              id="login-password"
              autoComplete="current-password"
              minLength={8}
              maxLength={128}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <button className="secondary-button" type="submit">
              ログイン
            </button>
          </form>
        ) : null}

        {mode === "signUp" ? (
          <form className="login-form" onSubmit={handleSignUp}>
            <label htmlFor="signup-email">メールアドレス</label>
            <input
              id="signup-email"
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <label htmlFor="signup-password">パスワード</label>
            <input
              id="signup-password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <button className="secondary-button" type="submit">
              登録してコードを送信
            </button>
          </form>
        ) : null}

        {mode === "verifySignUp" ? (
          <form className="login-form" onSubmit={handleVerifySignUp}>
            <label htmlFor="signup-otp">確認コード</label>
            <input
              id="signup-otp"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              pattern="[0-9]{6}"
              required
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />

            <button className="secondary-button" type="submit">
              登録を完了
            </button>
          </form>
        ) : null}

        {mode === "requestReset" ? (
          <form className="login-form" onSubmit={handleRequestReset}>
            <label htmlFor="reset-email">メールアドレス</label>
            <input
              id="reset-email"
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <button className="secondary-button" type="submit">
              再設定コードを送信
            </button>
          </form>
        ) : null}

        {mode === "resetPassword" ? (
          <form className="login-form" onSubmit={handleResetPassword}>
            <label htmlFor="reset-otp">確認コード</label>
            <input
              id="reset-otp"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              pattern="[0-9]{6}"
              required
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />

            <label htmlFor="reset-password">新しいパスワード</label>
            <input
              id="reset-password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <button className="secondary-button" type="submit">
              パスワードを再設定
            </button>
          </form>
        ) : null}

        <div className="login-actions">
          {mode !== "signIn" ? (
            <button className="text-button" type="button" onClick={() => switchMode("signIn")}>
              ログインに戻る
            </button>
          ) : null}
          {mode !== "signUp" && mode !== "verifySignUp" ? (
            <button className="text-button" type="button" onClick={() => switchMode("signUp")}>
              アカウントを作成
            </button>
          ) : null}
          {mode !== "requestReset" && mode !== "resetPassword" ? (
            <button
              className="text-button"
              type="button"
              onClick={() => switchMode("requestReset")}
            >
              パスワードを忘れた場合
            </button>
          ) : null}
        </div>

        {message ? <p className="success-message">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </section>
  );
};
