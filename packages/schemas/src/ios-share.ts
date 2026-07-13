import { z } from "zod";
import { importJobSummarySchema } from "./import";

export const iosShareChannelNameSchema = z.string().trim().min(1).max(60);
export const iosShareTokenSchema = z.string().startsWith("rssc_").min(32).max(160);

export const createIosShareChannelRequestSchema = z.object({
  name: iosShareChannelNameSchema,
});

export const iosShareChannelSchema = z.object({
  id: z.string().min(1),
  name: iosShareChannelNameSchema,
  tokenSuffix: z.string().min(4).max(12),
  createdAt: z.string().min(1),
  lastUsedAt: z.string().min(1).nullable(),
});

export const createIosShareChannelResponseSchema = z.object({
  channel: iosShareChannelSchema,
  token: iosShareTokenSchema,
});

export const listIosShareChannelsResponseSchema = z.object({
  channels: z.array(iosShareChannelSchema),
});

export const createIosShareHandoffRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(4096),
});

export const iosShareShortcutImportJobRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(4096),
  requestId: z.uuid(),
});

export const createIosShareImportJobResponseSchema = z.object({
  kind: z.enum(["created", "existing_active_job"]),
  job: importJobSummarySchema,
});

export const iosShareHandoffStatusSchema = z.enum([
  "pending",
  "delivered_to_pwa",
  "delivered_to_browser",
  "superseded",
  "expired",
]);

export const createIosShareHandoffResponseSchema = z.object({
  handoffId: z.string().min(1),
  status: iosShareHandoffStatusSchema,
  expiresAt: z.string().min(1),
  fallbackUrl: z.url(),
});

export const getIosShareHandoffStatusResponseSchema = z.object({
  status: iosShareHandoffStatusSchema,
});

export const pendingIosShareHandoffSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
  createdAt: z.string().min(1),
});

export const getPendingIosShareHandoffResponseSchema = z.object({
  handoff: pendingIosShareHandoffSchema.nullable(),
});

export const deliverIosShareHandoffRequestSchema = z.object({
  target: z.enum(["pwa", "browser"]),
});

export const deliverIosShareHandoffResponseSchema = z.object({
  status: iosShareHandoffStatusSchema,
});

export const revokeIosShareChannelResponseSchema = z.object({
  revoked: z.literal(true),
});

export type IosShareChannel = z.infer<typeof iosShareChannelSchema>;
export type IosShareHandoffStatus = z.infer<typeof iosShareHandoffStatusSchema>;
export type IosShareShortcutImportJobRequest = z.infer<
  typeof iosShareShortcutImportJobRequestSchema
>;
export type CreateIosShareImportJobResponse = z.infer<typeof createIosShareImportJobResponseSchema>;
export type PendingIosShareHandoff = z.infer<typeof pendingIosShareHandoffSchema>;
export type CreateIosShareChannelResponse = z.infer<typeof createIosShareChannelResponseSchema>;
export type ListIosShareChannelsResponse = z.infer<typeof listIosShareChannelsResponseSchema>;
export type CreateIosShareHandoffResponse = z.infer<typeof createIosShareHandoffResponseSchema>;
export type GetIosShareHandoffStatusResponse = z.infer<
  typeof getIosShareHandoffStatusResponseSchema
>;
export type GetPendingIosShareHandoffResponse = z.infer<
  typeof getPendingIosShareHandoffResponseSchema
>;
export type DeliverIosShareHandoffResponse = z.infer<typeof deliverIosShareHandoffResponseSchema>;
