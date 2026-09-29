import {
  type ListShortcutCredentialsResponse,
  type ShortcutCredential,
} from "@recipestock/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type IosDeviceName } from "../../pwa/platform";
import { issueShortcutCredential, shortcutCredentialsQueryKey } from "./api";
import { copyTextToClipboard } from "./clipboard";

/** この画面で発行したキー。平文はこのときにしか受け取れないので、開いている間だけ持つ。 */
export type IssuedShortcutKey = {
  credential: ShortcutCredential;
  token: string;
  isCopied: boolean;
  /** 「もう一度コピー」を押して書けたとき。押しても見た目が変わらないので、書けたことを伝える。 */
  isCopiedAgain: boolean;
};

/**
 * この画面で進めている手順。どこまで進んだかは端末に覚えない。開き直したときの続きは、
 * どの入れ物（ホーム画面のアプリ、Safari）で開いても同じになるよう、連携キーの一覧から決める。
 */
export const useShortcutSetup = ({ deviceName }: { deviceName: IosDeviceName }) => {
  const queryClient = useQueryClient();
  const [issuedKey, setIssuedKey] = useState<IssuedShortcutKey | null>(null);
  const [hasOpenedShortcut, setHasOpenedShortcut] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [hasIssueError, setHasIssueError] = useState(false);

  const issueAndCopyKey = async () => {
    setHasIssueError(false);
    setIsIssuing(true);

    // 発行を待たずに、タップの処理の中でコピーを始める。
    const issuing = issueShortcutCredential(deviceName);
    const copying = copyTextToClipboard(issuing.then(({ token }) => token));

    try {
      const { credential, token } = await issuing;

      queryClient.setQueryData<ListShortcutCredentialsResponse>(
        shortcutCredentialsQueryKey,
        (current) => current && { credentials: [credential, ...current.credentials] },
      );
      setIssuedKey({ credential, token, isCopied: await copying, isCopiedAgain: false });
      // 新しいキーは、ショートカットを追加し直して貼るまで使われない。
      setHasOpenedShortcut(false);
    } catch {
      setHasIssueError(true);
    } finally {
      setIsIssuing(false);
    }
  };

  const copyKeyAgain = async () => {
    if (!issuedKey) return;

    const isCopied = await copyTextToClipboard(issuedKey.token);
    setIssuedKey({ ...issuedKey, isCopied, isCopiedAgain: isCopied });
  };

  const markShortcutOpened = () => {
    setHasOpenedShortcut(true);
  };

  const startOver = () => {
    setIssuedKey(null);
    setHasOpenedShortcut(false);
    setHasIssueError(false);
  };

  return {
    issuedKey,
    hasOpenedShortcut,
    isIssuing,
    hasIssueError,
    issueAndCopyKey,
    copyKeyAgain,
    markShortcutOpened,
    startOver,
  };
};

export type ShortcutSetupState = ReturnType<typeof useShortcutSetup>;
