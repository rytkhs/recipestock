import { zodResolver } from "@hookform/resolvers/zod";
import { WarningCircle, X } from "@phosphor-icons/react";
import {
  type DraftImageRef,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_TOTAL_IMAGES,
} from "@recipestock/schemas";
import { useBlocker } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScreenTopBar, ScreenTopBarIconButton } from "../../components/screen-top-bar";
import { CoverImageTitleBlock } from "./cover-image-title-block";
import {
  countFormImages,
  createImagePreviewUrlsByImageId,
  type ImagePreviewUrlsByImageId,
} from "./form-internals";
import { uploadRecipeImage } from "./image-upload";
import { IngredientsSection } from "./ingredients-section";
import { NoteSection } from "./note-section";
import { type RecipeDraftFormValues, recipeDraftFormSchema } from "./recipe-draft-form-values";
import { ReferenceImagesSection } from "./reference-images-section";
import { StepsSection } from "./steps-section";

type RecipeDraftFormProps = {
  defaultValues: RecipeDraftFormValues;
  title: string;
  submitLabel: string;
  submitError?: string | null;
  coverImagePreviewUrl?: string;
  referenceImagePreviewUrls?: string[];
  stepImagePreviewUrls?: string[][];
  uploadImage?: (file: File) => Promise<DraftImageRef>;
  // markSaved は保存が成功したときだけ呼ぶ。呼ぶと離脱の確認をやめる。
  onSubmit(values: RecipeDraftFormValues, markSaved: () => void): Promise<void> | void;
  onClose(): void;
};

// 詳細ページと同じ並び・同じ組み方のまま、その場で書き換えられるようにする。
export const RecipeDraftForm = ({
  defaultValues,
  title,
  submitLabel,
  submitError,
  coverImagePreviewUrl,
  referenceImagePreviewUrls,
  stepImagePreviewUrls,
  uploadImage = uploadRecipeImage,
  onSubmit,
  onClose,
}: RecipeDraftFormProps) => {
  const { control, formState, handleSubmit } = useForm<RecipeDraftFormValues>({
    resolver: zodResolver(recipeDraftFormSchema),
    defaultValues,
  });
  const { isDirty, isSubmitting } = formState;
  const watchedReferenceImages = useWatch({ control, name: "referenceImages" });
  const watchedSteps = useWatch({ control, name: "steps" });
  const [uploadingImageCount, setUploadingImageCount] = useState(0);
  const [isSubmitErrorDismissed, setIsSubmitErrorDismissed] = useState(false);
  const isUploadingImage = uploadingImageCount > 0;
  // 選んだ画像はアップロードが終わってからフォームの値になる。その間はisDirtyが立たないので、
  // 選んだ直後に離れると確認なしで消える。未保存かどうかはこの形でだけ判定する。
  const hasUnsavedWork = isDirty || isUploadingImage;
  // 保存に成功すると詳細へ移る。その移動では破棄の確認を出さない。
  // 通信の途中はまだ失う変更があるので、成功するまでは下ろさない。
  const isSavedRef = useRef(false);
  // 閉じるボタンだけでなく、ブラウザの戻る・スワイプで離れるときも確認する。
  // タブを閉じる・再読み込みは画面内の移動ではないので、保存できたかどうかは見ない。
  const blocker = useBlocker({
    enableBeforeUnload: () => hasUnsavedWork,
    shouldBlockFn: () => hasUnsavedWork && !isSavedRef.current,
    withResolver: true,
  });

  const remainingTotalImages =
    MAX_RECIPE_TOTAL_IMAGES -
    countFormImages({ referenceImages: watchedReferenceImages, steps: watchedSteps });
  const remainingReferenceImages = Math.min(
    MAX_RECIPE_REFERENCE_IMAGES - (watchedReferenceImages?.length ?? 0),
    remainingTotalImages,
  );

  const imagePreviewUrlsByImageId: ImagePreviewUrlsByImageId = useMemo(
    () =>
      createImagePreviewUrlsByImageId({
        defaultValues,
        referenceImagePreviewUrls,
        stepImagePreviewUrls,
      }),
    [defaultValues, referenceImagePreviewUrls, stepImagePreviewUrls],
  );

  const handleFormSubmit = handleSubmit(async (values) => {
    setIsSubmitErrorDismissed(false);

    await onSubmit(values, () => {
      isSavedRef.current = true;
    });
  });
  const handleUploadStateChange = (isUploading: boolean) => {
    setUploadingImageCount((count) => Math.max(0, count + (isUploading ? 1 : -1)));
  };

  return (
    <>
      <form
        className="mx-auto w-full max-w-5xl pb-16 sm:px-6 lg:px-10"
        onSubmit={(event) => void handleFormSubmit(event)}
      >
        <ScreenTopBar
          leading={
            // 通信の途中で離れると、保存に失敗しても知らせる先がなく変更が消える。
            <ScreenTopBarIconButton aria-label="閉じる" disabled={isSubmitting} onPress={onClose}>
              <X size={20} weight="bold" />
            </ScreenTopBarIconButton>
          }
          title={title}
          trailing={
            <Button disabled={isSubmitting || isUploadingImage} size="lg" type="submit">
              {submitLabel}
            </Button>
          }
        />

        <CoverImageTitleBlock
          control={control}
          coverImagePreviewUrl={coverImagePreviewUrl}
          onUploadStateChange={handleUploadStateChange}
          uploadImage={uploadImage}
        />

        <div className="mt-8 px-4 sm:mt-10 sm:px-0 lg:mt-14 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-x-14">
          <IngredientsSection control={control} />
          <div className="mt-10 flex flex-col gap-10 lg:mt-0">
            <StepsSection
              control={control}
              isUploadingImage={isUploadingImage}
              onUploadStateChange={handleUploadStateChange}
              previewUrlsByImageId={imagePreviewUrlsByImageId}
              remainingTotalImages={remainingTotalImages}
              uploadImage={uploadImage}
            />
            <NoteSection control={control} />
            <ReferenceImagesSection
              control={control}
              maxAddable={remainingReferenceImages}
              onUploadStateChange={handleUploadStateChange}
              previewUrlsByImageId={imagePreviewUrlsByImageId}
              uploadImage={uploadImage}
            />
          </div>
        </div>

        {/* 保存ボタンは上部バーにあるので、どこまでスクロールしていても見える位置に出す。 */}
        {submitError && !isSubmitErrorDismissed ? (
          <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto flex max-w-lg items-start gap-3 rounded-[14px] border border-brand-danger/25 bg-brand-paper py-2 pr-2 pl-4 shadow-pantry-lg">
              <WarningCircle
                aria-hidden="true"
                className="mt-2 shrink-0 text-brand-danger"
                size={20}
                weight="fill"
              />
              <p className="min-w-0 flex-1 py-2 text-brand-ink text-sm" role="alert">
                {submitError}
              </p>
              <button
                aria-label="エラーを閉じる"
                className="grid size-9 shrink-0 place-items-center rounded-full text-brand-muted transition-colors hover:bg-brand-paper-muted"
                type="button"
                onClick={() => setIsSubmitErrorDismissed(true)}
              >
                <X size={16} weight="bold" />
              </button>
            </div>
          </div>
        ) : null}
      </form>

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) {
            blocker.reset?.();
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <WarningCircle weight="fill" />
            </AlertDialogMedia>
            <AlertDialogTitle>変更を破棄しますか？</AlertDialogTitle>
            <AlertDialogDescription>保存していない変更は残りません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>編集を続ける</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              破棄する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
