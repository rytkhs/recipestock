import {
  type IssueShortcutCredentialResponse,
  type ListShortcutCredentialsResponse,
} from "@recipestock/schemas";
import { api, parseApiResponse } from "../../lib/api";

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
