import { Button, Input, Label, TextField } from "@heroui/react";
import { Camera, CircleNotch, X } from "@phosphor-icons/react";
import { type DraftImageRef } from "@recipestock/schemas";
import { useEffect, useRef, useState } from "react";
import { useController } from "react-hook-form";
import {
  createLocalPreviewUrl,
  imageInputAccept,
  type RecipeDraftFormControl,
  revokeLocalPreviewUrl,
} from "./form-internals";
import { RecipeImageUploadError } from "./image-upload";

type CoverImageTitleBlockProps = {
  control: RecipeDraftFormControl;
  coverImagePreviewUrl?: string;
  uploadImage: (file: File) => Promise<DraftImageRef>;
  onUploadStateChange(isUploading: boolean): void;
};

export const CoverImageTitleBlock = ({
  control,
  coverImagePreviewUrl,
  uploadImage,
  onUploadStateChange,
}: CoverImageTitleBlockProps) => {
  const { field: coverImageField } = useController({ control, name: "coverImage" });
  const { field: titleField } = useController({
    control,
    name: "title",
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  const currentPreviewUrl =
    localPreviewUrl ?? (coverImageField.value ? coverImagePreviewUrl : undefined);

  useEffect(() => () => revokeLocalPreviewUrl(localPreviewUrl), [localPreviewUrl]);

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
      setLocalPreviewUrl((currentUrl) => {
        revokeLocalPreviewUrl(currentUrl);
        return nextPreviewUrl;
      });
      coverImageField.onChange(uploadedImage);
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

  const handleRemove = () => {
    setError(null);
    setLocalPreviewUrl((currentUrl) => {
      revokeLocalPreviewUrl(currentUrl);
      return null;
    });
    coverImageField.onChange(undefined);
  };

  return (
    <section className="overflow-hidden rounded-[16px] border border-brand-line-soft bg-brand-paper shadow-pantry-sm sm:rounded-[18px]">
      <div className="grid gap-4 p-3.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:p-5">
        <div className="grid gap-2">
          <Label className="text-sm font-bold text-brand-walnut">カバー画像</Label>
          <div className="relative w-fit shrink-0">
            <input
              ref={inputRef}
              accept={imageInputAccept}
              aria-label="カバー画像"
              className="sr-only"
              disabled={isUploading}
              type="file"
              onChange={(event) => void handleChange(event)}
            />
            <button
              aria-label="カバー画像を選択"
              className="grid aspect-[4/3] w-full min-w-[9rem] max-w-[15rem] place-items-center overflow-hidden rounded-[14px] border border-dashed border-brand-line bg-brand-paper-muted text-brand-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)] transition-colors hover:border-brand-sage/60 hover:bg-brand-paper-raised hover:text-brand-sage sm:aspect-square sm:w-36 sm:min-w-0"
              disabled={isUploading}
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              {currentPreviewUrl ? (
                <img
                  alt="カバー画像プレビュー"
                  className="h-full w-full object-cover"
                  src={currentPreviewUrl}
                />
              ) : (
                <span className="grid place-items-center gap-1.5 text-xs font-semibold">
                  <Camera size={28} weight="fill" />
                  カバーを追加
                </span>
              )}
            </button>

            {isUploading ? (
              <div className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/30">
                <CircleNotch className="animate-spin text-white" size={24} />
              </div>
            ) : null}

            {currentPreviewUrl && !isUploading ? (
              <Button
                aria-label="カバー画像を削除"
                className="absolute -right-1.5 -top-1.5 h-7 min-w-7 rounded-full px-0 text-xs leading-none shadow-pantry-sm"
                isIconOnly
                variant="danger"
                onPress={handleRemove}
              >
                <X size={14} weight="bold" />
              </Button>
            ) : null}
          </div>
        </div>

        <TextField aria-label="レシピ名" className="grid min-w-0 content-start gap-2" isRequired>
          <Label className="text-sm font-bold text-brand-walnut">レシピ名</Label>
          <Input
            className="min-h-12 w-full rounded-[14px] bg-brand-paper-raised px-3.5 text-xl font-bold leading-tight placeholder:text-brand-wheat sm:text-2xl"
            name={titleField.name}
            placeholder="レシピ名を入力"
            ref={titleField.ref}
            variant="secondary"
            value={titleField.value ?? ""}
            onBlur={titleField.onBlur}
            onChange={(event) => titleField.onChange(event.target.value)}
          />
        </TextField>
      </div>

      {error ? (
        <div className="mt-3 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
          <p className="text-brand-danger text-sm" role="alert">
            {error}
          </p>
        </div>
      ) : null}
    </section>
  );
};
