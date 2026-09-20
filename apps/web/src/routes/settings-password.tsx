import { CheckCircle, Circle } from "@phosphor-icons/react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@recipestock/schemas";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { ConnectionUnavailable } from "../components/connection-unavailable";
import { SettingsPageSkeleton } from "../components/loading";
import { useLoginMethods } from "../features/settings/login-methods";
import { PasswordInput } from "../features/settings/password-input";
import {
  SettingsFormMessage,
  SettingsNotice,
  SettingsSubpageTopBar,
  settingsPageBodyClass,
  settingsPageClass,
} from "../features/settings/settings-page";
import { useSignOut } from "../features/settings/use-sign-out";
import { AuthRequestError, changePassword, useAuthSession } from "../lib/auth";

type ChangePasswordError = {
  /** 直す欄が決まる失敗は、その欄の下に出す。決まらないものはボタンの下に出す。 */
  field: "current" | "new" | "form";
  message: string;
};

// 直せる失敗は、どの欄を何に直すかまで伝える。それ以外は同じ文言にまとめる。
const changePasswordError = (error: unknown): ChangePasswordError => {
  if (error instanceof AuthRequestError) {
    if (error.code === "INVALID_PASSWORD") {
      return { field: "current", message: "現在のパスワードが正しくありません。" };
    }
    if (error.code === "PASSWORD_TOO_SHORT") {
      return { field: "new", message: `${MIN_PASSWORD_LENGTH}文字以上にしてください。` };
    }
    if (error.code === "PASSWORD_TOO_LONG") {
      return { field: "new", message: `${MAX_PASSWORD_LENGTH}文字以内にしてください。` };
    }
  }

  return {
    field: "form",
    message: "パスワードを変更できませんでした。時間をおいて再度お試しください。",
  };
};

