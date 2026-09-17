import { ShareNetwork, Trash } from "@phosphor-icons/react";
import { IOS_SHARE_SHORTCUT_SETUP_TEST_PATH, type ShortcutCredential } from "@recipestock/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { issueShortcutCredential, listShortcutCredentials, revokeShortcutCredential } from "./api";
import { isStandaloneWebApp } from "./display-mode";

const queryKey = ["shortcut-credentials"] as const;

type IssuedToken = { credentialId: string; token: string };

/**
 * 最も新しい連携トークンが使われたかどうかで決める。iOSはショートカットAppへ
 * 切り替えている間にPWAを読み込み直すことがあるため、画面内の状態に頼らない（ADR 0025）。
 */
type SetupPhase = "unset" | "pending" | "connected";

export const shortcutInstallRedirect = {
  assign(url: string) {
    window.location.assign(url);
  },
};

/** iPadOSのSafariはMacのUAを名乗るため、タッチ点数で見分ける。 */
const defaultDeviceName = () => {
  const { maxTouchPoints, userAgent } = navigator;
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
    return "iPad";
  }
  if (/iPhone/.test(userAgent)) {
    return "iPhone";
  }
  return "この端末";
};

/**
 * Safariはユーザー操作の中でしかクリップボードへ書き込ませない。発行を待つ前に書き込みを
 * 始め、発行APIの応答はPromiseのまま`ClipboardItem`へ渡す。発行を待つ間に失敗が
 * 未処理のまま残らないよう、成否の真偽値で返す。
 */
const writeTokenToClipboard = (token: Promise<string>): Promise<boolean> => {
  try {
    return navigator.clipboard
      .write([
        new ClipboardItem({
          "text/plain": token.then((value) => new Blob([value], { type: "text/plain" })),
        }),
      ])
      .then(
        () => true,
        () => false,
      );
  } catch {
    return Promise.resolve(false);
  }
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

const formatAddedDate = (date: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));

const setupPhaseOf = (credentials: ShortcutCredential[]): SetupPhase => {
  const [latest] = credentials;
  if (!latest) return "unset";
  return latest.firstUsedAt ? "connected" : "pending";
};

