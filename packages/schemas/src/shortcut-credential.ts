import { z } from "zod";

export const shortcutCredentialNameSchema = z.string().trim().min(1).max(60);
export const shortcutCredentialTokenSchema = z.string().startsWith("rssc_").min(32).max(160);

export const issueShortcutCredentialRequestSchema = z.object({
  name: shortcutCredentialNameSchema,
});

export const shortcutCredentialSchema = z.object({
  id: z.string().min(1),
  name: shortcutCredentialNameSchema,
  tokenSuffix: z.string().min(4).max(12),
  createdAt: z.string().min(1),
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
