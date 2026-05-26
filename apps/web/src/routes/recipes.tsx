import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateRecipeResponse,
  createRecipeRequestSchema,
  type ListRecipesResponse,
  type RecipeDetail,
} from "@recipestock/schemas";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

const recipeFormSchema = z.object({
  title: z.string().min(1),
  servingsText: z.string().optional(),
  sourceName: z.string().optional(),
  sourceUrl: z.string().optional(),
  note: z.string().optional(),
  ingredientGroups: z.array(
    z.object({
      label: z.string().optional(),
      ingredients: z.array(
        z.object({
          name: z.string().optional(),
          amount: z.string().optional(),
        }),
      ),
    }),
  ),
  steps: z.array(z.object({ text: z.string().optional() })),
});

type RecipeFormValues = z.infer<typeof recipeFormSchema>;

const emptyIngredientGroup = {
  label: "",
  ingredients: [{ name: "", amount: "" }],
};

const emptyStep = { text: "" };

const compactText = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const buildCreateRecipeRequest = (values: RecipeFormValues) => {
  const sourceUrl = compactText(values.sourceUrl);
  const sourceName = compactText(values.sourceName);

  return createRecipeRequestSchema.parse({
    content: {
      title: values.title.trim(),
      servingsText: compactText(values.servingsText),
      ingredientGroups: values.ingredientGroups
        .map((group) => ({
          label: compactText(group.label),
          ingredients: group.ingredients
            .map((ingredient) => ({
              name: ingredient.name?.trim() ?? "",
              amount: ingredient.amount?.trim() ?? "",
            }))
            .filter((ingredient) => ingredient.name),
        }))
        .filter((group) => group.label || group.ingredients.length > 0),
      steps: values.steps
        .map((step) => ({ text: step.text?.trim() ?? "" }))
        .filter((step) => step.text),
      note: compactText(values.note),
    },
    source: {
      sourceType: sourceUrl ? "web" : sourceName ? "other" : "manual",
      sourceName,
      sourceUrl,
    },
  });
};

const postRecipe = async (values: RecipeFormValues) => {
  const response = await fetch("/api/recipes", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildCreateRecipeRequest(values)),
  });

  if (!response.ok) {
    throw new Error("Failed to save recipe.");
  }

  return (await response.json()) as CreateRecipeResponse;
};

const fetchRecipe = async (recipeId: string) => {
  const response = await fetch(`/api/recipes/${recipeId}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to load recipe.");
  }

  const body = (await response.json()) as { recipe: RecipeDetail };
  return body.recipe;
};

const fetchRecipes = async ({ cursor, query }: { cursor?: string | null; query?: string }) => {
  const params = new URLSearchParams();
  params.set("limit", "20");

  if (query) {
    params.set("q", query);
  }

  if (cursor) {
    params.set("cursor", cursor);
  }

  const response = await fetch(`/api/recipes?${params.toString()}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to load recipes.");
  }

  return (await response.json()) as ListRecipesResponse;
};

const IngredientGroupFields = ({
  control,
  register,
  groupIndex,
}: {
  control: ReturnType<typeof useForm<RecipeFormValues>>["control"];
  register: ReturnType<typeof useForm<RecipeFormValues>>["register"];
  groupIndex: number;
}) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `ingredientGroups.${groupIndex}.ingredients`,
  });

  return (
    <fieldset className="form-section">
      <legend>材料グループ</legend>
      <label htmlFor={`ingredient-group-${groupIndex}-label`}>グループ名</label>
      <input
        id={`ingredient-group-${groupIndex}-label`}
        {...register(`ingredientGroups.${groupIndex}.label`)}
      />

      <div className="stack">
        {fields.map((field, ingredientIndex) => (
          <div className="inline-fields" key={field.id}>
            <label>
              材料名
              <input
                {...register(`ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.name`)}
              />
            </label>
            <label>
              分量
              <input
                {...register(
                  `ingredientGroups.${groupIndex}.ingredients.${ingredientIndex}.amount`,
                )}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={() => remove(ingredientIndex)}
            >
              削除
            </button>
          </div>
        ))}
      </div>

      <button
        className="secondary-button"
        type="button"
        onClick={() => append({ name: "", amount: "" })}
      >
        材料を追加
      </button>
    </fieldset>
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
  const { control, formState, handleSubmit, register } = useForm<RecipeFormValues>({
    resolver: zodResolver(recipeFormSchema),
    defaultValues: {
      title: "",
      servingsText: "",
      sourceName: "",
      sourceUrl: "",
      note: "",
      ingredientGroups: [emptyIngredientGroup],
      steps: [emptyStep],
    },
  });
  const ingredientGroups = useFieldArray({ control, name: "ingredientGroups" });
  const steps = useFieldArray({ control, name: "steps" });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);

    try {
      const response = await postRecipe(values);
      await navigate({ to: "/recipes/$recipeId", params: { recipeId: response.recipe.id } });
    } catch {
      setSubmitError("レシピを保存できませんでした。");
    }
  });

  return (
    <section className="page recipe-form-page">
      <h1>レシピ作成</h1>
      <form className="recipe-form" onSubmit={(event) => void onSubmit(event)}>
        <label htmlFor="recipe-title">タイトル</label>
        <input id="recipe-title" required {...register("title")} />

        <label htmlFor="recipe-servings">人数</label>
        <input id="recipe-servings" {...register("servingsText")} />

        {ingredientGroups.fields.map((field, groupIndex) => (
          <IngredientGroupFields
            control={control}
            groupIndex={groupIndex}
            key={field.id}
            register={register}
          />
        ))}

        <button
          className="secondary-button"
          type="button"
          onClick={() => ingredientGroups.append(emptyIngredientGroup)}
        >
          グループを追加
        </button>

        <fieldset className="form-section">
          <legend>手順</legend>
          <div className="stack">
            {steps.fields.map((field, stepIndex) => (
              <div className="inline-fields" key={field.id}>
                <label>
                  手順
                  <textarea rows={3} {...register(`steps.${stepIndex}.text`)} />
                </label>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => steps.remove(stepIndex)}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => steps.append(emptyStep)}
          >
            手順を追加
          </button>
        </fieldset>

        <label htmlFor="recipe-note">メモ</label>
        <textarea id="recipe-note" rows={4} {...register("note")} />

        <label htmlFor="recipe-source-name">出典名</label>
        <input id="recipe-source-name" {...register("sourceName")} />

        <label htmlFor="recipe-source-url">元URL</label>
        <input id="recipe-source-url" inputMode="url" type="url" {...register("sourceUrl")} />

        <button className="primary-button" disabled={formState.isSubmitting} type="submit">
          保存
        </button>

        {submitError ? <p role="alert">{submitError}</p> : null}
      </form>
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
