import {
  type CreateImageUploadUrlResponse,
  type DraftImageRef,
  MAX_IMAGE_UPLOAD_SIZE_BYTES,
} from "@recipestock/schemas";
import { parseApiResponse } from "../../lib/api";

export class RecipeImageUploadError extends Error {
  readonly code: "image_too_large" | "upload_failed";

  constructor(code: RecipeImageUploadError["code"]) {
    super(code);
    this.name = "RecipeImageUploadError";
    this.code = code;
  }
}

const browserCanResize = () =>
  typeof createImageBitmap === "function" &&
  typeof document.createElement("canvas").toBlob === "function";

const blobToFile = (blob: Blob, fileName: string) =>
  new File([blob], fileName, {
    type: blob.type,
    lastModified: Date.now(),
  });

const extensionFromContentType = (contentType: string) => {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
};

export const compressRecipeImage = async (file: File): Promise<File> => {
  if (!browserCanResize()) {
    return file;
  }

  const bitmap = await createImageBitmap(file);

  try {
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    const outputType = file.type === "image/png" ? "image/png" : "image/webp";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, 0.82),
    );

    if (!blob) {
      const fallbackBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      return fallbackBlob
        ? blobToFile(fallbackBlob, `${file.name.replace(/\.[^.]+$/, "")}.jpg`)
        : file;
    }

    return blobToFile(
      blob,
      `${file.name.replace(/\.[^.]+$/, "")}.${extensionFromContentType(blob.type)}`,
    );
  } finally {
    bitmap.close();
  }
};

export const uploadRecipeImage = async (file: File): Promise<DraftImageRef> => {
  const compressedFile = await compressRecipeImage(file);

  if (compressedFile.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
    throw new RecipeImageUploadError("image_too_large");
  }

  const upload = await parseApiResponse<CreateImageUploadUrlResponse>(
    fetch("/api/images/upload-url", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contentType: compressedFile.type,
        sizeBytes: compressedFile.size,
      }),
    }),
  );
  const putResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "content-type": compressedFile.type },
    body: compressedFile,
  });

  if (!putResponse.ok) {
    throw new RecipeImageUploadError("upload_failed");
  }

  return { type: "tmpObjectKey", key: upload.objectKey };
};
