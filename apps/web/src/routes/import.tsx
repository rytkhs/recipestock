import { Button, Input, Label, TextField } from "@heroui/react";
import { type CreateImportUrlJobResponse } from "@recipestock/schemas";
import { Link, useNavigate } from "@tanstack/react-router";
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

export const ImportIndexRoute = () => (
  <section className="mx-auto w-full max-w-5xl px-6 py-10">
    <h1 className="font-semibold text-3xl">Import</h1>
    <div className="mt-6">
      <Link
        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 font-semibold text-accent-foreground text-sm"
        to="/import/url"
      >
        URLから取り込む
      </Link>
    </div>
  </section>
);

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
    <section className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="font-semibold text-3xl">URLから取り込む</h1>
      <form
        className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        onSubmit={submit}
      >
        <TextField isRequired>
          <Label>URL</Label>
          <Input
            inputMode="url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </TextField>
        <Button isDisabled={isSubmitting} type="submit" variant="primary">
          取り込む
        </Button>
      </form>
      {error ? (
        <p className="mt-4 text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
