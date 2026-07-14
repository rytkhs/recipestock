import { z } from "zod";
import { importJobSummarySchema } from "./import";

export const iosShareShortcutImportJobRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(4096),
  requestId: z.uuid(),
});

export const createIosShareImportJobResponseSchema = z.object({
  kind: z.enum(["created", "existing_active_job"]),
  job: importJobSummarySchema,
});
export type IosShareShortcutImportJobRequest = z.infer<
  typeof iosShareShortcutImportJobRequestSchema
>;
export type CreateIosShareImportJobResponse = z.infer<typeof createIosShareImportJobResponseSchema>;
