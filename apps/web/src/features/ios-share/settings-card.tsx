import { ShareNetwork, Trash } from "@phosphor-icons/react";
import { type ShortcutCredential } from "@recipestock/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { issueShortcutCredential, listShortcutCredentials, revokeShortcutCredential } from "./api";
import { isStandaloneWebApp } from "./display-mode";

const queryKey = ["shortcut-credentials"] as const;

/**
 * 端末名は初回の共有でShortcutから届くので、発行した直後は名前がない (ADR 0025)。
 */
const deviceLabel = (credential: ShortcutCredential) =>
  credential.name ?? (credential.verifiedAt ? "連携済みの端末" : "連携待ちの端末");

export const IosShareSettingsCard = () => {
  const iosShareShortcutUrl = import.meta.env.VITE_IOS_SHARE_SHORTCUT_URL;
  const queryClient = useQueryClient();
  const standalone = isStandaloneWebApp();
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * Shortcutsアプリから戻ってきたときにfocusでの再取得が走り、連携済みの表示へ変わる。
   */
  const credentials = useQuery({
    queryKey,
    queryFn: listShortcutCredentials,
    enabled: standalone,
  });
  const createMutation = useMutation({
    mutationFn: issueShortcutCredential,
    onSuccess: async (result) => {
      setIssuedToken(result.token);
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: revokeShortcutCredential,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const copyToken = async () => {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      setMessage("連携トークンをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。表示されたトークンを選択してコピーしてください。");
    }
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
            PWAとしてRecipe Stockを開き、この設定画面からShortcut連携を設定します。
          </p>
        </div>
      ) : (
        <>
          {issuedToken ? (
            <div className="mt-4 grid min-w-0 gap-3">
              <ol className="grid list-decimal gap-1 pl-5 text-brand-muted text-sm">
                <li>下のボタンでShortcutを追加します。</li>
                <li>追加画面の「連携トークン」欄に貼り付けます。</li>
                <li>レシピのページを共有して、取り込みが始まれば連携完了です。</li>
              </ol>
              <Input
                className="w-full min-w-0"
                aria-label="連携トークン"
                readOnly
                value={issuedToken}
              />
              <div className="flex flex-wrap gap-2">
                <a
                  className={cn(buttonVariants(), "no-underline")}
                  href={iosShareShortcutUrl}
                  rel="noreferrer"
                  target="_blank"
                  onClick={() => {
                    void copyToken();
                  }}
                >
                  トークンをコピーしてShortcutを追加
                </a>
                <Button variant="secondary" onClick={copyToken}>
                  トークンをコピー
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
                連携トークンを発行
              </Button>
            </div>
          )}

          {message ? (
            <p className="mt-3 text-brand-muted text-sm" role="status">
              {message}
            </p>
          ) : null}
          {createMutation.isError ? (
            <p className="mt-3 text-brand-danger text-sm" role="alert">
              連携トークンを発行できませんでした。
            </p>
          ) : null}

          {(credentials.data?.credentials.length ?? 0) > 0 ? (
            <div className="mt-5 grid gap-2">
              <p className="font-semibold text-brand-walnut text-sm">連携した端末</p>
              {credentials.data?.credentials.map((credential) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-brand-line-soft p-3"
                  key={credential.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-brand-ink text-sm">
                      {deviceLabel(credential)}
                    </p>
                    <p className="text-brand-muted text-xs">
                      {credential.verifiedAt
                        ? `末尾 ${credential.tokenSuffix}・連携済み`
                        : `末尾 ${credential.tokenSuffix}・共有してテストすると完了します`}
                    </p>
                  </div>
                  <Button
                    aria-label={`${deviceLabel(credential)}の連携を解除`}
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
