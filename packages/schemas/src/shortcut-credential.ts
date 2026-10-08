import { z } from "zod";

export const shortcutCredentialNameSchema = z.string().trim().min(1).max(60);
export const shortcutCredentialTokenSchema = z.string().regex(/^rssc_[A-Za-z0-9_-]{25}$/);

export const issueShortcutCredentialRequestSchema = z.object({
  name: shortcutCredentialNameSchema,
});

export const shortcutCredentialSchema = z.object({
  id: z.string().min(1),
  name: shortcutCredentialNameSchema,
  createdAt: z.string().min(1),
  // 一度も使われていないキーはnull。連携の設定が済んだことは`firstUsedAt`が入ったことで分かる。
  firstUsedAt: z.string().min(1).nullable(),
  lastUsedAt: z.string().min(1).nullable(),
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
