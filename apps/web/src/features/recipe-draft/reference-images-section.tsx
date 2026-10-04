import { type DraftImageRef } from "@recipestock/schemas";
import { useRef } from "react";
import {
  DraftAddFirstImageButton,
  DraftAddImageButton,
  DraftImageTile,
  DraftPendingImageTile,
} from "./draft-image-tile";
import {
  type ImagePreviewUrlsByImageId,
  imageInputAccept,
  imageRefId,
  type RecipeDraftFormControl,
} from "./form-internals";
import { useDraftImageList } from "./use-draft-image-list";

type ReferenceImagesSectionProps = {
  control: RecipeDraftFormControl;
  maxAddable: number;
  onUploadStateChange(isUploading: boolean): void;
  previewUrlsByImageId?: ImagePreviewUrlsByImageId;
  uploadImage: (file: File) => Promise<DraftImageRef>;
};

const referenceTileClass = "aspect-[4/5] w-28 sm:w-32";

// レシピ画像は元の投稿や本のページの写し。詳細と同じく、表紙の下に見出しを付けずに列で置く。
// まだ1枚もないときは、画像の列ができる場所に点線の枠を1つ置き、欄の名前と何を残すかを添える。
export const ReferenceImagesSection = ({
  control,
  maxAddable,
  onUploadStateChange,
  previewUrlsByImageId,
  uploadImage,
}: ReferenceImagesSectionProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { addFiles, error, images, isUploading, pendingImages, previewUrlFor, removeImage } =
    useDraftImageList({
      control,
      maxAddable,
      name: "referenceImages",
      onUploadStateChange,
      previewUrlsByImageId,
      uploadImage,
    });
  const isAddDisabled = maxAddable <= 0;
  const openPicker = () => inputRef.current?.click();

  return (
    <section aria-label="レシピ画像" className="pt-3">
      <input
        ref={inputRef}
        accept={imageInputAccept}
        aria-label="レシピ画像を追加"
        className="sr-only"
        disabled={isUploading || isAddDisabled}
        multiple
        type="file"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addFiles(files);
        }}
      />

      {images.length > 0 || pendingImages.length > 0 ? (
        <div className="flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 sm:scroll-px-0 sm:px-0">
          {images.map((image, imageIndex) => (
            <DraftImageTile
              className={referenceTileClass}
              disabled={isUploading}
              key={imageRefId(image)}
              label={`レシピ画像${imageIndex + 1}`}
              src={previewUrlFor(image)}
              onRemove={() => removeImage(imageIndex)}
            />
          ))}
          {pendingImages.map((pendingImage) => (
            <DraftPendingImageTile
              className={referenceTileClass}
              key={pendingImage.id}
              label="レシピ画像をアップロード中"
              previewUrl={pendingImage.previewUrl}
            />
          ))}
          {isAddDisabled ? null : (
            <DraftAddImageButton
              className={referenceTileClass}
              disabled={isUploading}
              label="レシピ画像に写真を追加"
              onClick={openPicker}
            />
          )}
        </div>
      ) : isAddDisabled ? null : (
        <div className="px-2 sm:-mx-2 sm:px-0">
          <DraftAddFirstImageButton
            disabled={isUploading}
            frameClassName="size-14"
            hint="元の投稿やレシピの画像を残せます"
            label="レシピ画像を追加"
            title="レシピ画像"
            onClick={openPicker}
          />
        </div>
      )}

      {isAddDisabled ? (
        <p className="mt-2 px-4 text-brand-muted text-sm sm:px-0">レシピ画像は上限に達しました</p>
      ) : null}
      {error ? (
        <p className="mt-2 px-4 text-brand-danger text-sm sm:px-0" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
