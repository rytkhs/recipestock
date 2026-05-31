import { z } from "zod";

export const apiErrorCodeSchema = z.enum([
  "unauthorized",
  "validation_failed",
  "not_found",
  "unexpected_response",
  "recipe_limit_exceeded",
  "invalid_recipe_list_cursor",
  "invalid_image_type",
  "image_too_large",
  "image_finalize_failed",
  "forbidden",
  "unknown",
]);

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
