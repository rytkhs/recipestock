import {
  type IssueShortcutCredentialResponse,
  iosShareShortcutImportReasonSchema,
  type ListShortcutCredentialsResponse,
  type ShortcutCredential,
} from "@recipestock/schemas";
import { type z } from "zod";
import { api, parseApiResponse } from "../../lib/api";

export const shortcutCredentialsQueryKey = ["shortcut-credentials"] as const;

/** ショートカットが連携し直しの画面へ送るときに添える理由（apps/api/src/ios-share-notices.ts）。 */
export const shortcutRelinkReasonSchema = iosShareShortcutImportReasonSchema.extract([
  "missing_credential",
  "unusable_credential",
  "malformed_request",
]);

export type ShortcutRelinkReason = z.infer<typeof shortcutRelinkReasonSchema>;

/** 一度でも共有が届いたキー。発行しただけのキーは、まだショートカットに貼られたか分からない。 */
export const isShortcutCredentialUsed = (credential: ShortcutCredential) =>
  credential.firstUsedAt !== null;

/** 使ったキーが1本でもあれば、このアカウントは共有から取り込める。キーは端末を表さないので、端末では数えない。 */
export const isShortcutLinked = (credentials: readonly ShortcutCredential[]) =>
  credentials.some(isShortcutCredentialUsed);

export const issueShortcutCredential = (name: string): Promise<IssueShortcutCredentialResponse> =>
  parseApiResponse(
    api.api["shortcut-credentials"].$post({
      json: { name },
    }),
  );

export const listShortcutCredentials = (): Promise<ListShortcutCredentialsResponse> =>
  parseApiResponse(api.api["shortcut-credentials"].$get());

export const revokeShortcutCredential = async (credentialId: string): Promise<void> => {
  await parseApiResponse(
    api.api["shortcut-credentials"][":credentialId"].$delete({
      param: { credentialId },
    }),
  );
};
