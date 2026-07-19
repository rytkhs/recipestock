import { Button, Input, Label, TextField } from "@heroui/react";
import { ClipboardText, Link as LinkIcon, X } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { createImportUrlJob, getCreateImportUrlJobErrorMessage } from "../features/import-jobs";

export type ImportUrlSearch = {
  text?: string;
  title?: string;
  url?: string;
};

const trailingUrlDelimiterPattern = /[.,!?:;。、！？：；>\]}）］｝】」』》〉]+$/u;

const trimTrailingUrlDelimiters = (url: string) => {
  let trimmedUrl = url.replace(trailingUrlDelimiterPattern, "");
  const openingParentheses = [...trimmedUrl].filter((character) => character === "(").length;
  let closingParentheses = [...trimmedUrl].filter((character) => character === ")").length;

  while (trimmedUrl.endsWith(")") && closingParentheses > openingParentheses) {
    trimmedUrl = trimmedUrl.slice(0, -1).replace(trailingUrlDelimiterPattern, "");
    closingParentheses -= 1;
  }

  return trimmedUrl;
};

const extractFirstUrl = (text: string) => {
  const candidate = text.match(/https?:\/\/\S+/i)?.[0];
  return candidate ? trimTrailingUrlDelimiters(candidate) : "";
};

export const getInitialImportUrl = ({ text, url }: ImportUrlSearch) => {
  const sharedUrl = url?.trim();

  if (sharedUrl) {
    return sharedUrl;
  }

  return text ? extractFirstUrl(text) : "";
};

export const ImportUrlRoute = ({ search = {} }: { search?: ImportUrlSearch }) => {
  const navigate = useNavigate();
  const [url, setUrl] = useState(() => getInitialImportUrl(search));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateUrl = (nextUrl: string) => {
    setUrl(nextUrl);
    setError(null);
  };

  const pasteUrl = async () => {
    if (!navigator.clipboard?.readText) {
      setError("クリップボードを読み取れませんでした。");
      return;
    }

    try {
      updateUrl((await navigator.clipboard.readText()).trim());
    } catch {
      setError("クリップボードを読み取れませんでした。");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await createImportUrlJob(url);

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
        <form className="grid min-w-0 gap-4" onSubmit={submit}>
          <TextField className="min-w-0" isRequired>
            <div className="mb-1 flex min-w-0 items-center justify-between gap-3">
              <Label className="text-brand-walnut font-semibold text-sm">URL</Label>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  aria-label="ペースト"
                  className="h-7 min-h-7 rounded-full border border-brand-line bg-brand-paper px-2 text-brand-walnut text-xs hover:bg-brand-paper-muted"
                  isDisabled={isSubmitting}
                  size="sm"
                  type="button"
                  variant="secondary"
                  onPress={pasteUrl}
                >
                  <ClipboardText size={14} weight="bold" />
                  <span>ペースト</span>
                </Button>
                <Button
                  aria-label="クリア"
                  className="h-7 min-h-7 rounded-full px-2 text-brand-muted text-xs hover:bg-brand-paper-muted hover:text-brand-walnut"
                  isDisabled={isSubmitting || url.length === 0}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onPress={() => updateUrl("")}
                >
                  <X size={14} weight="bold" />
                  <span>クリア</span>
                </Button>
              </div>
            </div>
            <div className="min-w-0">
              <Input
                className="w-full min-w-0"
                inputMode="url"
                type="url"
                value={url}
                onChange={(event) => updateUrl(event.target.value)}
              />
            </div>
          </TextField>
          <div className="flex justify-end">
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
      </div>
    </section>
  );
};
