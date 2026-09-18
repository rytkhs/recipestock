import { CaretLeft, ClipboardText, X } from "@phosphor-icons/react";
import { extractFirstUrl } from "@recipestock/shared";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScreenTopBar, ScreenTopBarIconButton } from "../components/screen-top-bar";
import { PlanLink } from "../features/billing/plan-link";
import { isResolvedByUpgrade } from "../features/billing/plan-state";
import { createImportUrlJob, getCreateImportUrlJobErrorMessage } from "../features/import-jobs";
import { readRecipeListFilters } from "../features/recipes/list-search";
import { ApiClientError } from "../lib/api";
import { useViewer } from "../lib/viewer";

export type ImportUrlSearch = {
  text?: string;
  title?: string;
  url?: string;
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
  // 上限のエラーのうち、プランを変えれば直るものにだけプランのページへの入口を添える。
  const [error, setError] = useState<{ message: string; showsPlanLink?: boolean } | null>(null);
  const viewer = useViewer({ enabled: true });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const urlId = useId();

  const updateUrl = (nextUrl: string) => {
    setUrl(nextUrl);
    setError(null);
  };

  const pasteUrl = async () => {
    if (!navigator.clipboard?.readText) {
      setError({ message: "クリップボードを読み取れませんでした。" });
      return;
    }

    try {
      updateUrl((await navigator.clipboard.readText()).trim());
    } catch {
      setError({ message: "クリップボードを読み取れませんでした。" });
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
      setError({
        message: getCreateImportUrlJobErrorMessage(submitError),
        showsPlanLink:
          submitError instanceof ApiClientError &&
          isResolvedByUpgrade(submitError.code, viewer.data?.plan),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-0 pb-10 sm:px-6 lg:px-10">
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton
            aria-label="レシピ一覧へ戻る"
            onPress={() => {
              void navigate({ to: "/recipes", search: readRecipeListFilters() });
            }}
          >
            <CaretLeft size={21} weight="bold" />
          </ScreenTopBarIconButton>
        }
        title="URLから取り込む"
      />

      <div className="mt-4 px-4 sm:mt-6 sm:px-0">
        <p className="text-brand-muted text-sm">
          レシピのページのURLを入力すると、材料と作り方を読み取って保存します
        </p>
        <div className="mt-4 min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
          <form className="grid min-w-0 gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field className="min-w-0">
                <div className="mb-1 flex min-w-0 items-center justify-between gap-3">
                  <FieldLabel htmlFor={urlId}>URL</FieldLabel>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      aria-label="ペースト"
                      disabled={isSubmitting}
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={pasteUrl}
                    >
                      <ClipboardText data-icon="inline-start" weight="bold" />
                      <span>ペースト</span>
                    </Button>
                    <Button
                      aria-label="クリア"
                      disabled={isSubmitting || url.length === 0}
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => updateUrl("")}
                    >
                      <X data-icon="inline-start" weight="bold" />
                      <span>クリア</span>
                    </Button>
                  </div>
                </div>
                <Input
                  id={urlId}
                  inputMode="url"
                  required
                  type="url"
                  value={url}
                  onChange={(event) => updateUrl(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <div className="flex justify-end">
              <Button disabled={isSubmitting} type="submit">
                取り込む
              </Button>
            </div>
          </form>
          {error ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
              <p className="break-words text-brand-danger text-sm" role="alert">
                {error.message}
              </p>
              {error.showsPlanLink ? <PlanLink /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
