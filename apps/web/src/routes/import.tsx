import { Button, Input, Label, TextField } from "@heroui/react";
import {
  type CreateRecipeResponse,
  type ImportUrlResponse,
  importUrlResponseSchema,
  type RecipeSourceDraft,
} from "@recipestock/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import {
  formValuesToCreateRecipeRequest,
  RecipeDraftForm,
  type RecipeDraftFormValues,
  recipeDraftContentToFormValues,
} from "../features/recipe-draft";
import { ApiClientError, parseApiResponse } from "../lib/api";

const importDraftStorageKey = "recipestock.import.url.result";

const saveImportResult = (result: ImportUrlResponse) => {
  sessionStorage.setItem(importDraftStorageKey, JSON.stringify(result));
};

const loadImportResult = () => {
  const raw = sessionStorage.getItem(importDraftStorageKey);

  if (!raw) {
    return null;
  }

  try {
    return importUrlResponseSchema.parse(JSON.parse(raw));
  } catch {
    sessionStorage.removeItem(importDraftStorageKey);
    return null;
  }
};

const clearImportResult = () => {
  sessionStorage.removeItem(importDraftStorageKey);
};

const importUrl = async (url: string) =>
  parseApiResponse<ImportUrlResponse>(
    fetch("/api/import/url", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );

const postRecipe = async (values: RecipeDraftFormValues, source: RecipeSourceDraft) =>
  parseApiResponse<CreateRecipeResponse>(
    fetch("/api/recipes", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formValuesToCreateRecipeRequest(values, source)),
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
      const result = await importUrl(url);
      saveImportResult(result);
      await navigate({ to: "/import/confirm" });
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

export const ImportConfirmRoute = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<ImportUrlResponse | null>(() => loadImportResult());
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setResult(loadImportResult());
  }, []);

  if (!result) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="font-semibold text-3xl">取り込み確認</h1>
        <p className="mt-4 text-default-600">確認できる取り込み結果がありません。</p>
        <Link className="mt-6 inline-flex text-accent" to="/import/url">
          URL入力へ戻る
        </Link>
      </section>
    );
  }

  const onSubmit = async (values: RecipeDraftFormValues) => {
    setSubmitError(null);

    try {
      const response = await postRecipe(values, result.source);
      clearImportResult();
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      await navigate({ to: "/recipes/$recipeId", params: { recipeId: response.recipe.id } });
    } catch {
      setSubmitError("レシピを保存できませんでした。");
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="font-semibold text-3xl">取り込み確認</h1>
      {result.warnings.length > 0 ? (
        <div className="mt-4 rounded-lg border border-warning bg-warning-50 p-3 text-warning-700 text-sm">
          {result.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      <RecipeDraftForm
        defaultValues={recipeDraftContentToFormValues(result.recipeDraftContent)}
        submitError={submitError}
        submitLabel="保存"
        onSubmit={onSubmit}
      />
    </section>
  );
};
