import { z } from "zod";

export const getAiUsageResponseSchema = z.object({
  month: z.string(),
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  resetAt: z.string().datetime(),
});

export type GetAiUsageResponse = z.infer<typeof getAiUsageResponseSchema>;
