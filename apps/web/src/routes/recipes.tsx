import {
  type CreateRecipeResponse,
  type ListRecipesResponse,
  type RecipeDetail,
} from "@recipestock/schemas";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import {
  createEmptyRecipeDraftFormValues,
  formValuesToCreateRecipeRequest,
  RecipeDraftForm,
  type RecipeDraftFormValues,
} from "../features/recipe-draft";
import { ApiClientError, api, parseApiResponse } from "../lib/api";

const postRecipe = async (values: RecipeDraftFormValues) => {
  return parseApiResponse<CreateRecipeResponse>(
    api.api.recipes.$post({
      json: formValuesToCreateRecipeRequest(values),
    }),
  );
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
    queryKey: ["recipes", query, cursor],
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
    <section className="page">
      <div className="page-heading">
        <h1>Recipes</h1>
        <Link className="primary-button" to="/recipes/new">
          新規作成
        </Link>
      </div>

      <form className="inline-fields" onSubmit={submitSearch}>
        <label htmlFor="recipe-search">検索</label>
        <input
          id="recipe-search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <button className="secondary-button" type="submit">
          検索
        </button>
      </form>

      {error ? <p role="alert">レシピ一覧を読み込めませんでした。</p> : null}
      {isFetching && recipes.length === 0 ? <p>読み込み中</p> : null}
      {!isFetching && recipes.length === 0 && !error ? <p>レシピがありません。</p> : null}

      <div className="stack">
        {recipes.map((recipe) => (
          <article className="recipe-list-item" key={recipe.id}>
            <h2>
              <Link to="/recipes/$recipeId" params={{ recipeId: recipe.id }}>
                {recipe.title}
              </Link>
            </h2>
            {recipe.sourceName ? <p>{recipe.sourceName}</p> : null}
            <p>{new Date(recipe.updatedAt).toLocaleDateString("ja-JP")}</p>
          </article>
        ))}
      </div>

      {nextCursor ? (
        <button
          className="secondary-button"
          disabled={isFetching}
          type="button"
          onClick={loadNextPage}
        >
          もっと見る
        </button>
      ) : null}
    </section>
  );
};

export const NewRecipeRoute = () => {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: RecipeDraftFormValues) => {
    setSubmitError(null);

    try {
      const response = await postRecipe(values);
      await navigate({ to: "/recipes/$recipeId", params: { recipeId: response.recipe.id } });
    } catch (error) {
      setSubmitError(
        error instanceof ApiClientError && error.code === "recipe_limit_exceeded"
          ? "保存できるレシピ数の上限に達しています。"
          : "レシピを保存できませんでした。",
      );
    }
  };

  return (
    <section className="page recipe-form-page">
      <h1>レシピ作成</h1>
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
  const {
    data: recipe,
    error,
    isLoading,
  } = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => fetchRecipe(recipeId),
  });

  if (isLoading) {
    return (
      <section className="page">
        <p>読み込み中</p>
      </section>
    );
  }

  if (error || !recipe) {
    return (
      <section className="page">
        <h1>レシピを表示できません</h1>
      </section>
    );
  }

  return (
    <article className="page recipe-detail">
      <h1>{recipe.title}</h1>
      {recipe.content.servingsText ? <p>{recipe.content.servingsText}</p> : null}

      {recipe.content.ingredientGroups.length > 0 ? (
        <section>
          <h2>材料</h2>
          {recipe.content.ingredientGroups.map((group) => (
            <div
              key={
                group.label ??
                group.ingredients
                  .map((ingredient) => `${ingredient.name}:${ingredient.amount}`)
                  .join("|")
              }
            >
              {group.label ? <h3>{group.label}</h3> : null}
              <ul>
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
        <section>
          <h2>手順</h2>
          <ol>
            {recipe.content.steps.map((step) => (
              <li key={step.text}>{step.text}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {recipe.content.note ? (
        <section>
          <h2>メモ</h2>
          <p>{recipe.content.note}</p>
        </section>
      ) : null}

      {recipe.source.sourceName || recipe.source.sourceUrl ? (
        <section>
          <h2>出典</h2>
          {recipe.source.sourceName ? <p>{recipe.source.sourceName}</p> : null}
          {recipe.source.sourceUrl ? (
            <a href={recipe.source.sourceUrl}>{recipe.source.sourceUrl}</a>
          ) : null}
        </section>
      ) : null}
    </article>
  );
};
