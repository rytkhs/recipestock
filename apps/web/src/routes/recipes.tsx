import { Button, Input, Label, TextField } from "@heroui/react";
import { Globe, LockSimple, MagnifyingGlass } from "@phosphor-icons/react";
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
    case "job_timeout":
      return "取り込み処理が時間内に完了しませんでした。再試行してください。";
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
              className="rounded-[14px] border border-brand-sage-soft bg-brand-sage-soft/30 p-4 text-sm"
              key={job.id}
              role="status"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-brand-sage-dark">取り込みが完了しました。</p>
                <div className="flex gap-2">
                  {job.recipeId ? (
                    <Link
                      className="inline-flex min-h-9 items-center justify-center rounded-full bg-brand-sage px-4 font-semibold text-white text-sm hover:bg-brand-sage-dark transition-colors"
                      params={{ recipeId: job.recipeId }}
                      to="/recipes/$recipeId"
                    >
                      開く
                    </Link>
                  ) : null}
                  <Button
                    className="rounded-full"
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
              className="rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-4 text-sm"
              key={job.id}
              role="alert"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-brand-danger">
                  取り込みに失敗しました。{importJobErrorMessage(job)}
                </p>
                <div className="flex gap-2">
                  <Button
                    className="rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
                    isDisabled={!job.url || retryMutation.isPending}
                    size="sm"
                    variant="primary"
                    onPress={() => retryMutation.mutate(job)}
                  >
                    再試行
                  </Button>
                  <Button
                    className="rounded-full"
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
            className="rounded-[14px] border border-brand-line bg-brand-paper p-4 text-sm"
            key={job.id}
            role="status"
          >
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-sage border-t-transparent" />
              <p className="font-semibold text-brand-walnut">取り込み中...</p>
            </div>
            {job.url ? <p className="mt-2 break-all text-brand-muted text-xs">{job.url}</p> : null}
          </div>
        );
      })}
    </div>
  );
};