export const IosShareSettingsCard = () => {
  const iosShareShortcutUrl = import.meta.env.VITE_IOS_SHARE_SHORTCUT_URL;
  const queryClient = useQueryClient();
  const standalone = isStandaloneWebApp();
  const canShare = typeof navigator.share === "function";
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [issueFailed, setIssueFailed] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const credentials = useQuery({
    queryKey,
    queryFn: listShortcutCredentials,
    enabled: standalone,
  });
  const revokeMutation = useMutation({
    mutationFn: revokeShortcutCredential,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const credentialList = credentials.data?.credentials ?? [];
  const phase = credentials.data ? setupPhaseOf(credentialList) : null;
  const previousPhase = useRef<SetupPhase | null>(null);

  useEffect(() => {
    if (!phase) return;
    if (previousPhase.current === "pending" && phase === "connected") {
      setCopyFailed(false);
      setMessage("連携できました。レシピのページから同じように共有すると保存できます。");
    }
    previousPhase.current = phase;
  }, [phase]);

  const addShortcut = async () => {
    setIssueFailed(false);
    setCopyFailed(false);
    setMessage(null);

    // 同じ画面で発行した未使用のトークンは、貼り付けに失敗したときの再追加で使い回す。
    const reusable =
      issued &&
      credentialList.find((credential) => credential.id === issued.credentialId)?.firstUsedAt ===
        null
        ? issued
        : null;
    const issuing = reusable
      ? Promise.resolve(reusable)
      : issueShortcutCredential(defaultDeviceName()).then((result) => ({
          credentialId: result.credential.id,
          token: result.token,
        }));
    const copying = writeTokenToClipboard(issuing.then(({ token }) => token));

    setIsAdding(true);
    try {
      let issuedToken: IssuedToken;
      try {
        issuedToken = await issuing;
      } catch {
        setIssueFailed(true);
        return;
      }
      setIssued(issuedToken);
      void queryClient.invalidateQueries({ queryKey });

      if (!(await copying)) {
        setCopyFailed(true);
        return;
      }
      shortcutInstallRedirect.assign(iosShareShortcutUrl);
    } finally {
      setIsAdding(false);
    }
  };

  const copyIssuedToken = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setMessage("連携トークンをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。表示されたトークンを選択してコピーしてください。");
    }
  };

  const shareSetupTest = async () => {
    setMessage(null);
    try {
      await navigator.share({
        url: new URL(IOS_SHARE_SHORTCUT_SETUP_TEST_PATH, window.location.origin).toString(),
      });
    } catch (error) {
      if (!isAbortError(error)) {
        setMessage("共有メニューを開けませんでした。");
      }
      return;
    }
    // 共有シートは画面に重なるだけでvisibilitychangeが起きないため、ここで取り直す。
    await queryClient.invalidateQueries({ queryKey });
  };

  return (
    <div className="min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <ShareNetwork size={18} weight="bold" className="text-brand-walnut" />
        <h2 className="text-brand-walnut font-bold text-lg">共有から取り込む</h2>
      </div>
      <p className="text-brand-muted text-sm">
        iPhoneやiPadの共有メニューからURLを共有すると、Recipe
        Stockへの取り込みを直接開始します。通知を許可している場合は、完了をお知らせします。
      </p>

      {!standalone ? (
        <div className="mt-4 rounded-[14px] border border-brand-sage-soft bg-brand-sage-soft/20 p-4">
          <p className="font-semibold text-brand-walnut">
            先にRecipe Stockをホーム画面へ追加してください。
          </p>
          <p className="mt-1 text-brand-muted text-sm">
            PWAとしてRecipe Stockを開き、この設定画面からショートカットを追加します。
          </p>
        </div>
      ) : (
        <>
          {phase === "unset" ? (
            <div className="mt-4 grid min-w-0 gap-3">
              <p className="text-brand-muted text-sm">
                連携トークンをコピーしてから、ショートカットの追加画面を開きます。追加画面では、トークンの欄を長押しして貼り付けてください。
              </p>
              <div>
                <Button disabled={isAdding} onClick={() => void addShortcut()}>
                  ショートカットを追加
                </Button>
              </div>
            </div>
          ) : null}

          {phase === "pending" ? (
            <div className="mt-4 grid min-w-0 gap-3 rounded-[14px] border border-brand-sage-soft bg-brand-sage-soft/20 p-4">
              <p className="font-semibold text-brand-walnut">
                ショートカットを追加したら、試しに共有してください
              </p>
              <p className="text-brand-muted text-sm">
                共有メニューの下のほうにある「Recipe
                Stockに保存」を選びます。初めて使うときは送信の許可を求められるので、許可してください。
              </p>
              <div className="flex flex-wrap gap-2">
                {canShare ? (
                  <Button onClick={() => void shareSetupTest()}>試しに共有する</Button>
                ) : null}
                <Button disabled={isAdding} variant="secondary" onClick={() => void addShortcut()}>
                  もう一度追加する
                </Button>
              </div>
              <p className="text-brand-muted text-xs">
                もう一度追加するときは、ショートカットAppで前に追加した「Recipe
                Stockに保存」を削除してください。
              </p>
            </div>
          ) : null}

          {phase === "connected" ? (
            <div className="mt-4 grid min-w-0 gap-3">
              <p className="text-brand-muted text-sm">
                共有メニューの「Recipe Stockに保存」から取り込めます。
              </p>
              <div>
                <Button disabled={isAdding} variant="secondary" onClick={() => void addShortcut()}>
                  別の端末に追加
                </Button>
              </div>
            </div>
          ) : null}

          {phase === "pending" || phase === "connected" ? (
            <p className="mt-3 text-brand-muted text-xs">
              Instagram・TikTok・Xでは、共有画面の「その他」から共有メニューを開きます。
            </p>
          ) : null}

          {copyFailed && issued ? (
            <div className="mt-4 grid min-w-0 gap-3">
              <p className="text-brand-danger text-sm" role="alert">
                連携トークンをコピーできませんでした。トークンをコピーしてから、ショートカットを追加してください。
              </p>
              <Input
                className="w-full min-w-0"
                aria-label="連携トークン"
                readOnly
                value={issued.token}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void copyIssuedToken()}>
                  トークンをコピー
                </Button>
                <a className={cn(buttonVariants(), "no-underline")} href={iosShareShortcutUrl}>
                  ショートカットを追加
                </a>
              </div>
            </div>
          ) : null}

          {credentials.isError ? (
            <p className="mt-4 text-brand-danger text-sm" role="alert">
              連携の状態を確認できませんでした。時間をおいて再度お試しください。
            </p>
          ) : null}
          {message ? (
            <p className="mt-3 text-brand-muted text-sm" role="status">
              {message}
            </p>
          ) : null}
          {issueFailed ? (
            <p className="mt-3 text-brand-danger text-sm" role="alert">
              連携トークンを発行できませんでした。
            </p>
          ) : null}

          {credentialList.length > 0 ? (
            <div className="mt-5 grid gap-2">
              <p className="font-semibold text-brand-walnut text-sm">連携済み端末</p>
              {credentialList.map((credential) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-brand-line-soft p-3"
                  key={credential.id}
                >
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-2 font-medium text-brand-ink text-sm">
                      <span className="truncate">{credential.name}</span>
                      {credential.firstUsedAt ? null : (
                        <span className="shrink-0 rounded-full bg-brand-sage-soft/40 px-2 py-0.5 font-normal text-brand-muted text-xs">
                          未接続
                        </span>
                      )}
                    </p>
                    <p className="text-brand-muted text-xs">
                      {formatAddedDate(credential.createdAt)}に追加・末尾 {credential.tokenSuffix}
                    </p>
                  </div>
                  <Button
                    aria-label={`${credential.name}の連携を解除`}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => revokeMutation.mutate(credential.id)}
                  >
                    <Trash />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};
