import {
  CaretLeft,
  CreditCard,
  EnvelopeSimple,
  LockKey,
  ShareNetwork,
  SignOut,
  Tag,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScreenTopBar, ScreenTopBarIconButton } from "../components/screen-top-bar";
import { billingStatusQueryKey, fetchBillingStatus } from "../features/billing/api";
import { derivePlanState, planRowValue } from "../features/billing/plan-state";
import { listShortcutCredentials, shortcutCredentialsQueryKey } from "../features/ios-share/api";
import {
  deactivatePushSubscription,
  getCurrentPushSubscription,
  supportsPushNotifications,
} from "../features/push-notifications/browser";
import { readRecipeListFilters } from "../features/recipes/list-search";
import {
  SettingsActionRow,
  SettingsGroup,
  SettingsLinkRow,
} from "../features/settings/settings-list";
import { settingsPageBodyClass, settingsPageClass } from "../features/settings/settings-page";
import { listTags, tagsQueryKeys } from "../features/tags";
import { signOut, useAuthSession } from "../lib/auth";
import { clearUserScopedCache } from "../lib/query-cache";
import { useViewer } from "../lib/viewer";

const rowIconSize = 20;

// 読み込み中は"loading"、読めなかったときはundefinedにして、行には何も出さない。
const rowValue = <T,>(
  query: { data: T | undefined; isPending: boolean },
  format: (data: T) => string,
) => {
  if (query.data !== undefined) return format(query.data);
  return query.isPending ? ("loading" as const) : undefined;
};

export const SettingsIndexRoute = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const viewer = useViewer({ enabled: true });
  const isPro = viewer.data?.plan === "pro";
  // 解約の予約や支払いの遅れはProにしかないので、契約の状態はProのときだけ読む。
  const billingStatus = useQuery({
    queryKey: billingStatusQueryKey,
    queryFn: fetchBillingStatus,
    enabled: isPro,
    retry: false,
  });
  // Proは契約の状態を待ってから出す。契約を読めなければ、分かっているプラン名だけを出す。
  const isPlanLoading = viewer.isPending || (isPro && billingStatus.isPending);
  const planRow =
    viewer.data && !isPlanLoading
      ? planRowValue(derivePlanState(viewer.data, billingStatus.data))
      : undefined;
  const tags = useQuery({ queryKey: tagsQueryKeys.all(), queryFn: listTags });
  const shortcutCredentials = useQuery({
    queryKey: shortcutCredentialsQueryKey,
    queryFn: listShortcutCredentials,
  });
  const [isSignOutDialogOpen, setIsSignOutDialogOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setSignOutError(null);
    let pushCleanupCompleted = false;

    try {
      if (supportsPushNotifications()) {
        const subscription = await getCurrentPushSubscription();
        if (subscription) {
          const { browserCleanupSucceeded, serverCleanupSucceeded } =
            await deactivatePushSubscription(subscription);
          if (!browserCleanupSucceeded && !serverCleanupSucceeded) {
            throw new Error("push_subscription_cleanup_failed");
          }
        }
      }
      pushCleanupCompleted = true;

      await signOut();
      clearUserScopedCache(queryClient);
      await session.refetch();
      await navigate({ to: "/login" });
    } catch {
      setSignOutError(
        pushCleanupCompleted
          ? "ログアウトできませんでした。時間をおいて再度お試しください。"
          : "通知を解除できなかったため、ログアウトを中止しました。時間をおいて再度お試しください。",
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <section className={settingsPageClass}>
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton
            aria-label="レシピ一覧へ戻る"
            onPress={() => {
              void navigate({ to: "/recipes", search: readRecipeListFilters() });
            }}
          >
            <CaretLeft size={21} weight="bold" />
          </ScreenTopBarIconButton>
        }
        title="設定"
      />

      <div className={`${settingsPageBodyClass} grid gap-6`}>
        <SettingsGroup>
          <SettingsLinkRow
            icon={<CreditCard size={rowIconSize} weight="bold" />}
            label="プラン"
            to="/settings/billing"
            value={isPlanLoading ? "loading" : planRow?.text}
            valueTone={planRow?.tone}
          />
          <SettingsLinkRow
            icon={<ShareNetwork size={rowIconSize} weight="bold" />}
            label="共有から取り込む"
            to="/settings/share"
            value={rowValue(shortcutCredentials, ({ credentials }) =>
              credentials.length > 0 ? `${credentials.length}台と連携中` : "未設定",
            )}
          />
          <SettingsLinkRow
            icon={<Tag size={rowIconSize} weight="bold" />}
            label="タグ"
            to="/tags"
            value={rowValue(tags, (items) => (items.length > 0 ? `${items.length}個` : "なし"))}
          />
        </SettingsGroup>

        <SettingsGroup title="アカウント">
          <SettingsLinkRow
            icon={<EnvelopeSimple size={rowIconSize} weight="bold" />}
            label="メールアドレス"
            to="/settings/email"
            value={session.data?.user.email}
          />
          <SettingsLinkRow
            icon={<LockKey size={rowIconSize} weight="bold" />}
            label="パスワード"
            to="/settings/password"
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsActionRow
            icon={<SignOut size={rowIconSize} weight="bold" />}
            label="ログアウト"
            onPress={() => {
              setSignOutError(null);
              setIsSignOutDialogOpen(true);
            }}
          />
        </SettingsGroup>
      </div>

      <AlertDialog
        open={isSignOutDialogOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isSigningOut) {
            setIsSignOutDialogOpen(false);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>ログアウトしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              この端末で取り込み完了の通知を受け取っている場合は、それも止まります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {signOutError ? (
            <p className="text-brand-danger text-sm" role="alert">
              {signOutError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSigningOut}>キャンセル</AlertDialogCancel>
            <AlertDialogAction disabled={isSigningOut} onClick={() => void handleSignOut()}>
              ログアウト
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