const SourceIcon = () => {
  return <Globe className="h-3.5 w-3.5 text-brand-wheat" weight="bold" />;
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
    <section className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-10 py-8">
      <form className="mt-2 flex gap-3 items-end" onSubmit={submitSearch}>
        <div className="flex-1 relative">
          <TextField>
            <Label className="sr-only">検索</Label>
            <div className="relative">
              <MagnifyingGlass
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-wheat"
                size={18}
                weight="bold"
              />
              <Input
                className="pl-10"
                placeholder="レシピを検索..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
          </TextField>
        </div>
        <Button
          className="rounded-full bg-brand-paper-raised border border-brand-line text-brand-walnut font-semibold hover:bg-brand-paper-muted"
          type="submit"
          variant="secondary"
        >
          検索
        </Button>
      </form>

      <ImportJobBanner />

      {error ? (
        <div className="mt-6 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-4">
          <p className="text-brand-danger text-sm" role="alert">
            レシピ一覧を読み込めませんでした。
          </p>
        </div>
      ) : null}
      {isFetching && recipes.length === 0 ? (
        <div className="mt-10 flex items-center justify-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-sage border-t-transparent" />
          <p className="text-brand-muted text-sm">読み込み中</p>
        </div>
      ) : null}
      {!isFetching && recipes.length === 0 && !error ? (
        <div className="mt-16 flex flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-sage-soft">
            <MagnifyingGlass size={28} className="text-brand-sage" weight="bold" />
          </div>
          <p className="mt-4 text-brand-walnut font-semibold">レシピがありません</p>
          <p className="mt-1 text-brand-muted text-sm">最初のレシピを追加してみましょう</p>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {recipes.map((recipe) => {
          const content = (
            <>
              <div className="relative aspect-video w-full bg-brand-paper-muted overflow-hidden rounded-t-[20px]">
                {recipe.coverImageUrl ? (
                  <img
                    src={recipe.coverImageUrl}
                    alt={recipe.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="text-brand-line text-4xl">🍳</div>
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h2 className="line-clamp-2 font-bold text-base leading-tight text-brand-ink">
                  {recipe.title}
                </h2>
                <div className="mt-auto pt-3 flex items-center justify-between">
                  {recipe.sourceName ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-paper-muted px-2.5 py-1 text-xs font-medium text-brand-muted">
                      <SourceIcon />
                      {recipe.sourceName}
                    </div>
                  ) : (
                    <div />
                  )}
                  {recipe.locked ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand-line px-2 py-1 font-medium text-brand-muted text-xs">
                      <LockSimple size={12} weight="bold" />
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
                className="flex flex-col overflow-hidden rounded-[20px] border border-brand-line-soft bg-brand-paper opacity-60"
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
              className="group flex flex-col overflow-hidden rounded-[20px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm transition-shadow duration-200 hover:shadow-pantry"
            >
              {content}
            </Link>
          );
        })}
      </div>

      {nextCursor ? (
        <div className="mt-8 flex justify-center">
          <Button
            className="rounded-full bg-brand-paper-raised border border-brand-line text-brand-walnut font-semibold hover:bg-brand-paper-muted"
            isDisabled={isFetching}
            variant="secondary"
            onPress={loadNextPage}
          >
            もっと見る
          </Button>
        </div>
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
    <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-10 py-8">
      <h1 className="text-brand-ink font-bold text-2xl">レシピ作成</h1>
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
      <section className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-10 py-10">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-sage border-t-transparent" />
          <p className="text-brand-muted text-sm">読み込み中</p>
        </div>
      </section>
    );
  }

  if (error || !recipe) {
    return (
      <section className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-10 py-10">
        <h1 className="text-brand-ink font-bold text-2xl">レシピを表示できません</h1>
      </section>
    );
  }

  if (recipe.locked) {
    return (
      <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-10 py-10">
        <div className="flex items-center gap-2">
          <LockSimple size={20} className="text-brand-muted" weight="bold" />
          <h1 className="text-brand-ink font-bold text-2xl">ロック中のレシピ</h1>
        </div>
        <p className="mt-4 text-brand-muted">このレシピの詳細は現在表示できません。</p>
      </article>
    );
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-10 py-8">
      {recipe.content.coverImageUrl ? (
        <img
          alt={recipe.title}
          className="w-full rounded-[20px] object-cover aspect-video shadow-pantry-sm"
          src={recipe.content.coverImageUrl}
        />
      ) : null}

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-brand-ink font-bold text-2xl sm:text-3xl leading-tight">
            {recipe.title}
          </h1>
          {recipe.content.servingsText ? (
            <p className="mt-2 text-brand-muted text-sm">{recipe.content.servingsText}</p>
          ) : null}
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-brand-line bg-brand-paper-raised px-5 font-semibold text-brand-walnut text-sm hover:bg-brand-paper-muted transition-colors"
            params={{ recipeId }}
            to="/recipes/$recipeId/edit"
          >
            編集
          </Link>
          <Button
            className="rounded-full"
            isDisabled={deleteMutation.isPending}
            variant="danger"
            onPress={confirmDelete}
          >
            削除
          </Button>
        </div>
      </div>

      {deleteMutation.error ? (
        <div className="mt-4 rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
          <p className="text-brand-danger text-sm" role="alert">
            レシピを削除できませんでした。
          </p>
        </div>
      ) : null}

      {recipe.content.ingredientGroups.length > 0 ? (
        <section className="mt-8 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm">
          <h2 className="text-brand-walnut font-bold text-lg">材料</h2>
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
              {group.label ? (
                <h3 className="font-semibold text-brand-walnut text-sm">{group.label}</h3>
              ) : null}
              <ul className="mt-2 space-y-1.5">
                {group.ingredients.map((ingredient) => (
                  <li
                    className="flex items-center justify-between border-b border-brand-line-soft/60 pb-1.5 text-sm last:border-0"
                    key={`${ingredient.name}:${ingredient.amount}`}
                  >
                    <span className="text-brand-ink">{ingredient.name}</span>
                    <span className="text-brand-muted font-medium">{ingredient.amount || ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {recipe.content.steps.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-brand-walnut font-bold text-lg">手順</h2>
          <ol className="mt-4 space-y-5">
            {recipe.content.steps.map((step, stepIndex) => (
              <li
                className="flex gap-4"
                key={step.imageKeys.join(":") || step.imageUrls.join(":") || step.text}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-sage text-white text-xs font-bold">
                  {stepIndex + 1}
                </div>
                <div className="flex-1 pt-0.5">
                  {step.text ? (
                    <p className="text-brand-ink text-sm leading-relaxed">{step.text}</p>
                  ) : null}
                  {step.imageUrls.length > 0 ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {step.imageUrls.map((imageUrl, imageIndex) => (
                        <img
                          alt={`手順${stepIndex + 1}の画像${imageIndex + 1}`}
                          className="aspect-video w-full rounded-[14px] object-cover"
                          key={imageUrl}
                          src={imageUrl}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {recipe.content.note ? (
        <section className="mt-8 rounded-[20px] border border-brand-line-soft bg-brand-paper-muted p-5">
          <h2 className="text-brand-walnut font-bold text-lg">メモ</h2>
          <p className="mt-3 whitespace-pre-wrap text-brand-ink text-sm leading-relaxed">
            {recipe.content.note}
          </p>
        </section>
      ) : null}

      {recipe.source.sourceName || recipe.source.sourceUrl ? (
        <section className="mt-8">
          <h2 className="text-brand-walnut font-bold text-lg">出典</h2>
          <div className="mt-3 flex items-center gap-2">
            <Globe size={16} className="text-brand-wheat" weight="bold" />
            <div>
              {recipe.source.sourceName ? (
                <p className="text-brand-ink text-sm font-medium">{recipe.source.sourceName}</p>
              ) : null}
              {recipe.source.sourceUrl ? (
                <a
                  className="break-all text-brand-sage text-sm hover:text-brand-sage-dark transition-colors"
                  href={recipe.source.sourceUrl}
                >
                  {recipe.source.sourceUrl}
                </a>
              ) : null}
            </div>
          </div>
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
      <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-10 py-10">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-sage border-t-transparent" />
          <p className="text-brand-muted text-sm">読み込み中</p>
        </div>
      </section>
    );
  }

  if (error || !recipe || recipe.locked) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-10 py-10">
        <h1 className="text-brand-ink font-bold text-2xl">レシピを編集できません</h1>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-10 py-8">
      <h1 className="text-brand-ink font-bold text-2xl">レシピ編集</h1>
      <RecipeDraftForm
        key={recipe.id}
        coverImagePreviewUrl={recipe.content.coverImageUrl}
        defaultValues={recipeDetailToFormValues(recipe)}
        submitError={submitError}
        submitLabel="更新"
        stepImagePreviewUrls={recipe.content.steps.map((step) => step.imageUrls)}
        onSubmit={onSubmit}
      />
    </section>
  );
};
