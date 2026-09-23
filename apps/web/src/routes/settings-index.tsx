import {
  CaretLeft,
  CreditCard,
  EnvelopeSimple,
  LockKey,
  ShareNetwork,
  SignIn,
  SignOut,
  Tag,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
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
import { useLoginMethods } from "../features/settings/login-methods";
import {
  SettingsActionRow,
  SettingsGroup,
  SettingsLinkRow,
  SettingsRowSkeleton,
  SettingsValueRow,
} from "../features/settings/settings-list";
import { settingsPageBodyClass, settingsPageClass } from "../features/settings/settings-page";
import { useSignOut } from "../features/settings/use-sign-out";
import { listTags, tagsQueryKeys } from "../features/tags";
import { useAuthSession } from "../lib/auth";
import { useGoBack } from "../lib/navigation";
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

/**
 * パスワードを持たない人には、メールアドレスもパスワードも変更の行を出さない。
 * パスワードは持っておらず、メールアドレスはログインに使わないため。
 * かわりに、今のアドレスと、何でログインしているかを見せる。
 */
const AccountRows = ({
  email,
  loginMethods,
}: {
  email: string | undefined;
  loginMethods: ReturnType<typeof useLoginMethods>;
}) => {
  if (loginMethods.isPending) {
    return (
      <>
        <SettingsRowSkeleton />
        <SettingsRowSkeleton />
      </>
    );
  }

  // 読めなかったときは今までどおり変更の行を出す。消すと、パスワードを持つ人が変更手段を失う。
  if (!loginMethods.data || loginMethods.data.hasPassword) {
    return (
      <>
        <SettingsLinkRow
          icon={<EnvelopeSimple size={rowIconSize} weight="bold" />}
          label="メールアドレス"
          to="/settings/email"
          value={email}
        />
        <SettingsLinkRow
          icon={<LockKey size={rowIconSize} weight="bold" />}
          label="パスワード"
          to="/settings/password"
        />
      </>
    );
  }

  // このアプリのログイン方法はメールアドレスとパスワード、Googleの2つだけ。
  // パスワードを持たない人はGoogleでログインしている。
  return (
    <>
      <SettingsValueRow
        icon={<EnvelopeSimple size={rowIconSize} weight="bold" />}
        label="メールアドレス"
        value={email ?? ""}
      />
      <SettingsValueRow
        icon={<SignIn size={rowIconSize} weight="bold" />}
        label="ログイン方法"
        value="Google"
      />
    </>
  );
};

export const SettingsIndexRoute = () => {
  const goBack = useGoBack({ to: "/recipes" });
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
  const loginMethods = useLoginMethods();
  const { clearSignOutError, isSigningOut, signOutAndGoToLogin, signOutError } = useSignOut();
  const [isSignOutDialogOpen, setIsSignOutDialogOpen] = useState(false);

  return (
    <section className={settingsPageClass}>
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton aria-label="戻る" onPress={goBack}>
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
          <AccountRows email={session.data?.user.email} loginMethods={loginMethods} />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsActionRow
            icon={<SignOut size={rowIconSize} weight="bold" />}
            label="ログアウト"
            onPress={() => {
              clearSignOutError();
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
            <AlertDialogAction disabled={isSigningOut} onClick={() => void signOutAndGoToLogin()}>
              ログアウト
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
