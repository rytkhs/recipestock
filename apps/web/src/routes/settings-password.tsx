import { type FormEvent, useId, useState } from "react";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConnectionUnavailable } from "../components/connection-unavailable";
import { SettingsPageSkeleton } from "../components/loading";
import { useLoginMethods } from "../features/settings/login-methods";
import {
  SettingsFormMessage,
  SettingsSubpageTopBar,
  settingsPageBodyClass,
  settingsPageClass,
} from "../features/settings/settings-page";
import { useSignOut } from "../features/settings/use-sign-out";
import { AuthRequestError, changePassword } from "../lib/auth";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// 直せる失敗は、何を直すかまで伝える。それ以外は同じ文言にまとめる。
const changePasswordErrorMessage = (error: unknown) => {
  if (error instanceof AuthRequestError) {
    if (error.code === "INVALID_PASSWORD") {
      return "現在のパスワードが正しくありません。";
    }
    if (error.code === "PASSWORD_TOO_SHORT") {
      return `新しいパスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`;
    }
    if (error.code === "PASSWORD_TOO_LONG") {
      return `新しいパスワードは${MAX_PASSWORD_LENGTH}文字以内にしてください。`;
    }
  }

  return "パスワードを変更できませんでした。時間をおいて再度お試しください。";
};

export const SettingsPasswordRoute = () => {
  const loginMethods = useLoginMethods();
  const { clearSignOutError, isSigningOut, signOutAndGoToLogin, signOutError } = useSignOut();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const currentPasswordId = useId();
  const newPasswordId = useId();
  const newPasswordHintId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setMessage("パスワードを変更しました。ほかの端末ではログアウトされました。");
    } catch (submitError) {
      setError(changePasswordErrorMessage(submitError));
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

  return (
    <section className={settingsPageClass}>
      {topBar}

      <div className={`${settingsPageBodyClass} grid gap-6`}>
        <p className="text-brand-muted text-sm leading-6">
          パスワードを変更すると、ほかの端末ではログアウトされます。この端末はログインしたままです。
        </p>

        <form className="grid min-w-0 gap-4" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field className="min-w-0">
              <FieldLabel htmlFor={currentPasswordId}>現在のパスワード</FieldLabel>
              <Input
                id={currentPasswordId}
                required
                type="password"
                autoComplete="current-password"
                maxLength={MAX_PASSWORD_LENGTH}
                minLength={MIN_PASSWORD_LENGTH}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>
            <Field className="min-w-0">
              <FieldLabel htmlFor={newPasswordId}>新しいパスワード</FieldLabel>
              <Input
                id={newPasswordId}
                required
                aria-describedby={newPasswordHintId}
                type="password"
                autoComplete="new-password"
                maxLength={MAX_PASSWORD_LENGTH}
                minLength={MIN_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <p className="text-brand-muted text-xs" id={newPasswordHintId}>
                {`${MIN_PASSWORD_LENGTH}文字以上`}
              </p>
            </Field>
          </FieldGroup>
          <Button
            className="w-full sm:w-auto sm:justify-self-start"
            disabled={isSubmitting}
            size="lg"
            type="submit"
          >
            パスワードを変更
          </Button>
          {message ? <SettingsFormMessage tone="success">{message}</SettingsFormMessage> : null}
          {error ? <SettingsFormMessage tone="error">{error}</SettingsFormMessage> : null}
        </form>

        <div>
          <Button
            className="px-0"
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
