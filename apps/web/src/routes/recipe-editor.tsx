import { CaretLeft } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RecipeFormSkeleton } from "../components/loading";
import { ScreenTopBar, ScreenTopBarIconButton } from "../components/screen-top-bar";
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
import { useGoBack } from "../lib/navigation";

export const NewRecipeRoute = () => {
  const navigate = useNavigate();
  const close = useGoBack({ to: "/recipes" });
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: RecipeDraftFormValues, markSaved: () => void) => {
    setSubmitError(null);

    try {
      const response = await createRecipe(formValuesToCreateRecipeRequest(values));
      markSaved();
      await invalidateRecipeLists(queryClient);
      // 作ったレシピを見せる。新規作成は履歴から外し、詳細の戻るで来た画面へ帰す。
      await navigate({
        to: "/recipes/$recipeId",
        params: { recipeId: response.recipe.id },
        replace: true,
      });
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
      onClose={close}
      onSubmit={onSubmit}
    />
  );
};

export const EditRecipeRoute = () => {
  const { recipeId } = useParams({ from: "/_protected/recipes/$recipeId/edit" });
  const close = useGoBack({ to: "/recipes/$recipeId", params: { recipeId } });
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

  const onSubmit = async (values: RecipeDraftFormValues, markSaved: () => void) => {
    setSubmitError(null);

    try {
      await updateRecipe(recipeId, formValuesToRecipeDraftContent(values));
      markSaved();
    } catch (error) {
      setSubmitError(recipeMutationErrorMessage(error, "レシピを更新できませんでした。"));
      return;
    }

    void invalidateRecipeLists(queryClient);
    removeRecipeDetail(queryClient, recipeId);
    // 一覧から編集したなら一覧へ、詳細から編集したなら詳細へ帰す。
    toast.success("保存しました");
    close();
  };

  if (isLoading) {
    return <RecipeFormSkeleton />;
  }

  if (error || !recipe || recipe.locked) {
    return (
      <section className="mx-auto w-full max-w-5xl pb-12 sm:px-6 lg:px-10">
        <ScreenTopBar
          leading={
            <ScreenTopBarIconButton aria-label="戻る" onPress={close}>
              <CaretLeft size={21} weight="bold" />
            </ScreenTopBarIconButton>
          }
          title="レシピを編集"
        />
        <div className="px-4 pt-6 sm:px-0">
          <h2 className="text-brand-ink font-bold text-2xl">レシピを編集できません</h2>
        </div>
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
      onClose={close}
      onSubmit={onSubmit}
    />
  );
};
