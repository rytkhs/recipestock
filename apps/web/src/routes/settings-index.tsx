import { Button, Input, Label, TextField } from "@heroui/react";
import { CaretLeft, CreditCard, SignOut, User } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { SkeletonBlock } from "../components/loading";
import { ScreenTopBar, ScreenTopBarIconButton } from "../components/screen-top-bar";
import { IosShareSettingsCard } from "../features/ios-share/settings-card";
import {
  deactivatePushSubscription,
  getCurrentPushSubscription,
  supportsPushNotifications,
} from "../features/push-notifications/browser";
import { PushNotificationSettingsCard } from "../features/push-notifications/settings-card";
import { changeEmail, changePassword, signOut, useAuthSession } from "../lib/auth";
import { clearUserScopedCache } from "../lib/query-cache";
import { useViewer } from "../lib/viewer";

export const SettingsIndexRoute = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const viewer = useViewer({ enabled: true });
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    let pushCleanupCompleted = false;

    try {
      if (supportsPushNotifications()) {
        const subscription = await getCurrentPushSubscription();
        if (subscription) {
          const { browserCleanupSucceeded, serverCleanupSucceeded } =
            await deactivatePushSubscription(subscription);
          if (!browserCleanupSucceeded && !serverCleanupSucceeded) {
            throw new Error("push_subscription_cleanup_failed");
          }
        }
      }
      pushCleanupCompleted = true;

      await signOut();
      clearUserScopedCache(queryClient);
      await session.refetch();
      await navigate({ to: "/login" });
    } catch {
      setSignOutError(
        pushCleanupCompleted
          ? "ログアウトできませんでした。時間をおいて再度お試しください。"
          : "通知を解除できなかったため、ログアウトを中止しました。時間をおいて再度お試しください。",
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleEmailChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailMessage(null);
    setEmailError(null);
    setIsEmailSubmitting(true);

    try {
      await changeEmail(newEmail);
      setNewEmail("");
      setEmailMessage("確認メールを送信しました。");
    } catch {
      setEmailError("メールアドレスを変更できませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordMessage(null);
    setPasswordError(null);
    setIsPasswordSubmitting(true);

    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMessage("パスワードを変更しました。");
    } catch {
      setPasswordError("パスワードを変更できませんでした。入力内容を確認してください。");
    } finally {
      setIsPasswordSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-[1120px] px-0 pb-10 sm:px-6 lg:px-10">
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton
            aria-label="レシピ一覧へ戻る"
            onPress={() => {
              void navigate({ to: "/recipes" });
            }}
          >
            <CaretLeft size={21} weight="bold" />
          </ScreenTopBarIconButton>
        }
        title="設定"
      />

      <div className="mt-4 px-4 sm:mt-6 sm:px-0">
        <div className="grid min-w-0 gap-5">
          <div className="min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
            <div className="mb-4 flex min-w-0 items-center gap-2">
              <User size={18} weight="bold" className="text-brand-walnut" />
              <h2 className="text-brand-walnut font-bold text-lg">アカウント</h2>
            </div>
            <p className="break-all text-brand-muted text-sm">
              現在のメールアドレス: {session.data?.user.email ?? ""}
            </p>
            <div className="mt-5 grid min-w-0 gap-6 md:grid-cols-2">
              <form className="grid min-w-0 content-start gap-4" onSubmit={handleEmailChange}>
                <h3 className="text-brand-walnut font-semibold text-base">メールアドレス変更</h3>
                <TextField className="min-w-0" isRequired type="email">
                  <Label className="text-brand-walnut font-semibold text-sm">
                    新しいメールアドレス
                  </Label>
                  <Input
                    autoComplete="email"
                    className="w-full min-w-0"
                    inputMode="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                  />
                </TextField>
                <Button
                  className="rounded-full font-semibold"
                  isDisabled={isEmailSubmitting}
                  type="submit"
                  variant="secondary"
                >
                  確認メールを送信
                </Button>
                {emailMessage ? (
                  <div className="rounded-[14px] bg-brand-sage-soft/30 border border-brand-sage-soft p-3">
                    <p className="font-medium text-brand-sage-dark text-sm" role="status">
                      {emailMessage}
                    </p>
                  </div>
                ) : null}
                {emailError ? (
                  <div className="rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
                    <p className="text-brand-danger text-sm" role="alert">
                      {emailError}
                    </p>
                  </div>
                ) : null}
              </form>

              <form className="grid min-w-0 content-start gap-4" onSubmit={handlePasswordChange}>
                <h3 className="text-brand-walnut font-semibold text-base">パスワード変更</h3>
                <TextField className="min-w-0" isRequired type="password">
                  <Label className="text-brand-walnut font-semibold text-sm">
                    現在のパスワード
                  </Label>
                  <Input
                    autoComplete="current-password"
                    className="w-full min-w-0"
                    maxLength={128}
                    minLength={8}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </TextField>
                <TextField className="min-w-0" isRequired type="password">
                  <Label className="text-brand-walnut font-semibold text-sm">
                    新しいパスワード
                  </Label>
                  <Input
                    autoComplete="new-password"
                    className="w-full min-w-0"
                    maxLength={128}
                    minLength={8}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </TextField>
                <Button
                  className="rounded-full font-semibold"
                  isDisabled={isPasswordSubmitting}
                  type="submit"
                  variant="secondary"
                >
                  パスワードを変更
                </Button>
                {passwordMessage ? (
                  <div className="rounded-[14px] bg-brand-sage-soft/30 border border-brand-sage-soft p-3">
                    <p className="font-medium text-brand-sage-dark text-sm" role="status">
                      {passwordMessage}
                    </p>
                  </div>
                ) : null}
                {passwordError ? (
                  <div className="rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
                    <p className="text-brand-danger text-sm" role="alert">
                      {passwordError}
                    </p>
                  </div>
                ) : null}
              </form>
            </div>
          </div>

          <div className="min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
            <div className="mb-3 flex min-w-0 items-center gap-2">
              <CreditCard size={18} weight="bold" className="text-brand-walnut" />
              <h2 className="text-brand-walnut font-bold text-lg">プラン</h2>
            </div>
            <p className="text-brand-muted text-sm">
              現在のプラン:{" "}
              {viewer.data ? (
                <span className="font-semibold text-brand-ink">
                  {viewer.data.plan === "pro" ? "Pro" : "Free"}
                </span>
              ) : (
                <SkeletonBlock className="inline-block h-4 w-10 align-middle" />
              )}
            </p>
            <Link
              className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-brand-sage px-5 font-semibold text-white text-sm hover:bg-brand-sage-dark transition-colors"
              to="/settings/billing"
            >
              課金設定
            </Link>
          </div>

          <PushNotificationSettingsCard />

          <IosShareSettingsCard />
        </div>

        <div className="mt-8 flex justify-center">
          <Button
            className="rounded-full text-brand-danger border-none bg-transparent hover:bg-brand-danger/5 gap-1.5"
            isDisabled={isSigningOut}
            variant="ghost"
            onPress={() => void handleSignOut()}
          >
            <SignOut size={16} weight="bold" />
            ログアウト
          </Button>
        </div>
        {signOutError ? (
          <p className="mt-3 text-center text-brand-danger text-sm" role="alert">
            {signOutError}
          </p>
        ) : null}
      </div>
    </section>
  );
};
