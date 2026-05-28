import { Button, Input, Label, TextField } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import {
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  startGoogleLogin,
  useAuthSession,
  verifySignUpOtp,
} from "../lib/auth";

type LoginMode = "signIn" | "signUp" | "verifySignUp" | "requestReset" | "resetPassword";

export const LoginRoute = () => {
  const navigate = useNavigate();
  const session = useAuthSession();
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
      await session.refetch();
      await navigate({ to: "/recipes" });
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
      await session.refetch();
      await navigate({ to: "/recipes" });
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
    <section className="mx-auto w-full max-w-md px-6 py-10">
      <h1 className="font-semibold text-3xl">ログイン</h1>
      <div className="mt-6 grid gap-4">
        <Button variant="primary" onPress={() => void startGoogleLogin()}>
          Googleでログイン
        </Button>

        {mode === "signIn" ? (
          <form className="grid gap-3" onSubmit={handleSignIn}>
            <TextField isRequired type="email">
              <Label>メールアドレス</Label>
              <Input
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </TextField>

            <TextField isRequired type="password">
              <Label>パスワード</Label>
              <Input
                autoComplete="current-password"
                maxLength={128}
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </TextField>

            <Button type="submit" variant="secondary">
              ログイン
            </Button>
          </form>
        ) : null}

        {mode === "signUp" ? (
          <form className="grid gap-3" onSubmit={handleSignUp}>
            <TextField isRequired type="email">
              <Label>メールアドレス</Label>
              <Input
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </TextField>

            <TextField isRequired type="password">
              <Label>パスワード</Label>
              <Input
                autoComplete="new-password"
                maxLength={128}
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </TextField>

            <Button type="submit" variant="secondary">
              登録してコードを送信
            </Button>
          </form>
        ) : null}

        {mode === "verifySignUp" ? (
          <form className="grid gap-3" onSubmit={handleVerifySignUp}>
            <TextField isRequired>
              <Label>確認コード</Label>
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                pattern="[0-9]{6}"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
            </TextField>

            <Button type="submit" variant="secondary">
              登録を完了
            </Button>
          </form>
        ) : null}

        {mode === "requestReset" ? (
          <form className="grid gap-3" onSubmit={handleRequestReset}>
            <TextField isRequired type="email">
              <Label>メールアドレス</Label>
              <Input
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </TextField>

            <Button type="submit" variant="secondary">
              再設定コードを送信
            </Button>
          </form>
        ) : null}

        {mode === "resetPassword" ? (
          <form className="grid gap-3" onSubmit={handleResetPassword}>
            <TextField isRequired>
              <Label>確認コード</Label>
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                pattern="[0-9]{6}"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
              />
            </TextField>

            <TextField isRequired type="password">
              <Label>新しいパスワード</Label>
              <Input
                autoComplete="new-password"
                maxLength={128}
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </TextField>

            <Button type="submit" variant="secondary">
              パスワードを再設定
            </Button>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {mode !== "signIn" ? (
            <Button size="sm" variant="ghost" onPress={() => switchMode("signIn")}>
              ログインに戻る
            </Button>
          ) : null}
          {mode !== "signUp" && mode !== "verifySignUp" ? (
            <Button size="sm" variant="ghost" onPress={() => switchMode("signUp")}>
              アカウントを作成
            </Button>
          ) : null}
          {mode !== "requestReset" && mode !== "resetPassword" ? (
            <Button size="sm" variant="ghost" onPress={() => switchMode("requestReset")}>
              パスワードを忘れた場合
            </Button>
          ) : null}
        </div>

        {message ? <p className="font-medium text-success">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </section>
  );
};
