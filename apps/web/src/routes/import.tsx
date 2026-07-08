import { Button, Input, Label, TextField } from "@heroui/react";
import { ClipboardText, Link as LinkIcon, X } from "@phosphor-icons/react";
import { type ImportJobSummary } from "@recipestock/schemas";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { createImportUrlJob, getCreateImportUrlJobErrorMessage } from "../features/import-jobs";

export const ImportUrlRoute = () => {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ImportJobSummary | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateUrl = (nextUrl: string) => {
    setUrl(nextUrl);
    setError(null);
    setActiveJob(null);
  };

  const pasteUrl = async () => {
    if (!navigator.clipboard?.readText) {
      setError("クリップボードを読み取れませんでした。");
      setActiveJob(null);
      return;
    }

    try {
      updateUrl((await navigator.clipboard.readText()).trim());
    } catch {
      setError("クリップボードを読み取れませんでした。");
      setActiveJob(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setActiveJob(null);
    setIsSubmitting(true);

    try {
      const response = await createImportUrlJob(url);

      if (response.kind === "existing_active_job") {
        setActiveJob(response.job);
        return;
      }

      await navigate({ to: "/recipes" });
    } catch (submitError) {
      setError(getCreateImportUrlJobErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-10">
      <div className="mb-2 flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-orange-soft text-brand-orange">
          <LinkIcon size={20} weight="bold" />
        </div>
        <div className="min-w-0">
          <h1 className="text-brand-ink font-bold text-2xl">URLから取り込む</h1>
          <p className="text-brand-muted text-sm">
            レシピサイトのURLを入力すると、AIがレシピを自動で取り込みます
          </p>
        </div>
      </div>
      <div className="mt-6 min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
        <form
          className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
          onSubmit={submit}
        >
          <TextField className="min-w-0" isRequired>
            <Label className="text-brand-walnut font-semibold text-sm">URL</Label>
            <Input
              className="w-full min-w-0"
              inputMode="url"
              type="url"
              value={url}
              onChange={(event) => updateUrl(event.target.value)}
            />
          </TextField>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              className="rounded-full border border-brand-line bg-brand-paper px-4 text-brand-walnut font-semibold hover:bg-brand-paper-muted"
              isDisabled={isSubmitting}
              type="button"
              variant="secondary"
              onPress={pasteUrl}
            >
              <ClipboardText size={16} weight="bold" />
              ペースト
            </Button>
            <Button
              className="rounded-full text-brand-muted font-semibold hover:bg-brand-paper-muted hover:text-brand-walnut"
              isDisabled={isSubmitting || url.length === 0}
              type="button"
              variant="ghost"
              onPress={() => updateUrl("")}
            >
              <X size={16} weight="bold" />
              クリア
            </Button>
            <Button
              className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
              isDisabled={isSubmitting}
              type="submit"
              variant="primary"
            >
              取り込む
            </Button>
          </div>
        </form>
        {error ? (
          <div className="mt-4 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
            <p className="break-words text-brand-danger text-sm" role="alert">
              {error}
            </p>
          </div>
        ) : null}
        {activeJob ? (
          <div
            className="mt-4 rounded-[14px] border border-brand-orange/20 bg-brand-orange-soft/40 p-4"
            role="alert"
          >
            <p className="font-semibold text-brand-walnut">
              別のレシピを取り込み中です。しばらく待ってから再度実行してください。
            </p>
            {activeJob.url ? (
              <p className="mt-2 break-all text-brand-muted text-xs">{activeJob.url}</p>
            ) : null}
            <Link
              className="mt-3 inline-flex min-h-9 items-center justify-center rounded-full border border-brand-line bg-brand-paper px-4 font-semibold text-brand-walnut text-sm no-underline hover:bg-brand-paper-muted"
              to="/recipes"
            >
              処理状況を見る
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
};
