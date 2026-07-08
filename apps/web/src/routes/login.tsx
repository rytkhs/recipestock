import { Button, Input, Label, TextField } from "@heroui/react";
import { EnvelopeSimple, GoogleLogo, Key } from "@phosphor-icons/react";
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

  const modeTitle = {
    signIn: "ログイン",
    signUp: "アカウント作成",
    verifySignUp: "メール確認",
    requestReset: "パスワード再設定",
    resetPassword: "パスワード再設定",
  }[mode];

  return (
    <section className="flex min-h-[calc(100svh-60px)] items-center justify-center px-4 py-10">
      <div className="min-w-0 w-full max-w-md rounded-[28px] border border-brand-line-soft bg-brand-paper p-6 shadow-pantry sm:p-8">
        <h1 className="text-brand-ink font-bold text-2xl text-center">{modeTitle}</h1>
        <p className="mt-2 text-brand-muted text-sm text-center">Recipe Stockにようこそ</p>

        <div className="mt-8 grid min-w-0 gap-4">
          <Button
            className="w-full rounded-full bg-brand-paper-raised border border-brand-line text-brand-walnut font-semibold gap-2 hover:bg-brand-paper-muted"
            variant="secondary"
            onPress={() => void startGoogleLogin()}
          >
            <GoogleLogo size={20} weight="bold" />
            Googleでログイン
          </Button>

          <div className="relative flex min-w-0 items-center gap-3 py-2">
            <div className="min-w-0 flex-1 border-t border-brand-line" />
            <span className="text-brand-muted text-xs font-medium">または</span>
            <div className="min-w-0 flex-1 border-t border-brand-line" />
          </div>

          {mode === "signIn" ? (
            <form className="grid min-w-0 gap-4" onSubmit={handleSignIn}>
              <TextField className="min-w-0" isRequired type="email">
                <Label className="text-brand-walnut font-semibold text-sm flex items-center gap-1.5">
                  <EnvelopeSimple size={14} weight="bold" />
                  メールアドレス
                </Label>
                <Input
                  autoComplete="email"
                  className="w-full min-w-0"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </TextField>

              <TextField className="min-w-0" isRequired type="password">
                <Label className="text-brand-walnut font-semibold text-sm flex items-center gap-1.5">
                  <Key size={14} weight="bold" />
                  パスワード
                </Label>
                <Input
                  autoComplete="current-password"
                  className="w-full min-w-0"
                  maxLength={128}
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </TextField>

              <Button
                className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
                type="submit"
                variant="primary"
              >
                ログイン
              </Button>
            </form>
          ) : null}

          {mode === "signUp" ? (
            <form className="grid min-w-0 gap-4" onSubmit={handleSignUp}>
              <TextField className="min-w-0" isRequired type="email">
                <Label className="text-brand-walnut font-semibold text-sm flex items-center gap-1.5">
                  <EnvelopeSimple size={14} weight="bold" />
                  メールアドレス
                </Label>
                <Input
                  autoComplete="email"
                  className="w-full min-w-0"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </TextField>

              <TextField className="min-w-0" isRequired type="password">
                <Label className="text-brand-walnut font-semibold text-sm flex items-center gap-1.5">
                  <Key size={14} weight="bold" />
                  パスワード
                </Label>
                <Input
                  autoComplete="new-password"
                  className="w-full min-w-0"
                  maxLength={128}
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </TextField>

              <Button
                className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
                type="submit"
                variant="primary"
              >
                登録してコードを送信
              </Button>
            </form>
          ) : null}

          {mode === "verifySignUp" ? (
            <form className="grid min-w-0 gap-4" onSubmit={handleVerifySignUp}>
              <TextField className="min-w-0" isRequired>
                <Label className="text-brand-walnut font-semibold text-sm">確認コード</Label>
                <Input
                  autoComplete="one-time-code"
                  className="w-full min-w-0 text-center text-lg tracking-[0.3em] font-bold"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  pattern="[0-9]{6}"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                />
              </TextField>

              <Button
                className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
                type="submit"
                variant="primary"
              >
                登録を完了
              </Button>
            </form>
          ) : null}

          {mode === "requestReset" ? (
            <form className="grid min-w-0 gap-4" onSubmit={handleRequestReset}>
              <TextField className="min-w-0" isRequired type="email">
                <Label className="text-brand-walnut font-semibold text-sm flex items-center gap-1.5">
                  <EnvelopeSimple size={14} weight="bold" />
                  メールアドレス
                </Label>
                <Input
                  autoComplete="email"
                  className="w-full min-w-0"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </TextField>

              <Button
                className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
                type="submit"
                variant="primary"
              >
                再設定コードを送信
              </Button>
            </form>
          ) : null}

          {mode === "resetPassword" ? (
            <form className="grid min-w-0 gap-4" onSubmit={handleResetPassword}>
              <TextField className="min-w-0" isRequired>
                <Label className="text-brand-walnut font-semibold text-sm">確認コード</Label>
                <Input
                  autoComplete="one-time-code"
                  className="w-full min-w-0 text-center text-lg tracking-[0.3em] font-bold"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  pattern="[0-9]{6}"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                />
              </TextField>

              <TextField className="min-w-0" isRequired type="password">
                <Label className="text-brand-walnut font-semibold text-sm flex items-center gap-1.5">
                  <Key size={14} weight="bold" />
                  新しいパスワード
                </Label>
                <Input
                  autoComplete="new-password"
                  className="w-full min-w-0"
                  maxLength={128}
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </TextField>

              <Button
                className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
                type="submit"
                variant="primary"
              >
                パスワードを再設定
              </Button>
            </form>
          ) : null}

          <div className="flex flex-wrap justify-center gap-3 pt-2">
            {mode !== "signIn" ? (
              <Button
                className="text-brand-sage text-sm rounded-full hover:bg-brand-sage-soft/50"
                size="sm"
                variant="ghost"
                onPress={() => switchMode("signIn")}
              >
                ログインに戻る
              </Button>
            ) : null}
            {mode !== "signUp" && mode !== "verifySignUp" ? (
              <Button
                className="text-brand-sage text-sm rounded-full hover:bg-brand-sage-soft/50"
                size="sm"
                variant="ghost"
                onPress={() => switchMode("signUp")}
              >
                アカウントを作成
              </Button>
            ) : null}
            {mode !== "requestReset" && mode !== "resetPassword" ? (
              <Button
                className="text-brand-muted text-sm rounded-full hover:bg-brand-paper-muted"
                size="sm"
                variant="ghost"
                onPress={() => switchMode("requestReset")}
              >
                パスワードを忘れた場合
              </Button>
            ) : null}
          </div>

          {message ? (
            <div className="rounded-[14px] bg-brand-sage-soft/30 border border-brand-sage-soft p-3">
              <p className="font-medium text-brand-sage-dark text-sm">{message}</p>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
              <p className="text-brand-danger text-sm" role="alert">
                {error}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
