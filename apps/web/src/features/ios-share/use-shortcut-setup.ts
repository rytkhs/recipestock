import {
  type ListShortcutCredentialsResponse,
  type ShortcutCredential,
} from "@recipestock/schemas";
import { IOS_SHARE_SETUP_CHECK_PATH } from "@recipestock/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
 * ③で共有メニューを開いてからの状態。押せるのは`idle`、`unconfirmed`、`failed`のときだけ。
 * ②の前（`isWaitingForShare`でない）は、状態によらず押せない。
 */
export type ShareCheckPhase =
  /** まだ押していない。 */
  | "idle"
  /** 共有メニューが前に出ていて、結果が返っていない。 */
  | "sharing"
  /** 共有メニューの項目が完了を返した。届くまでの揺れの分だけ待つ。 */
  | "checking"
  /** 待っても進まなかった。または、どの項目も完了を返さなかった。 */
  | "unconfirmed"
  /** 共有メニューを開く前に失敗した。 */
  | "failed";

// 共有メニューが閉じてから、届いたキーの記録が一覧に出るまでの揺れの分。
const shareCheckWaitMs = 5000;

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
  const [shareCheck, setShareCheck] = useState<ShareCheckPhase>("idle");
  const [lastUsedAtAtShare, setLastUsedAtAtShare] = useState<ReadonlyMap<
    string,
    string | null
  > | null>(null);

  useEffect(() => {
    if (shareCheck !== "checking") return;

    const timeoutId = setTimeout(() => setShareCheck("unconfirmed"), shareCheckWaitMs);
    return () => clearTimeout(timeoutId);
  }, [shareCheck]);

  const issueAndCopyKey = async () => {
    setKey({ status: "issuing" });
    // 新しいキーは、ショートカットを追加し直して貼るまで使われない。発行している間も②を押せないようにする。
    // ③も押せなくなるので、前に確かめた結果は出さない。押したときに覚えた`lastUsedAt`も捨て、
    // 新しいキーを入れる間に、ほかの端末からの共有でこの画面が完了にならないようにする。
    setHasOpenedShortcut(false);
    setShareCheck("idle");
    setLastUsedAtAtShare(null);

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

  const refetchCredentials = () => {
    void queryClient.invalidateQueries({ queryKey: shortcutCredentialsQueryKey });
  };

  /**
   * 設定画面そのもののURLを共有メニューに渡す（apiはこれを設定の確認として扱う）。共有メニューはユーザー操作の中でしか
   * 開けないので、タップの処理の中で、awaitを挟まずに呼ぶ。
   * 届いたかどうかは、押した時点からキーの`lastUsedAt`が進んだかで知る。WebKitの結果は、どの項目が完了したかを区別しない。
   */
  const openShareSheet = () => {
    const credentials =
      queryClient.getQueryData<ListShortcutCredentialsResponse>(shortcutCredentialsQueryKey)
        ?.credentials ?? [];
    setLastUsedAtAtShare(new Map(credentials.map(({ id, lastUsedAt }) => [id, lastUsedAt])));

    if (!("share" in navigator)) {
      setShareCheck("failed");
      return;
    }

    setShareCheck("sharing");
    navigator
      .share({ url: new URL(IOS_SHARE_SETUP_CHECK_PATH, window.location.origin).toString() })
      .then(
        () => {
          setShareCheck("checking");
          refetchCredentials();
        },
        (error: unknown) => {
          // 何も選ばずに閉じたほか、「Recipe Stock」を選んだがショートカットが完了しなかったときも含む。
          // requestを送ったあとで止まっていれば届いているので、待たずに案内を出しつつ、すぐ読み直す。
          if (error instanceof DOMException && error.name === "AbortError") {
            setShareCheck("unconfirmed");
            refetchCredentials();
            return;
          }
          setShareCheck("failed");
        },
      );
  };

  // 続きのキーがあり、この画面ではまだ発行していない。もう追加したかどうかは分からない。
  const isResumed = key.status === "none" && resumableCredential !== null;

  return {
    key,
    hasOpenedShortcut,
    isResumed,
    isWaitingForShare: hasOpenedShortcut || isResumed,
    shareCheck,
    /** ③を最後に押した時点の、キーごとの`lastUsedAt`。押していないか、そのあと発行し直したら`null`。 */
    lastUsedAtAtShare,
    issueAndCopyKey,
    copyKeyAgain,
    markShortcutOpened,
    openShareSheet,
  };
};

export type ShortcutSetupState = ReturnType<typeof useShortcutSetup>;
