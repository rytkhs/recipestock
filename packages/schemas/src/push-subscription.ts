import { z } from "zod";

const pushEndpointSchema = z.url({ protocol: /^https$/ }).max(4096);

export const pushSubscriptionRequestSchema = z.object({
  endpoint: pushEndpointSchema,
  expirationTime: z.number().int().nonnegative().nullable(),
  keys: z.object({
    p256dh: z.string().min(1).max(4096),
    auth: z.string().min(1).max(4096),
  }),
});

export const revokePushSubscriptionRequestSchema = z.object({
  endpoint: pushEndpointSchema,
});

export const pushSubscriptionSummarySchema = z.object({
  endpoint: pushEndpointSchema,
  expirationTime: z.string().datetime().nullable(),
});

export const getPushSubscriptionsResponseSchema = z.object({
  applicationServerKey: z.string().min(1),
  subscriptions: z.array(pushSubscriptionSummarySchema),
});

export const registerPushSubscriptionResponseSchema = z.object({
  subscription: pushSubscriptionSummarySchema,
});

export const revokePushSubscriptionResponseSchema = z.object({
  revoked: z.literal(true),
});

export type GetPushSubscriptionsResponse = z.infer<typeof getPushSubscriptionsResponseSchema>;
export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionRequestSchema>;
export type RegisterPushSubscriptionResponse = z.infer<
  typeof registerPushSubscriptionResponseSchema
>;
export type RevokePushSubscriptionResponse = z.infer<typeof revokePushSubscriptionResponseSchema>;
