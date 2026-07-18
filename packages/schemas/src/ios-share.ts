import { type z } from "zod";
import { createImportUrlJobResponseSchema, importUrlRequestSchema } from "./import";

export const iosShareShortcutImportJobRequestSchema = importUrlRequestSchema;

export const createIosShareImportJobResponseSchema = createImportUrlJobResponseSchema;
export type IosShareShortcutImportJobRequest = z.infer<
  typeof iosShareShortcutImportJobRequestSchema
>;
export type CreateIosShareImportJobResponse = z.infer<typeof createIosShareImportJobResponseSchema>;
