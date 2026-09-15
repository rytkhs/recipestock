import { type DraftImageRef } from "@recipestock/schemas";
import { useId, useRef } from "react";
import { RecipeSectionHeader } from "../recipes/recipe-detail-section";
import {
  DraftAddImageButton,
  DraftAddPhotoButton,
  DraftImageTile,
  DraftPendingImageTile,
} from "./draft-image-tile";
import {
  type ImagePreviewUrlsByImageId,
  imageInputAccept,
  imageLimitReachedText,
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

// レシピ画像は元の投稿や本のページの写し。詳細と同じく、手順とメモの後ろに置く。
export const ReferenceImagesSection = ({
  control,
  maxAddable,
  onUploadStateChange,
  previewUrlsByImageId,
  uploadImage,
}: ReferenceImagesSectionProps) => {
  const headingId = useId();
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
    <section aria-labelledby={headingId}>
      <RecipeSectionHeader
        id={headingId}
        meta={images.length > 0 ? `${images.length}枚` : undefined}
        title="レシピ画像"
      />
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
        <div className="-mx-4 mt-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
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
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-brand-muted text-sm">元の投稿や本のページの写真を残せます。</p>
          {isAddDisabled ? null : (
            <div className="-mx-2">
              <DraftAddPhotoButton label="レシピ画像に写真を追加" onClick={openPicker} />
            </div>
          )}
        </div>
      )}

      {isAddDisabled ? (
        <p className="mt-2 text-brand-muted text-sm">{imageLimitReachedText}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-brand-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