export const SettingsPasswordRoute = () => {
  const navigate = useNavigate();
  const session = useAuthSession();
  const loginMethods = useLoginMethods();
  const { clearSignOutError, isSigningOut, signOutAndGoToLogin, signOutError } = useSignOut();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const currentPasswordId = useId();
  const currentPasswordErrorId = useId();
  const newPasswordId = useId();
  const newPasswordHintId = useId();
  const newPasswordErrorId = useId();
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const changedNoticeRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<ChangePasswordError | null>(null);
  const [isChanged, setIsChanged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const isNewPasswordLongEnough = newPassword.length >= MIN_PASSWORD_LENGTH;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await changePassword(currentPassword, newPassword);
      // 済んだ用事のフォームは残さない。読み上げとキーボードの位置を結果へ移す。
      flushSync(() => {
        setCurrentPassword("");
        setNewPassword("");
        setIsChanged(true);
      });
      changedNoticeRef.current?.focus();
    } catch (submitError) {
      const nextError = changePasswordError(submitError);
      // 欄に印が付いてから移り、読み上げで何が違うかまで伝える。
      flushSync(() => setError(nextError));

      if (nextError.field === "current") {
        currentPasswordRef.current?.focus();
        currentPasswordRef.current?.select();
      }
      if (nextError.field === "new") {
        newPasswordRef.current?.focus();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const topBar = <SettingsSubpageTopBar title="パスワード" />;

  // パスワードを持つ人かどうかで出すものが変わるので、この画面はログイン方法を待つ。
  if (loginMethods.isPending) {
    return <SettingsPageSkeleton />;
  }

  if (!loginMethods.data) {
    return (
      <section className={settingsPageClass}>
        {topBar}
        <ConnectionUnavailable
          isRetrying={loginMethods.isFetching}
          onRetry={async () => {
            await loginMethods.refetch();
          }}
        />
      </section>
    );
  }

  // パスワードを持たない人にフォームは出さない。送っても必ず失敗する。
  if (!loginMethods.data.hasPassword) {
    return (
      <section className={settingsPageClass}>
        {topBar}
        <div className={settingsPageBodyClass}>
          <p className="text-brand-muted text-sm leading-6">
            このアカウントはGoogleでログインしています。パスワードは設定されていないため、変更するものはありません。
          </p>
        </div>
      </section>
    );
  }

  if (isChanged) {
    return (
      <section className={settingsPageClass}>
        {topBar}
        <div className={settingsPageBodyClass}>
          <div className="outline-none" ref={changedNoticeRef} tabIndex={-1}>
            <SettingsNotice
              action={
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigate({ to: "/settings" });
                  }}
                >
                  設定に戻る
                </Button>
              }
              title="パスワードを変更しました"
              tone="success"
            >
              ほかの端末ではログアウトされました。この端末はログインしたままです。
            </SettingsNotice>
          </div>
        </div>
      </section>
    );
  }

  const currentPasswordError = error?.field === "current" ? error.message : null;
  const newPasswordError = error?.field === "new" ? error.message : null;

  return (
    <section className={settingsPageClass}>
      {topBar}

      <div className={settingsPageBodyClass}>
        <form className="grid min-w-0 gap-5" onSubmit={handleSubmit}>
          {/* パスワードマネージャーが、どのアカウントのパスワードを差し替えるかを見分けるのに使う。 */}
          <input
            autoComplete="username"
            hidden
            readOnly
            type="email"
            value={session.data?.user.email ?? ""}
          />
          <FieldGroup>
            <Field className="min-w-0" data-invalid={currentPasswordError ? true : undefined}>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <FieldLabel htmlFor={currentPasswordId}>現在のパスワード</FieldLabel>
                {/* 忘れたと気づくのは、この欄を前にしたとき。 */}
                <Button
                  className="h-auto px-0"
                  size="sm"
                  type="button"
                  variant="link"
                  onClick={() => {
                    clearSignOutError();
                    setIsResetDialogOpen(true);
                  }}
                >
                  パスワードを忘れた場合
                </Button>
              </div>
              <PasswordInput
                aria-describedby={currentPasswordError ? currentPasswordErrorId : undefined}
                aria-invalid={currentPasswordError ? true : undefined}
                autoComplete="current-password"
                id={currentPasswordId}
                maxLength={MAX_PASSWORD_LENGTH}
                minLength={MIN_PASSWORD_LENGTH}
                ref={currentPasswordRef}
                required
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  if (error?.field === "current") setError(null);
                }}
              />
              {currentPasswordError ? (
                <FieldError id={currentPasswordErrorId}>{currentPasswordError}</FieldError>
              ) : null}
            </Field>
            <Field className="min-w-0" data-invalid={newPasswordError ? true : undefined}>
              <FieldLabel htmlFor={newPasswordId}>新しいパスワード</FieldLabel>
              <PasswordInput
                aria-describedby={
                  newPasswordError
                    ? `${newPasswordErrorId} ${newPasswordHintId}`
                    : newPasswordHintId
                }
                aria-invalid={newPasswordError ? true : undefined}
                autoComplete="new-password"
                id={newPasswordId}
                maxLength={MAX_PASSWORD_LENGTH}
                minLength={MIN_PASSWORD_LENGTH}
                ref={newPasswordRef}
                required
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  if (error?.field === "new") setError(null);
                }}
              />
              {newPasswordError ? (
                <FieldError id={newPasswordErrorId}>{newPasswordError}</FieldError>
              ) : null}
              {/* 条件は1つだけなので、強さの目盛りは付けず、満たしたかだけを見せる。 */}
              <p
                className={cn(
                  "flex items-center gap-1.5 text-xs transition-colors",
                  isNewPasswordLongEnough ? "text-brand-sage-dark" : "text-brand-muted",
                )}
                id={newPasswordHintId}
              >
                {isNewPasswordLongEnough ? (
                  <CheckCircle aria-hidden="true" size={14} weight="fill" />
                ) : (
                  <Circle aria-hidden="true" size={14} weight="bold" />
                )}
                {`${MIN_PASSWORD_LENGTH}文字以上`}
              </p>
            </Field>
          </FieldGroup>

          <div className="grid gap-3">
            <p className="text-brand-muted text-sm leading-6">
              変更すると、ほかの端末ではログアウトされます。この端末はログインしたままです。
            </p>
            <Button
              className="w-full sm:w-auto sm:justify-self-start"
              disabled={isSubmitting}
              size="lg"
              type="submit"
            >
              パスワードを変更
            </Button>
          </div>
          {error?.field === "form" ? (
            <SettingsFormMessage tone="error">{error.message}</SettingsFormMessage>
          ) : null}
        </form>
      </div>

      <AlertDialog
        open={isResetDialogOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isSigningOut) {
            setIsResetDialogOpen(false);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>パスワードを再設定しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              再設定はログイン画面で行うため、この端末はいったんログアウトします。メールアドレス宛の確認コードで、新しいパスワードを決められます。再設定すると、ほかの端末でもログアウトされます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {signOutError ? (
            <p className="text-brand-danger text-sm" role="alert">
              {signOutError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSigningOut}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSigningOut}
              onClick={() => void signOutAndGoToLogin({ mode: "reset" })}
            >
              ログアウトして進む
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
