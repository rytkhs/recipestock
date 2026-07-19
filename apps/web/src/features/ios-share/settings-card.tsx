import { Button, Input, Label, TextField } from "@heroui/react";
import { ShareNetwork, Trash } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { issueShortcutCredential, listShortcutCredentials, revokeShortcutCredential } from "./api";
import { isStandaloneWebApp } from "./display-mode";

const queryKey = ["shortcut-credentials"] as const;

export const IosShareSettingsCard = () => {
  const iosShareShortcutUrl = import.meta.env.VITE_IOS_SHARE_SHORTCUT_URL;
  const queryClient = useQueryClient();
  const standalone = isStandaloneWebApp();
  const [name, setName] = useState("iPhone");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const credentials = useQuery({
    queryKey,
    queryFn: listShortcutCredentials,
    enabled: standalone,
  });
  const createMutation = useMutation({
    mutationFn: () => issueShortcutCredential(name),
    onSuccess: async (result) => {
      setIssuedToken(result.token);
      setMessage(
        "連携トークンを発行しました。コピーしてShortcut追加時の「連携トークン」欄へ貼り付けてください。",
      );
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
          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextField className="min-w-0">
              <Label className="text-brand-walnut font-semibold text-sm">端末名</Label>
              <Input
                className="w-full min-w-0"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </TextField>
            <Button
              className="rounded-full bg-brand-sage font-semibold text-white hover:bg-brand-sage-dark"
              isDisabled={!name.trim() || createMutation.isPending}
              onPress={() => createMutation.mutate()}
            >
              連携トークンを発行
            </Button>
          </div>

          {issuedToken ? (
            <div className="mt-4 grid min-w-0 gap-3">
              <Input
                className="w-full min-w-0"
                aria-label="連携トークン"
                readOnly
                value={issuedToken}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  className="rounded-full font-semibold"
                  variant="secondary"
                  onPress={copyToken}
                >
                  トークンをコピー
                </Button>
                <a
                  className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-sage px-5 font-semibold text-white text-sm no-underline"
                  href={iosShareShortcutUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Shortcutを追加
                </a>
              </div>
            </div>
          ) : null}

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
              <p className="font-semibold text-brand-walnut text-sm">連携済み端末</p>
              {credentials.data?.credentials.map((credential) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-brand-line-soft p-3"
                  key={credential.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-brand-ink text-sm">{credential.name}</p>
                    <p className="text-brand-muted text-xs">末尾 {credential.tokenSuffix}</p>
                  </div>
                  <Button
                    aria-label={`${credential.name}の連携を解除`}
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={() => revokeMutation.mutate(credential.id)}
                  >
                    <Trash size={16} />
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
