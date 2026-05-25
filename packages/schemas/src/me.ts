import { z } from "zod";

export const getMeResponseSchema = z.object({
  userId: z.string(),
  plan: z.enum(["free", "pro"]),
  recipeCount: z.number().int().nonnegative(),
  recipeLimit: z.number().int().positive().nullable(),
  isRecipeLimitReached: z.boolean(),
  aiUsage: z.object({
    month: z.string(),
    count: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
  }),
});

export type GetMeResponse = z.infer<typeof getMeResponseSchema>;
