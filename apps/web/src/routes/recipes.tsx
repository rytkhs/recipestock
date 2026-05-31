import { Button, Input, Label, TextField } from "@heroui/react";
import {
  type CreateRecipeResponse,
  type DeleteRecipeResponse,
  type ListRecipesResponse,
  type RecipeDetail,
  type UpdateRecipeResponse,
} from "@recipestock/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
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
  const body = await parseApiResponse<{ recipe: RecipeDetail }>(
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-semibold text-3xl">Recipes</h1>
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 font-semibold text-accent-foreground text-sm"
          to="/recipes/new"
        >
          新規作成
        </Link>
      </div>

      <form
        className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        onSubmit={submitSearch}
      >
        <TextField>
          <Label>検索</Label>
          <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </TextField>
        <Button type="submit" variant="secondary">
          検索
        </Button>
      </form>

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

      <div className="mt-6 grid gap-3">
        {recipes.map((recipe) => (
          <article className="rounded-lg border border-border bg-surface p-4" key={recipe.id}>
            <h2 className="font-semibold text-xl">
              <Link
                className="hover:text-accent"
                params={{ recipeId: recipe.id }}
                to="/recipes/$recipeId"
              >
                {recipe.title}
              </Link>
            </h2>
            {recipe.sourceName ? (
              <p className="mt-2 text-default-600">{recipe.sourceName}</p>
            ) : null}
            <p className="mt-1 text-default-500 text-sm">
              {new Date(recipe.updatedAt).toLocaleDateString("ja-JP")}
            </p>
          </article>
        ))}
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
              <li key={step.imageKey ?? step.imageUrl ?? step.text}>
                {step.text ? <p>{step.text}</p> : null}
                {step.imageUrl ? (
                  <img
                    alt={`手順${stepIndex + 1}`}
                    className="mt-3 aspect-video w-full rounded-lg object-cover"
                    src={step.imageUrl}
                  />
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

    try {
      const response = await putRecipe(recipeId, values);
      queryClient.setQueryData(recipesQueryKeys.detail(recipeId), response.recipe);
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
      await navigate({ to: "/recipes/$recipeId", params: { recipeId: response.recipe.id } });
    } catch (error) {
      setSubmitError(recipeMutationErrorMessage(error, "レシピを更新できませんでした。"));
    }
  };

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-10">
        <p className="text-default-600">読み込み中</p>
      </section>
    );
  }

  if (error || !recipe) {
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
