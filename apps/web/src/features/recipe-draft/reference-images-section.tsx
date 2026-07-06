import { Button, Label, ProgressBar } from "@heroui/react";
import { ImageSquare, Plus, X } from "@phosphor-icons/react";
import { type DraftImageRef } from "@recipestock/schemas";
import { useEffect, useRef, useState } from "react";
import { useController } from "react-hook-form";
import {
  createLocalPreviewUrl,
  type ImagePreviewUrlsByImageId,
  imageInputAccept,
  imageRefId,
  type RecipeDraftFormControl,
  revokeLocalPreviewUrl,
} from "./form-internals";
import { RecipeImageUploadError } from "./image-upload";

type ReferenceImagesSectionProps = {
  control: RecipeDraftFormControl;
  isAddDisabled: boolean;
  addDisabledReason?: string;
  onUploadStateChange(isUploading: boolean): void;
  previewUrlsByImageId?: ImagePreviewUrlsByImageId;
  uploadImage: (file: File) => Promise<DraftImageRef>;
};

export const ReferenceImagesSection = ({
  control,
  isAddDisabled,
  addDisabledReason,
  onUploadStateChange,
  previewUrlsByImageId,
  uploadImage,
}: ReferenceImagesSectionProps) => {
  const { field } = useController({ control, name: "referenceImages" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [localPreviewUrlsByImageId, setLocalPreviewUrlsByImageId] = useState<
    Record<string, string>
  >({});
  const localPreviewUrlsByImageIdRef = useRef(localPreviewUrlsByImageId);
  const images = field.value ?? [];

  localPreviewUrlsByImageIdRef.current = localPreviewUrlsByImageId;

  useEffect(
    () => () => {
      Object.values(localPreviewUrlsByImageIdRef.current).forEach(revokeLocalPreviewUrl);
    },
    [],
  );

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    const nextPreviewUrl = createLocalPreviewUrl(file);
    setIsUploading(true);
    onUploadStateChange(true);

    try {
      const uploadedImage = await uploadImage(file);
      const uploadedImageId = imageRefId(uploadedImage);
      setLocalPreviewUrlsByImageId((currentUrls) => ({
        ...currentUrls,
        [uploadedImageId]: nextPreviewUrl,
      }));
      field.onChange([...images, uploadedImage]);
    } catch (uploadError) {
      revokeLocalPreviewUrl(nextPreviewUrl);
      setError(
        uploadError instanceof RecipeImageUploadError && uploadError.code === "image_too_large"
          ? "画像は5MB以下にしてください。"
          : "画像をアップロードできませんでした。",
      );
    } finally {
      setIsUploading(false);
      onUploadStateChange(false);
    }
  };

  const handleRemove = (imageIndex: number) => {
    const image = images[imageIndex];
    if (!image) {
      return;
    }

    const removedImageId = imageRefId(image);
    setLocalPreviewUrlsByImageId((currentUrls) => {
      const nextUrls = { ...currentUrls };
      revokeLocalPreviewUrl(nextUrls[removedImageId]);
      delete nextUrls[removedImageId];
      return nextUrls;
    });
    field.onChange(images.filter((_, currentIndex) => currentIndex !== imageIndex));
  };

  return (
    <section className="overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:rounded-[18px]">
      <div className="flex items-center justify-between gap-3 border-brand-line-soft border-b bg-brand-paper-muted/70 px-3.5 py-3 sm:px-5">
        <Label className="font-semibold text-brand-walnut text-sm sm:font-bold sm:text-base">
          レシピ画像
        </Label>
      </div>
      <input
        ref={inputRef}
        accept={imageInputAccept}
        aria-label="レシピ画像を追加"
        className="sr-only"
        disabled={isUploading || isAddDisabled}
        type="file"
        onChange={(event) => void handleChange(event)}
      />

      <div className="grid gap-3 px-3.5 py-3 sm:px-5">
        <div className="flex snap-x gap-3 overflow-x-auto pb-2">
          {images.map((image, imageIndex) => {
            const imageId = imageRefId(image);
            const imagePreviewUrl =
              localPreviewUrlsByImageId[imageId] ?? previewUrlsByImageId?.[imageId];

            return (
              <div
                className="group relative w-[min(40vw,160px)] shrink-0 snap-start overflow-hidden rounded-[14px] border border-brand-line-soft bg-brand-paper-muted shadow-pantry-sm sm:w-[128px]"
                key={imageId}
              >
                <div className="grid aspect-[4/5] place-items-center">
                  {imagePreviewUrl ? (
                    <img
                      alt={`レシピ画像${imageIndex + 1}プレビュー`}
                      className="h-full w-full object-cover"
                      src={imagePreviewUrl}
                    />
                  ) : (
                    <ImageSquare className="text-brand-muted" size={22} />
                  )}
                </div>
                <Button
                  aria-label={`レシピ画像${imageIndex + 1}を削除`}
                  className="absolute right-1 top-1 h-5 min-w-5 rounded-full px-0 text-[10px] leading-none shadow-pantry-sm"
                  isDisabled={isUploading}
                  isIconOnly
                  variant="danger"
                  onPress={() => handleRemove(imageIndex)}
                >
                  <X size={12} weight="bold" />
                </Button>
              </div>
            );
          })}

          <button
            aria-label="レシピ画像を追加"
            className="grid w-[min(40vw,160px)] shrink-0 snap-start place-items-center rounded-[14px] border border-dashed border-brand-line bg-brand-paper-muted text-brand-walnut transition-colors hover:border-brand-sage hover:bg-brand-paper-raised disabled:opacity-50 sm:w-[128px]"
            disabled={isUploading || isAddDisabled}
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <div className="grid aspect-[4/5] place-items-center">
              <Plus className="text-brand-muted" size={20} weight="bold" />
            </div>
          </button>
        </div>

        {isUploading ? <ProgressBar aria-label="レシピ画像アップロード中" isIndeterminate /> : null}

        <div className="flex flex-wrap items-center gap-2">
          {isUploading ? <span className="text-sm text-brand-muted">アップロード中</span> : null}
          {isAddDisabled && addDisabledReason ? (
            <span className="text-sm text-brand-muted">{addDisabledReason}</span>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
            <p className="text-brand-danger text-sm" role="alert">
              {error}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
};
