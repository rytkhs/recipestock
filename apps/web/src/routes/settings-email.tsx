import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SettingsSubpageTopBar,
  settingsPageBodyClass,
  settingsPageClass,
} from "../features/settings/settings-page";
import { changeEmail, useAuthSession } from "../lib/auth";

export const SettingsEmailRoute = () => {
  const session = useAuthSession();
  const [newEmail, setNewEmail] = useState("");
  const newEmailId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    try {
      await changeEmail(newEmail);
      setNewEmail("");
      setMessage("確認メールを送信しました。");
    } catch {
      setError("メールアドレスを変更できませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={settingsPageClass}>
      <SettingsSubpageTopBar title="メールアドレス" />

      <div className={`${settingsPageBodyClass} grid gap-6`}>
        <div className="min-w-0">
          <p className="text-brand-muted text-sm">今のメールアドレス</p>
          <p className="mt-1 break-all font-medium text-base text-brand-ink">
            {session.data?.user.email ?? ""}
          </p>
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
          {message ? (
            <div className="rounded-[14px] border border-brand-sage-soft bg-brand-sage-soft/30 p-3">
              <p className="font-medium text-brand-sage-dark text-sm" role="status">
                {message}
              </p>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
              <p className="text-brand-danger text-sm" role="alert">
                {error}
              </p>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
};
