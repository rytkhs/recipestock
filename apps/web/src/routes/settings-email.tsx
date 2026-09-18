import { type FormEvent, useId, useState } from "react";
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
import { changeEmail, useAuthSession } from "../lib/auth";

export const SettingsEmailRoute = () => {
  const session = useAuthSession();
  const loginMethods = useLoginMethods();
  const currentEmail = session.data?.user.email ?? "";
  const [newEmail, setNewEmail] = useState("");
  const newEmailId = useId();
  // 宛先を出すために、送った先を覚える。入力欄は送信後に空にする。
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSentTo(null);
    setError(null);

    const requestedEmail = newEmail.trim();

    // 同じアドレスはサーバでも断られるが、理由が返らない。ここで止めて、何が起きたかを伝える。
    if (requestedEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setError("今のメールアドレスと同じです。");
      return;
    }

    setIsSubmitting(true);

    try {
      await changeEmail(requestedEmail);
      setNewEmail("");
      setSentTo(requestedEmail);
    } catch {
      setError("メールアドレスを変更できませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const topBar = <SettingsSubpageTopBar title="メールアドレス" />;

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

  const currentEmailBlock = (
    <div className="min-w-0">
      <p className="text-brand-muted text-sm">今のメールアドレス</p>
      <p className="mt-1 break-all font-medium text-base text-brand-ink">{currentEmail}</p>
    </div>
  );

  // Googleだけの人はメールアドレスをログインに使わない。Googleから写したアドレスが、
  // どのGoogleアカウントで入ったかの手がかりになるので、変えるフォームは出さない。
  if (!loginMethods.data.hasPassword) {
    return (
      <section className={settingsPageClass}>
        {topBar}
        <div className={`${settingsPageBodyClass} grid gap-6`}>
          {currentEmailBlock}
          <p className="text-brand-muted text-sm leading-6">
            このアカウントはGoogleでログインしています。メールアドレスはGoogleアカウントのものを使うため、ここでは変更できません。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={settingsPageClass}>
      {topBar}

      <div className={`${settingsPageBodyClass} grid gap-6`}>
        {currentEmailBlock}

        <div className="grid gap-2">
          <p className="text-brand-muted text-sm leading-6">
            新しいメールアドレスに確認メールを送ります。メール内のリンクを開くまで、メールアドレスは今のままです。
          </p>
          {loginMethods.data.hasGoogle ? (
            <p className="text-brand-muted text-sm leading-6">
              Googleアカウントのメールアドレスは変わりません。Googleでのログインは今までどおり使えます。
            </p>
          ) : null}
        </div>

        <form className="grid min-w-0 gap-4" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field className="min-w-0">
              <FieldLabel htmlFor={newEmailId}>新しいメールアドレス</FieldLabel>
              <Input
                id={newEmailId}
                required
                type="email"
                autoComplete="email"
                inputMode="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <Button
            className="w-full sm:w-auto sm:justify-self-start"
            disabled={isSubmitting}
            size="lg"
            type="submit"
          >
            確認メールを送信
          </Button>
          {sentTo ? (
            <SettingsFormMessage tone="success">
              {`${sentTo} 宛に確認メールを送信しました。メール内のリンクを開くと、変更が完了します。それまでは、今のメールアドレスのままです。`}
            </SettingsFormMessage>
          ) : null}
          {error ? <SettingsFormMessage tone="error">{error}</SettingsFormMessage> : null}
        </form>
      </div>
    </section>
  );
};
