import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SectionHeader } from "../../components/section-header";
import { issueShortcutCredential, shortcutCredentialsQueryKey } from "./api";

/**
 * 連携キーを発行して、ショートカットの追加へ進む。
 * 取り込みはサーバーだけで完結するので、ホーム画面に追加していなくても発行できる（ADR 0025）。
 */
export const LinkThisDevice = () => {
  const iosShareShortcutUrl = import.meta.env.VITE_IOS_SHARE_SHORTCUT_URL;
  const queryClient = useQueryClient();
  const headingId = useId();
  const deviceNameId = useId();
  const [name, setName] = useState("iPhone");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const issueMutation = useMutation({
    mutationFn: () => issueShortcutCredential(name),
    onSuccess: async (result) => {
      setIssuedKey(result.token);
      setMessage(
        "連携キーを発行しました。コピーして、ショートカットを追加するときに聞かれたら貼り付けてください。",
      );
      await queryClient.invalidateQueries({ queryKey: shortcutCredentialsQueryKey });
    },
  });

  const copyKey = async () => {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey);
      setMessage("連携キーをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。表示された連携キーを選択してコピーしてください。");
    }
  };

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="この端末を連携する" />
      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <FieldGroup>
          <Field className="min-w-0">
            <FieldLabel htmlFor={deviceNameId}>端末名</FieldLabel>
            <Input
              id={deviceNameId}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button
          disabled={!name.trim() || issueMutation.isPending}
          onClick={() => issueMutation.mutate()}
        >
          連携キーを発行
        </Button>
      </div>

      {issuedKey ? (
        <div className="mt-4 grid min-w-0 gap-3">
          <Input className="w-full min-w-0" aria-label="連携キー" readOnly value={issuedKey} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={copyKey}>
              連携キーをコピー
            </Button>
            <a
              className={cn(buttonVariants(), "no-underline")}
              href={iosShareShortcutUrl}
              rel="noreferrer"
              target="_blank"
            >
              ショートカットを追加
            </a>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 text-brand-muted text-sm" role="status">
          {message}
        </p>
      ) : null}
      {issueMutation.isError ? (
        <p className="mt-3 text-brand-danger text-sm" role="alert">
          連携キーを発行できませんでした。
        </p>
      ) : null}
    </section>
  );
};
