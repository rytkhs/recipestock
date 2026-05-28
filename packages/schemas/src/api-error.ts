import { z } from "zod";

export const apiErrorCodeSchema = z.enum([
  "unauthorized",
  "validation_failed",
  "not_found",
  "unexpected_response",
  "recipe_limit_exceeded",
  "invalid_recipe_list_cursor",
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
