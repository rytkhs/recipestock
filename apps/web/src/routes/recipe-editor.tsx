import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { RecipeFormSkeleton } from "../components/loading";
import {
  createEmptyRecipeDraftFormValues,
  formValuesToCreateRecipeRequest,
  formValuesToRecipeDraftContent,
  RecipeDraftForm,
  type RecipeDraftFormValues,
  recipeDetailToFormValues,
} from "../features/recipe-draft";
import {
  createRecipe,
  getRecipe,
  invalidateRecipeLists,
  recipeMutationErrorMessage,
  recipesQueryKeys,
  removeRecipeDetail,
  updateRecipe,
} from "../features/recipes";

export const NewRecipeRoute = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: RecipeDraftFormValues) => {
    setSubmitError(null);

    try {
      const response = await createRecipe(formValuesToCreateRecipeRequest(values));
      await invalidateRecipeLists(queryClient);
      await navigate({ to: "/recipes/$recipeId", params: { recipeId: response.recipe.id } });
    } catch (error) {
      setSubmitError(recipeMutationErrorMessage(error, "レシピを保存できませんでした。"));
    }
  };

  return (
    <RecipeDraftForm
      defaultValues={createEmptyRecipeDraftFormValues()}
      submitError={submitError}
      submitLabel="保存"
      title="新しいレシピを追加"
      onClose={() => void navigate({ to: "/recipes" })}
      onSubmit={onSubmit}
    />
  );
};

export const EditRecipeRoute = () => {
  const { recipeId } = useParams({ from: "/_protected/recipes/$recipeId/edit" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    data: recipe,
    error,
    isLoading,
  } = useQuery({
    queryKey: recipesQueryKeys.detail(recipeId),
    queryFn: () => getRecipe(recipeId),
  });

  const onSubmit = async (values: RecipeDraftFormValues) => {
    setSubmitError(null);

    let updatedRecipeId: string;
    try {
      const response = await updateRecipe(recipeId, formValuesToRecipeDraftContent(values));
      updatedRecipeId = response.recipe.id;
    } catch (error) {
      setSubmitError(recipeMutationErrorMessage(error, "レシピを更新できませんでした。"));
      return;
    }

    void invalidateRecipeLists(queryClient);
    removeRecipeDetail(queryClient, recipeId);
    await navigate({ to: "/recipes/$recipeId", params: { recipeId: updatedRecipeId } });
  };

  if (isLoading) {
    return <RecipeFormSkeleton />;
  }

  if (error || !recipe || recipe.locked) {
    return (
      <section className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-10 py-10">
        <h1 className="text-brand-ink font-bold text-2xl">レシピを編集できません</h1>
      </section>
    );
  }

  const referenceImages = recipe.content.referenceImages ?? [];

  return (
    <RecipeDraftForm
      key={recipe.id}
      coverImagePreviewUrl={recipe.content.coverImage?.url}
      defaultValues={recipeDetailToFormValues(recipe)}
      referenceImagePreviewUrls={referenceImages.map((image) => image.url ?? "")}
      submitError={submitError}
      submitLabel="更新"
      title="レシピを編集"
      stepImagePreviewUrls={recipe.content.steps.map((step) =>
        step.images.map((image) => image.url ?? ""),
      )}
      onClose={() => void navigate({ to: "/recipes/$recipeId", params: { recipeId } })}
      onSubmit={onSubmit}
    />
  );
};
