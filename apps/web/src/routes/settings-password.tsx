import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  SettingsSubpageTopBar,
  settingsPageBodyClass,
  settingsPageClass,
} from "../features/settings/settings-page";
import { changePassword } from "../lib/auth";

export const SettingsPasswordRoute = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const currentPasswordId = useId();
  const newPasswordId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setIsSubmitting(true);

    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setMessage("パスワードを変更しました。");
    } catch {
      setError("パスワードを変更できませんでした。入力内容を確認してください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={settingsPageClass}>
      <SettingsSubpageTopBar title="パスワード" />

      <form className={`${settingsPageBodyClass} grid min-w-0 gap-4`} onSubmit={handleSubmit}>
        <FieldGroup>
          <Field className="min-w-0">
            <FieldLabel htmlFor={currentPasswordId}>現在のパスワード</FieldLabel>
            <Input
              id={currentPasswordId}
              required
              type="password"
              autoComplete="current-password"
              maxLength={128}
              minLength={8}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor={newPasswordId}>新しいパスワード</FieldLabel>
            <Input
              id={newPasswordId}
              required
              type="password"
              autoComplete="new-password"
              maxLength={128}
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
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
    </section>
  );
};
