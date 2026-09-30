import {
  type ListShortcutCredentialsResponse,
  type ShortcutCredential,
} from "@recipestock/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type IosDeviceName } from "../../pwa/platform";
import { issueShortcutCredential, shortcutCredentialsQueryKey } from "./api";
import { copyTextToClipboard } from "./clipboard";

/**
 * この画面で発行したキーの段階。平文は発行したときにしか受け取れないので、開いている間だけ持つ。
 * 発行とコピーの両方が済むまでは`issuing`のままにする。済むまでは、②へ進めない。
 */
export type ShortcutKeyPhase =
  | { status: "none"; hasIssueError: boolean }
  | { status: "issuing" }
  | {
      status: "issued";
      credential: ShortcutCredential;
      token: string;
      isCopied: boolean;
      /** 「もう一度コピー」を押して書けたとき。押しても見た目が変わらないので、書けたことを伝える。 */
      isCopiedAgain: boolean;
    };

/**
 * 1回の設定で進めている手順（docs/shortcut/ios-share.mdの表2）。設定を始めるたびに作り直すので、やり直しで消すものはない。
 * どこまで進んだかは端末に覚えない。開き直したときの続きは、始めたときの連携キーの一覧から親が決めて渡す。
 */
export const useShortcutSetup = ({
  deviceName,
  resumableCredential,
}: {
  deviceName: IosDeviceName;
  resumableCredential: ShortcutCredential | null;
}) => {
  const queryClient = useQueryClient();
  const [key, setKey] = useState<ShortcutKeyPhase>({ status: "none", hasIssueError: false });
  const [hasOpenedShortcut, setHasOpenedShortcut] = useState(false);

  const issueAndCopyKey = async () => {
    setKey({ status: "issuing" });
    // 新しいキーは、ショートカットを追加し直して貼るまで使われない。発行している間も②を押せないようにする。
    setHasOpenedShortcut(false);

    // 発行を待たずに、タップの処理の中でコピーを始める。
    const issuing = issueShortcutCredential(deviceName);
    const copying = copyTextToClipboard(issuing.then(({ token }) => token));

    try {
      const { credential, token } = await issuing;
      const isCopied = await copying;

      setKey({ status: "issued", credential, token, isCopied, isCopiedAgain: false });
      queryClient.setQueryData<ListShortcutCredentialsResponse>(
        shortcutCredentialsQueryKey,
        (current) => current && { credentials: [credential, ...current.credentials] },
      );
    } catch {
      setKey({ status: "none", hasIssueError: true });
    }
  };

  const copyKeyAgain = async () => {
    if (key.status !== "issued") return;

    const isCopied = await copyTextToClipboard(key.token);
    setKey({ ...key, isCopied, isCopiedAgain: isCopied });
  };

  const markShortcutOpened = () => {
    setHasOpenedShortcut(true);
  };

  // 続きのキーがあり、この画面ではまだ発行していない。もう追加したかどうかは分からない。
  const isResumed = key.status === "none" && resumableCredential !== null;

  return {
    key,
    hasOpenedShortcut,
    isResumed,
    isWaitingForShare: hasOpenedShortcut || isResumed,
    issueAndCopyKey,
    copyKeyAgain,
    markShortcutOpened,
  };
};

export type ShortcutSetupState = ReturnType<typeof useShortcutSetup>;
