import { z } from "zod";

export const IMAGE_UPLOAD_URL_EXPIRES_IN_SECONDS = 15 * 60;
export const MAX_IMAGE_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

export const imageContentTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const createImageUploadUrlRequestSchema = z.object({
  contentType: imageContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(MAX_IMAGE_UPLOAD_SIZE_BYTES),
});

export const createImageUploadUrlResponseSchema = z.object({
  uploadUrl: z.string().min(1),
  objectKey: z.string().min(1),
  expiresAt: z.string().min(1),
});

export const getImageSignedUrlQuerySchema = z.object({
  key: z.string().min(1),
});

export const getImageSignedUrlResponseSchema = z.object({
  url: z.string().min(1),
  expiresAt: z.string().min(1),
});

export type ImageContentType = z.infer<typeof imageContentTypeSchema>;
export type CreateImageUploadUrlRequest = z.infer<typeof createImageUploadUrlRequestSchema>;
export type CreateImageUploadUrlResponse = z.infer<typeof createImageUploadUrlResponseSchema>;
export type GetImageSignedUrlResponse = z.infer<typeof getImageSignedUrlResponseSchema>;
