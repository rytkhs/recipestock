import { Trash, WarningCircle } from "@phosphor-icons/react";
import { type ShortcutCredential } from "@recipestock/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "../../components/section-header";
import {
  isShortcutCredentialUsed,
  listShortcutCredentials,
  revokeShortcutCredential,
  shortcutCredentialsQueryKey,
} from "./api";
import { formatCredentialDay, formatCredentialUsedDay } from "./credential-dates";

// 名前は発行した端末でしかない。ショートカットはiCloudで同期されうるので、使っている端末とは限らない。
// 同じ名前のキーは、最後に使った日と発行した日で見分ける。
const describeKey = (credential: ShortcutCredential) => {
  const usedDay = credential.lastUsedAt ? formatCredentialUsedDay(credential.lastUsedAt) : null;
  const issuedDay = formatCredentialDay(credential.createdAt);

  return {
    title: `${credential.name}で設定`,
    detail: [usedDay ? `最後に使ったのは${usedDay}` : null, issuedDay ? `${issuedDay}に発行` : null]
      .filter(Boolean)
      .join(" · "),
  };
};

const KeyList = ({
  credentials,
  onRevoke,
}: {
  credentials: ShortcutCredential[];
  onRevoke: (credential: ShortcutCredential) => void;
}) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="連携キー" />
      <ul aria-labelledby={headingId} className="divide-y divide-brand-line-soft">
        {credentials.map((credential) => {
          const description = describeKey(credential);

          return (
            <li className="flex min-h-14 min-w-0 items-center gap-3 py-2" key={credential.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-base text-brand-ink">{description.title}</p>
                <p className="text-brand-muted text-xs">{description.detail}</p>
              </div>
              <Button
                aria-label={`${description.title}（${description.detail}）のキーを解除`}
                size="icon-lg"
                variant="ghost"
                onClick={() => onRevoke(credential)}
              >
                <Trash weight="bold" />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/**
 * アカウントの連携キー。どの端末で開いても出し、なくした端末のキーを別の端末から解除できるようにする。
 * 出すのは使ったキーだけ。発行したまま共有が届いていないキーは設定の途中で残ったもので、利用者が片付けるものではなく、
 * 期限が過ぎれば使えなくなる。
 */
export const ShortcutKeys = () => {
  const queryClient = useQueryClient();
  const errorHeadingId = useId();
  const credentials = useQuery({
    queryKey: shortcutCredentialsQueryKey,
    queryFn: listShortcutCredentials,
  });
  const [revokeTarget, setRevokeTarget] = useState<ShortcutCredential | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const revokeMutation = useMutation({
    mutationFn: (credential: ShortcutCredential) => revokeShortcutCredential(credential.id),
    onSuccess: async () => {
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: shortcutCredentialsQueryKey });
    },
    onError: () => {
      setRevokeTarget(null);
      setRevokeError("キーを解除できませんでした。時間をおいて再度お試しください。");
    },
  });

  if (credentials.isError && !credentials.data) {
    return (
      <section aria-labelledby={errorHeadingId}>
        <SectionHeader id={errorHeadingId} title="連携キー" />
        <p className="mt-3 text-brand-danger text-sm" role="alert">
          連携キーを読み込めませんでした。
        </p>
      </section>
    );
  }

  const usedKeys = credentials.data?.credentials.filter(isShortcutCredentialUsed) ?? [];
  if (usedKeys.length === 0) {
    return null;
  }

  const startRevoke = (credential: ShortcutCredential) => {
    setRevokeError(null);
    setRevokeTarget(credential);
  };

  return (
    <div className="grid gap-6">
      {revokeError ? (
        <div className="rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
          <p className="text-brand-danger text-sm" role="alert">
            {revokeError}
          </p>
        </div>
      ) : null}

      <KeyList credentials={usedKeys} onRevoke={startRevoke} />

      <AlertDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(isOpen) => {
          if (!isOpen && !revokeMutation.isPending) {
            setRevokeTarget(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <WarningCircle weight="fill" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {revokeTarget ? `「${describeKey(revokeTarget).title}」のキーを解除しますか？` : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              このキーを入れたショートカットからは、取り込めなくなります。もう一度使うには、ショートカットを追加し直してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeMutation.isPending}
              variant="destructive"
              onClick={() => {
                if (revokeTarget) {
                  revokeMutation.mutate(revokeTarget);
                }
              }}
            >
              解除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
