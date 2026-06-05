import { z } from "zod";

export const createCheckoutResponseSchema = z.object({
  url: z.string().url(),
});

export type CreateCheckoutResponse = z.infer<typeof createCheckoutResponseSchema>;

export const createBillingPortalResponseSchema = z.object({
  url: z.string().url(),
});

export type CreateBillingPortalResponse = z.infer<typeof createBillingPortalResponseSchema>;

export const getBillingStatusResponseSchema = z.object({
  plan: z.enum(["free", "pro"]),
  subscription: z
    .object({
      status: z.string(),
      cancelAtPeriodEnd: z.boolean(),
      currentPeriodEnd: z.string().datetime().nullable(),
      cancelAt: z.string().datetime().nullable(),
    })
    .nullable(),
});

export type GetBillingStatusResponse = z.infer<typeof getBillingStatusResponseSchema>;
