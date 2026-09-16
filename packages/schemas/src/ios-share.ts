import { z } from "zod";

export const IOS_SHARE_SHORTCUT_INPUT_MAX_LENGTH = 8192;

/**
 * `deviceName`は連携済み端末を見分けるための補助情報であり、取り込みを失敗させてはならない。
 * 想定外の型や長さの値はmalformed_requestにせず、その場で捨てて`input`の処理を続ける (ADR 0025)。
 */
export const iosShareShortcutImportRequestSchema = z.object({
  input: z.string().min(1).max(IOS_SHARE_SHORTCUT_INPUT_MAX_LENGTH),
  deviceName: z.string().optional().catch(undefined),
});

export const iosShareShortcutImportOutcomeSchema = z.enum(["accepted", "rejected"]);

export const iosShareShortcutImportReasonSchema = z.enum([
  "created",
  "existing_active_job",
  "no_url_in_input",
  "invalid_url",
  "malformed_request",
  "recipe_limit_exceeded",
  "ai_usage_limit_exceeded",
  "ai_usage_quota_exhausted",
  "rate_limit_exceeded",
  "temporarily_unavailable",
  "unauthorized",
]);

export const iosShareNoticeSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
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
