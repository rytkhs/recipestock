import { Button, Input, Label, TextField } from "@heroui/react";
import { Link as LinkIcon } from "@phosphor-icons/react";
import { type CreateImportUrlJobResponse } from "@recipestock/schemas";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ApiClientError, parseApiResponse } from "../lib/api";

const createImportUrlJob = async (url: string) =>
  parseApiResponse<CreateImportUrlJobResponse>(
    fetch("/api/import/url/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );

const importErrorMessage = (error: unknown) => {
  if (!(error instanceof ApiClientError)) {
    return "URLを取り込めませんでした。";
  }

  switch (error.code) {
    case "invalid_url":
      return "URLを確認してください。";
    case "fetch_failed":
      return "ページを取得できませんでした。";
    case "unsupported_page":
      return "このページは取り込みに対応していません。";
    case "extraction_failed":
      return "レシピ本文を見つけられませんでした。";
    case "ai_usage_limit_exceeded":
      return "今月のAI利用回数の上限に達しています。";
    case "ai_timeout":
      return "タイムアウトしました。";
    case "ai_schema_invalid":
      return "結果を読み取れませんでした。";
    case "recipe_limit_exceeded":
      return "保存できるレシピ数の上限に達しています。";
    default:
      return "URLを取り込めませんでした。";
  }
};

export const ImportUrlRoute = () => {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await createImportUrlJob(url);
      await navigate({ to: "/recipes" });
    } catch (submitError) {
      setError(importErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-10 py-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-orange-soft text-brand-orange">
          <LinkIcon size={20} weight="bold" />
        </div>
        <div>
          <h1 className="text-brand-ink font-bold text-2xl">URLから取り込む</h1>
          <p className="text-brand-muted text-sm">
            レシピサイトのURLを入力すると、AIがレシピを自動で取り込みます
          </p>
        </div>
      </div>
      <div className="mt-6 rounded-[20px] border border-brand-line-soft bg-brand-paper p-6 shadow-pantry-sm">
        <form
          className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
          onSubmit={submit}
        >
          <TextField isRequired>
            <Label className="text-brand-walnut font-semibold text-sm">URL</Label>
            <Input
              inputMode="url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </TextField>
          <Button
            className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
            isDisabled={isSubmitting}
            type="submit"
            variant="primary"
          >
            取り込む
          </Button>
        </form>
        {error ? (
          <div className="mt-4 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
            <p className="text-brand-danger text-sm" role="alert">
              {error}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
};
