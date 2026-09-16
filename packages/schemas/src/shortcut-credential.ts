import { z } from "zod";

/** デバイス名は初回の共有でShortcutから届く。長い名前は切って保存する (ADR 0025)。 */
export const SHORTCUT_CREDENTIAL_NAME_MAX_LENGTH = 60;

export const shortcutCredentialTokenSchema = z.string().regex(/^rssc_[A-Za-z0-9_-]{25}$/);

export const shortcutCredentialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(SHORTCUT_CREDENTIAL_NAME_MAX_LENGTH).nullable(),
  tokenSuffix: z.string().min(4).max(12),
  createdAt: z.string().min(1),
  /** 認証が初めて成功するまではnull。発行済みと連携済みを区別する。 */
  verifiedAt: z.string().min(1).nullable(),
});

export const issueShortcutCredentialResponseSchema = z.object({
  credential: shortcutCredentialSchema,
  token: shortcutCredentialTokenSchema,
});

export const listShortcutCredentialsResponseSchema = z.object({
  credentials: z.array(shortcutCredentialSchema),
});

export const revokeShortcutCredentialResponseSchema = z.object({
  revoked: z.literal(true),
});

export type ShortcutCredential = z.infer<typeof shortcutCredentialSchema>;
export type IssueShortcutCredentialResponse = z.infer<typeof issueShortcutCredentialResponseSchema>;
export type ListShortcutCredentialsResponse = z.infer<typeof listShortcutCredentialsResponseSchema>;
