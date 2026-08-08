import { z } from "zod";

export const IOS_SHARE_SHORTCUT_INPUT_MAX_LENGTH = 8192;

export const iosShareShortcutImportRequestSchema = z.object({
  input: z.string().min(1).max(IOS_SHARE_SHORTCUT_INPUT_MAX_LENGTH),
});

export const iosShareShortcutImportOutcomeSchema = z.enum(["accepted", "rejected"]);

export const iosShareShortcutImportReasonSchema = z.enum([
  "created",
  "existing_active_job",
  "no_url_in_input",
  "invalid_url",
  "recipe_limit_exceeded",
  "rate_limit_exceeded",
  "temporarily_unavailable",
  "unauthorized",
]);

export const iosShareNoticeSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  openUrl: z.url().nullable(),
});

export const iosShareShortcutImportResponseSchema = z.object({
  outcome: iosShareShortcutImportOutcomeSchema,
  reason: iosShareShortcutImportReasonSchema,
  notice: iosShareNoticeSchema,
});

export type IosShareShortcutImportRequest = z.infer<typeof iosShareShortcutImportRequestSchema>;
export type IosShareShortcutImportOutcome = z.infer<typeof iosShareShortcutImportOutcomeSchema>;
export type IosShareShortcutImportReason = z.infer<typeof iosShareShortcutImportReasonSchema>;
export type IosShareNotice = z.infer<typeof iosShareNoticeSchema>;
export type IosShareShortcutImportResponse = z.infer<typeof iosShareShortcutImportResponseSchema>;
