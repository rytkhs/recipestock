import { z } from "zod";

export const createCheckoutResponseSchema = z.object({
  url: z.string().url(),
});

export type CreateCheckoutResponse = z.infer<typeof createCheckoutResponseSchema>;
