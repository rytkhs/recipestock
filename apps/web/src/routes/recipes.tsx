import { Button, Input, TextField } from "@heroui/react";
import { Globe } from "@phosphor-icons/react";
import {
  type CreateRecipeResponse,
  type DeleteRecipeResponse,
  type GetRecipeResponse,
  type ImportJobSummary,
  type ListRecipesResponse,
  type RecentImportJobsResponse,
  type UpdateRecipeResponse,
} from "@recipestock/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import {
  createEmptyRecipeDraftFormValues,
  formValuesToCreateRecipeRequest,
  formValuesToRecipeDraftContent,
  RecipeDraftForm,
  type RecipeDraftFormValues,
  recipeDetailToFormValues,
} from "../features/recipe-draft";
import { recipesQueryKeys } from "../features/recipes";
import { ApiClientError, api, parseApiResponse } from "../lib/api";

const postRecipe = async (values: RecipeDraftFormValues) => {
  return parseApiResponse<CreateRecipeResponse>(
    api.api.recipes.$post({
      json: formValuesToCreateRecipeRequest(values),
    }),
  );
};

const putRecipe = async (recipeId: string, values: RecipeDraftFormValues) => {
  return parseApiResponse<UpdateRecipeResponse>(
    fetch(`/api/recipes/${encodeURIComponent(recipeId)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: formValuesToRecipeDraftContent(values) }),
    }),
  );
};

const deleteRecipe = async (recipeId: string) => {
  return parseApiResponse<DeleteRecipeResponse>(
    fetch(`/api/recipes/${encodeURIComponent(recipeId)}`, {
      method: "DELETE",
      credentials: "include",
    }),
  );
};

const recipeMutationErrorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof ApiClientError)) {
    return fallback;
  }

  if (error.code === "recipe_limit_exceeded") {
    return "保存できるレシピ数の上限に達しています。";
  }

  if (error.code === "image_finalize_failed") {
    return "画像を保存できませんでした。再度アップロードしてください。";
  }

  return fallback;
};

const fetchRecipe = async (recipeId: string) => {
  const body = await parseApiResponse<GetRecipeResponse>(
    api.api.recipes[":recipeId"].$get({
      param: { recipeId },
    }),
  );
  return body.recipe;
};

const fetchRecipes = async ({ cursor, query }: { cursor?: string | null; query?: string }) => {
  return parseApiResponse<ListRecipesResponse>(
    api.api.recipes.$get({
      query: {
        limit: "20",
        ...(query ? { q: query } : {}),
        ...(cursor ? { cursor } : {}),
      },
    }),
  );
};

const fetchRecentImportJobs = async () =>
  parseApiResponse<RecentImportJobsResponse>(
    fetch("/api/import/jobs/recent", {
      method: "GET",
      credentials: "include",
    }),
  );

const dismissImportJob = async (jobId: string) =>
  parseApiResponse<{ job: ImportJobSummary }>(
    fetch(`/api/import/jobs/${encodeURIComponent(jobId)}/dismiss`, {
      method: "PATCH",
      credentials: "include",
    }),
  );

const createImportUrlJob = async (url: string) =>
  parseApiResponse<{ job: ImportJobSummary }>(
    fetch("/api/import/url/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );

const hasActiveImportJob = (jobs: ImportJobSummary[]) =>
  jobs.some((job) => job.status === "queued" || job.status === "running");

const importJobErrorMessage = (job: ImportJobSummary) => {
  switch (job.errorCode) {
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
      return "解析結果を保存できませんでした。";
    case "recipe_limit_exceeded":
      return "保存できるレシピ数の上限に達しています。";
    default:
      return "URLを取り込めませんでした。";
  }
};

const ImportJobBanner = () => {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["importJobs", "recent"],
    queryFn: fetchRecentImportJobs,
    refetchInterval: (query) => (hasActiveImportJob(query.state.data?.jobs ?? []) ? 2500 : false),
  });
  const dismissMutation = useMutation({
    mutationFn: dismissImportJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["importJobs", "recent"] });
    },
  });
  const retryMutation = useMutation({
    mutationFn: async (job: ImportJobSummary) => {
      if (!job.url) {
        throw new Error("Import job URL is missing.");
      }

      await dismissImportJob(job.id);
      return createImportUrlJob(job.url);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["importJobs", "recent"] });
    },
  });
  const jobs = data?.jobs ?? [];

  useEffect(() => {
    if (jobs.some((job) => job.status === "succeeded")) {
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
    }
  }, [jobs, queryClient]);

  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 grid gap-3">
      {jobs.map((job) => {
        if (job.status === "succeeded") {
          return (
            <div
              className="rounded-lg border border-success bg-success-50 p-4 text-sm"
              key={job.id}
              role="status"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-medium text-success-700">取り込みが完了しました。</p>
                <div className="flex gap-2">
                  {job.recipeId ? (
                    <Link
                      className="inline-flex min-h-9 items-center justify-center rounded-lg bg-accent px-3 font-semibold text-accent-foreground text-sm"
                      params={{ recipeId: job.recipeId }}
                      to="/recipes/$recipeId"
                    >
                      開く
                    </Link>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => dismissMutation.mutate(job.id)}
                  >
                    閉じる
                  </Button>
                </div>
              </div>
            </div>
          );
        }

        if (job.status === "failed") {
          return (
            <div
              className="rounded-lg border border-danger bg-danger-50 p-4 text-danger-700 text-sm"
              key={job.id}
              role="alert"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-medium">取り込みに失敗しました。{importJobErrorMessage(job)}</p>
                <div className="flex gap-2">
                  <Button
                    isDisabled={!job.url || retryMutation.isPending}
                    size="sm"
                    variant="primary"
                    onPress={() => retryMutation.mutate(job)}
                  >
                    再試行
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => dismissMutation.mutate(job.id)}
                  >
                    閉じる
                  </Button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            className="rounded-lg border border-border bg-surface p-4 text-default-700 text-sm"
            key={job.id}
            role="status"
          >
            <p className="font-medium">取り込み中...</p>
            {job.url ? <p className="mt-1 break-all text-default-500">{job.url}</p> : null}
          </div>
        );
      })}
    </div>
  );
};

const SourceIcon = () => {
  return <Globe className="h-4 w-4 text-default-500" />;
};

export const RecipesIndexRoute = () => {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedPages, setLoadedPages] = useState<ListRecipesResponse[]>([]);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: recipesQueryKeys.list(query, cursor),
    queryFn: () => fetchRecipes({ query, cursor }),
  });
  const activePages = cursor ? loadedPages.concat(data ? [data] : []) : data ? [data] : [];
  const recipes = activePages.flatMap((page) => page.items);
  const nextCursor = activePages.at(-1)?.nextCursor ?? null;

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoadedPages([]);
    setCursor(null);
    setQuery(searchInput.trim());
  };

  const loadNextPage = () => {
    if (data?.nextCursor) {
      setLoadedPages((pages) => pages.concat(data));
      setCursor(data.nextCursor);
      return;
    }

    if (nextCursor) {
      void refetch();
    }
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <form
        className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        onSubmit={submitSearch}
      >
        <TextField>
          <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </TextField>
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>

      <ImportJobBanner />

      {error ? (
        <p className="mt-6 text-danger" role="alert">
          レシピ一覧を読み込めませんでした。
        </p>
      ) : null}
      {isFetching && recipes.length === 0 ? (
        <p className="mt-6 text-default-600">読み込み中</p>
      ) : null}
      {!isFetching && recipes.length === 0 && !error ? (
        <p className="mt-6 text-default-600">レシピがありません。</p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {recipes.map((recipe) => {
          const content = (
            <>
              <div className="relative aspect-video w-full bg-default-100 overflow-hidden">
                {recipe.coverImageUrl ? (
                  <img
                    src={recipe.coverImageUrl}
                    alt={recipe.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h2 className="line-clamp-2 font-bold text-lg leading-tight text-default-foreground">
                  {recipe.title}
                </h2>
                <div className="mt-auto pt-4 flex items-center justify-between">
                  {recipe.sourceName ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-default-100 px-2.5 py-1 text-xs font-medium text-default-600">
                      <SourceIcon />
                      {recipe.sourceName}
                    </div>
                  ) : (
                    <div />
                  )}
                  {recipe.locked ? (
                    <span className="inline-flex rounded-md border border-border px-2 py-1 font-medium text-default-600 text-xs">
                      ロック中
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          );

          if (recipe.locked) {
            return (
              <div
                key={recipe.id}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface opacity-75"
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={recipe.id}
              to="/recipes/$recipeId"
              params={{ recipeId: recipe.id }}
              className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-shadow hover:shadow-md"
            >
              {content}
            </Link>
          );
        })}
      </div>

      {nextCursor ? (
        <Button className="mt-6" isDisabled={isFetching} variant="secondary" onPress={loadNextPage}>
          もっと見る
        </Button>
      ) : null}
    </section>
  );
};

export const NewRecipeRoute = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: RecipeDraftFormValues) => {
    setSubmitError(null);

    try {
      const response = await postRecipe(values);
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      await navigate({ to: "/recipes/$recipeId", params: { recipeId: response.recipe.id } });
    } catch (error) {
      setSubmitError(recipeMutationErrorMessage(error, "レシピを保存できませんでした。"));
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="font-semibold text-3xl">レシピ作成</h1>
      <RecipeDraftForm
        defaultValues={createEmptyRecipeDraftFormValues()}
        submitError={submitError}
        submitLabel="保存"
        onSubmit={onSubmit}
      />
    </section>
  );
};

export const RecipeDetailRoute = () => {
  const { recipeId } = useParams({ from: "/recipes/$recipeId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => deleteRecipe(recipeId),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: recipesQueryKeys.detail(recipeId) });
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      await navigate({ to: "/recipes" });
    },
  });
  const {
    data: recipe,
    error,
    isLoading,
  } = useQuery({
    queryKey: recipesQueryKeys.detail(recipeId),
    queryFn: () => fetchRecipe(recipeId),
  });

  const confirmDelete = () => {
    if (window.confirm("このレシピを削除しますか？")) {
      deleteMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="text-default-600">読み込み中</p>
      </section>
    );
  }

  if (error || !recipe) {
    return (
      <section className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="font-semibold text-3xl">レシピを表示できません</h1>
      </section>
    );
  }

  if (recipe.locked) {
    return (
      <article className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="font-semibold text-3xl">ロック中のレシピ</h1>
        <p className="mt-4 text-default-600">このレシピの詳細は現在表示できません。</p>
      </article>
    );
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="font-semibold text-3xl">{recipe.title}</h1>
        <div className="flex gap-2">
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-4 font-semibold text-sm"
            params={{ recipeId }}
            to="/recipes/$recipeId/edit"
          >
            編集
          </Link>
          <Button isDisabled={deleteMutation.isPending} variant="danger" onPress={confirmDelete}>
            削除
          </Button>
        </div>
      </div>
      {deleteMutation.error ? (
        <p className="mt-4 text-danger" role="alert">
          レシピを削除できませんでした。
        </p>
      ) : null}
      {recipe.content.servingsText ? (
        <p className="mt-3 text-default-600">{recipe.content.servingsText}</p>
      ) : null}

      {recipe.content.coverImageUrl ? (
        <img
          alt={recipe.title}
          className="mt-6 aspect-video w-full rounded-lg object-cover"
          src={recipe.content.coverImageUrl}
        />
      ) : null}

      {recipe.content.ingredientGroups.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-semibold text-xl">材料</h2>
          {recipe.content.ingredientGroups.map((group) => (
            <div
              className="mt-4"
              key={
                group.label ??
                group.ingredients
                  .map((ingredient) => `${ingredient.name}:${ingredient.amount}`)
                  .join("|")
              }
            >
              {group.label ? <h3 className="font-medium">{group.label}</h3> : null}
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {group.ingredients.map((ingredient) => (
                  <li key={`${ingredient.name}:${ingredient.amount}`}>
                    {ingredient.name}
                    {ingredient.amount ? ` ${ingredient.amount}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {recipe.content.steps.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-semibold text-xl">手順</h2>
          <ol className="mt-3 list-decimal space-y-4 pl-5">
            {recipe.content.steps.map((step, stepIndex) => (
              <li key={step.imageKeys.join(":") || step.imageUrls.join(":") || step.text}>
                {step.text ? <p>{step.text}</p> : null}
                {step.imageUrls.length > 0 ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {step.imageUrls.map((imageUrl, imageIndex) => (
                      <img
                        alt={`手順${stepIndex + 1}の画像${imageIndex + 1}`}
                        className="aspect-video w-full rounded-lg object-cover"
                        key={imageUrl}
                        src={imageUrl}
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {recipe.content.note ? (
        <section className="mt-8">
          <h2 className="font-semibold text-xl">メモ</h2>
          <p className="mt-3 whitespace-pre-wrap text-default-700">{recipe.content.note}</p>
        </section>
      ) : null}

      {recipe.source.sourceName || recipe.source.sourceUrl ? (
        <section className="mt-8">
          <h2 className="font-semibold text-xl">出典</h2>
          {recipe.source.sourceName ? <p className="mt-3">{recipe.source.sourceName}</p> : null}
          {recipe.source.sourceUrl ? (
            <a className="break-all text-accent" href={recipe.source.sourceUrl}>
              {recipe.source.sourceUrl}
            </a>
          ) : null}
        </section>
      ) : null}
    </article>
  );
};

export const EditRecipeRoute = () => {
  const { recipeId } = useParams({ from: "/recipes/$recipeId/edit" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    data: recipe,
    error,
    isLoading,
  } = useQuery({
    queryKey: recipesQueryKeys.detail(recipeId),
    queryFn: () => fetchRecipe(recipeId),
  });

  const onSubmit = async (values: RecipeDraftFormValues) => {
    setSubmitError(null);

    let response: UpdateRecipeResponse;
    try {
      response = await putRecipe(recipeId, values);
    } catch (error) {
      setSubmitError(recipeMutationErrorMessage(error, "レシピを更新できませんでした。"));
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["recipes"] });
    queryClient.removeQueries({ queryKey: recipesQueryKeys.detail(recipeId) });
    await navigate({ to: "/recipes/$recipeId", params: { recipeId: response.recipe.id } });
  };

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-10">
        <p className="text-default-600">読み込み中</p>
      </section>
    );
  }

  if (error || !recipe || recipe.locked) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="font-semibold text-3xl">レシピを編集できません</h1>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="font-semibold text-3xl">レシピ編集</h1>
      <RecipeDraftForm
        key={recipe.id}
        defaultValues={recipeDetailToFormValues(recipe)}
        submitError={submitError}
        submitLabel="更新"
        onSubmit={onSubmit}
      />
    </section>
  );
};
