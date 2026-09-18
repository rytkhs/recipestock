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
  listShortcutCredentials,
  revokeShortcutCredential,
  shortcutCredentialsQueryKey,
} from "./api";

// 同じ名前の端末を見分けられるよう、連携した日を添える。
const formatLinkedDate = (createdAt: string, now = new Date()) => {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();

  return date.getFullYear() === now.getFullYear()
    ? `${month}月${day}日`
    : `${date.getFullYear()}年${month}月${day}日`;
};

const describeCredential = (credential: ShortcutCredential) => {
  const linkedDate = formatLinkedDate(credential.createdAt);
  const suffix = `末尾 ${credential.tokenSuffix}`;
  return linkedDate ? `${linkedDate}に連携 · ${suffix}` : suffix;
};

/**
 * 連携している端末の一覧。アカウント全体の情報なので、ホーム画面から開いていなくても出し、
 * なくした端末の連携を別の端末から解除できるようにする。1台もなければ段ごと出さない。
 */
export const LinkedDevices = () => {
  const queryClient = useQueryClient();
  const headingId = useId();
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
      setRevokeError("連携を解除できませんでした。時間をおいて再度お試しください。");
    },
  });

  if (credentials.isError) {
    return (
      <section aria-labelledby={headingId}>
        <SectionHeader id={headingId} title="連携している端末" />
        <p className="mt-3 text-brand-danger text-sm" role="alert">
          連携している端末を読み込めませんでした。
        </p>
      </section>
    );
  }

  if (!credentials.data || credentials.data.credentials.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="連携している端末" />
      {revokeError ? (
        <div className="mt-3 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
          <p className="text-brand-danger text-sm" role="alert">
            {revokeError}
          </p>
        </div>
      ) : null}
      <ul aria-labelledby={headingId} className="divide-y divide-brand-line-soft">
        {credentials.data.credentials.map((credential) => (
          <li className="flex min-h-14 min-w-0 items-center gap-3 py-2" key={credential.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-base text-brand-ink">{credential.name}</p>
              <p className="text-brand-muted text-xs">{describeCredential(credential)}</p>
            </div>
            <Button
              aria-label={`「${credential.name}」の連携を解除`}
              size="icon-lg"
              variant="ghost"
              onClick={() => {
                setRevokeError(null);
                setRevokeTarget(credential);
              }}
            >
              <Trash weight="bold" />
            </Button>
          </li>
        ))}
      </ul>

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
              {revokeTarget ? `「${revokeTarget.name}」の連携を解除しますか？` : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              この端末のショートカットからは取り込めなくなります。もう一度使うには、連携キーを発行し直してください。
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
    </section>
  );
};
