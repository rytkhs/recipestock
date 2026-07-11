import { Button, Input, Label, TextField } from "@heroui/react";
import { CreditCard, Gear, SignOut, User } from "@phosphor-icons/react";
import {
  type CreateBillingPortalResponse,
  type CreateCheckoutResponse,
  type GetBillingStatusResponse,
} from "@recipestock/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { IosShareSettingsCard } from "../features/ios-share/settings-card";
import { ApiClientError, api, parseApiResponse } from "../lib/api";
import { changeEmail, changePassword, signOut, useAuthSession } from "../lib/auth";
import { billingStatusQueryKey } from "../lib/billing";
import { clearUserScopedCache } from "../lib/query-cache";
import { useViewer, viewerQueryKey } from "../lib/viewer";

const createCheckout = () =>
  parseApiResponse<CreateCheckoutResponse>(api.api.billing.checkout.$post());

const createBillingPortal = () =>
  parseApiResponse<CreateBillingPortalResponse>(api.api.billing.portal.$post());

const fetchBillingStatus = () =>
  parseApiResponse<GetBillingStatusResponse>(api.api.billing.status.$get());

export const checkoutRedirect = {
  assign(url: string) {
    window.location.assign(url);
  },
};

const checkoutMessage = (checkout: unknown) => {
  if (checkout === "success") {
    return "契約処理を受け付けました。反映には少し時間がかかる場合があります。";
  }

  if (checkout === "cancel") {
    return "契約手続きはキャンセルされました。";
  }

  return null;
};

const checkoutErrorMessage = (error: unknown) => {
  if (error instanceof ApiClientError && error.code === "already_subscribed") {
    return "既にPro契約があります。表示を更新してください。";
  }

  return "Checkoutを開始できませんでした。時間をおいて再度お試しください。";
};

const formatBillingDate = (date: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));

export const SettingsIndexRoute = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const viewer = useViewer({ enabled: true });
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    clearUserScopedCache(queryClient);
    await session.refetch();
    await navigate({ to: "/login" });
  };

  const handleEmailChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailMessage(null);
    setEmailError(null);
    setIsEmailSubmitting(true);

    try {
      await changeEmail(newEmail);
      setNewEmail("");
      setEmailMessage("確認メールを送信しました。");
    } catch {
      setEmailError("メールアドレスを変更できませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordMessage(null);
    setPasswordError(null);
    setIsPasswordSubmitting(true);

    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMessage("パスワードを変更しました。");
    } catch {
      setPasswordError("パスワードを変更できませんでした。入力内容を確認してください。");
    } finally {
      setIsPasswordSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mb-6 flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-sage-soft text-brand-sage">
          <Gear size={20} weight="bold" />
        </div>
        <h1 className="text-brand-ink font-bold text-2xl">設定</h1>
      </div>

      <div className="grid min-w-0 gap-5">
        <div className="min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
          <div className="mb-4 flex min-w-0 items-center gap-2">
            <User size={18} weight="bold" className="text-brand-walnut" />
            <h2 className="text-brand-walnut font-bold text-lg">アカウント</h2>
          </div>
          <p className="break-all text-brand-muted text-sm">
            現在のメールアドレス: {viewer.data?.email ?? ""}
          </p>
          <div className="mt-5 grid min-w-0 gap-6 md:grid-cols-2">
            <form className="grid min-w-0 content-start gap-4" onSubmit={handleEmailChange}>
              <h3 className="text-brand-walnut font-semibold text-base">メールアドレス変更</h3>
              <TextField className="min-w-0" isRequired type="email">
                <Label className="text-brand-walnut font-semibold text-sm">
                  新しいメールアドレス
                </Label>
                <Input
                  autoComplete="email"
                  className="w-full min-w-0"
                  inputMode="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                />
              </TextField>
              <Button
                className="rounded-full font-semibold"
                isDisabled={isEmailSubmitting}
                type="submit"
                variant="secondary"
              >
                確認メールを送信
              </Button>
              {emailMessage ? (
                <div className="rounded-[14px] bg-brand-sage-soft/30 border border-brand-sage-soft p-3">
                  <p className="font-medium text-brand-sage-dark text-sm" role="status">
                    {emailMessage}
                  </p>
                </div>
              ) : null}
              {emailError ? (
                <div className="rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
                  <p className="text-brand-danger text-sm" role="alert">
                    {emailError}
                  </p>
                </div>
              ) : null}
            </form>

            <form className="grid min-w-0 content-start gap-4" onSubmit={handlePasswordChange}>
              <h3 className="text-brand-walnut font-semibold text-base">パスワード変更</h3>
              <TextField className="min-w-0" isRequired type="password">
                <Label className="text-brand-walnut font-semibold text-sm">現在のパスワード</Label>
                <Input
                  autoComplete="current-password"
                  className="w-full min-w-0"
                  maxLength={128}
                  minLength={8}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </TextField>
              <TextField className="min-w-0" isRequired type="password">
                <Label className="text-brand-walnut font-semibold text-sm">新しいパスワード</Label>
                <Input
                  autoComplete="new-password"
                  className="w-full min-w-0"
                  maxLength={128}
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </TextField>
              <Button
                className="rounded-full font-semibold"
                isDisabled={isPasswordSubmitting}
                type="submit"
                variant="secondary"
              >
                パスワードを変更
              </Button>
              {passwordMessage ? (
                <div className="rounded-[14px] bg-brand-sage-soft/30 border border-brand-sage-soft p-3">
                  <p className="font-medium text-brand-sage-dark text-sm" role="status">
                    {passwordMessage}
                  </p>
                </div>
              ) : null}
              {passwordError ? (
                <div className="rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
                  <p className="text-brand-danger text-sm" role="alert">
                    {passwordError}
                  </p>
                </div>
              ) : null}
            </form>
          </div>
        </div>

        <div className="min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
          <div className="mb-3 flex min-w-0 items-center gap-2">
            <CreditCard size={18} weight="bold" className="text-brand-walnut" />
            <h2 className="text-brand-walnut font-bold text-lg">プラン</h2>
          </div>
          <p className="text-brand-muted text-sm">
            現在のプラン:{" "}
            <span className="font-semibold text-brand-ink">
              {viewer.data?.plan === "pro" ? "Pro" : "Free"}
            </span>
          </p>
          <Link
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-brand-sage px-5 font-semibold text-white text-sm hover:bg-brand-sage-dark transition-colors"
            to="/settings/billing"
          >
            課金設定
          </Link>
        </div>

        <IosShareSettingsCard />
      </div>

      <div className="mt-8 flex justify-center">
        <Button
          className="rounded-full text-brand-danger border-none bg-transparent hover:bg-brand-danger/5 gap-1.5"
          variant="ghost"
          onPress={() => void handleSignOut()}
        >
          <SignOut size={16} weight="bold" />
          ログアウト
        </Button>
      </div>
    </section>
  );
};

export const SettingsBillingRoute = () => {
  const queryClient = useQueryClient();
  const viewer = useViewer({ enabled: true });
  const billingStatus = useQuery({
    queryKey: billingStatusQueryKey,
    queryFn: fetchBillingStatus,
    retry: false,
  });
  const search = useRouterState({ select: (state) => state.location.search });
  const [error, setError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPortalSubmitting, setIsPortalSubmitting] = useState(false);
  const message = checkoutMessage((search as { checkout?: unknown }).checkout);
  const plan = billingStatus.data?.plan ?? viewer.data?.plan;
  const isPro = plan === "pro";
  const subscription = billingStatus.data?.subscription;
  const cancellationMessage =
    subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd
      ? `解約予約中。${formatBillingDate(subscription.currentPeriodEnd)} までは Pro を利用できます。`
      : null;

  const startCheckout = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await createCheckout();
      checkoutRedirect.assign(response.url);
    } catch (checkoutError) {
      setError(checkoutErrorMessage(checkoutError));

      if (checkoutError instanceof ApiClientError && checkoutError.code === "already_subscribed") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: viewerQueryKey }),
          queryClient.invalidateQueries({ queryKey: billingStatusQueryKey }),
        ]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const openBillingPortal = async () => {
    setPortalError(null);
    setIsPortalSubmitting(true);

    try {
      const response = await createBillingPortal();
      checkoutRedirect.assign(response.url);
    } catch {
      setPortalError("請求管理を開けませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsPortalSubmitting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mb-6 flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-orange-soft text-brand-orange">
          <CreditCard size={20} weight="bold" />
        </div>
        <h1 className="text-brand-ink font-bold text-2xl">課金設定</h1>
      </div>

      {message ? (
        <div className="mb-6 min-w-0 rounded-[14px] border border-brand-line-soft bg-brand-paper p-4">
          <p className="text-brand-walnut text-sm">{message}</p>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 md:grid-cols-2">
        <div className="min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
          <h2 className="text-brand-walnut font-bold text-lg">現在のプラン</h2>
          <p className="mt-3 font-bold text-2xl text-brand-ink">{isPro ? "Pro" : "Free"}</p>
          {cancellationMessage ? (
            <div className="mt-3 rounded-[14px] bg-brand-paper-muted p-3">
              <p className="break-words text-brand-walnut text-sm">{cancellationMessage}</p>
            </div>
          ) : null}
          <p className="mt-3 text-brand-muted text-sm">
            保存件数:{" "}
            <span className="font-semibold text-brand-ink">{viewer.data?.recipeCount ?? 0}</span>
            {viewer.data?.recipeLimit === null ? "" : ` / ${viewer.data?.recipeLimit ?? 5}`}
          </p>
          <p className="mt-1 text-brand-muted text-sm">
            AI月次上限:{" "}
            <span className="font-semibold text-brand-ink">
              {viewer.data?.aiUsage.limit ?? 0} 回
            </span>
          </p>
        </div>

        <div className="min-w-0 rounded-[20px] border border-brand-line-soft bg-brand-paper p-5 shadow-pantry-sm sm:p-6">
          <h2 className="text-brand-walnut font-bold text-lg">Pro</h2>
          <p className="mt-2 text-brand-muted text-sm">
            保存件数の上限なしでレシピを保存できます。
          </p>
          {isPro ? (
            <div className="mt-4">
              <p className="font-semibold text-brand-sage text-sm">
                {cancellationMessage ? "Proは請求期間終了まで利用できます。" : "Pro契約中です。"}
              </p>
              <Button
                className="mt-4 rounded-full bg-brand-sage text-white font-semibold hover:bg-brand-sage-dark"
                isDisabled={isPortalSubmitting}
                type="button"
                variant="primary"
                onPress={() => void openBillingPortal()}
              >
                請求管理
              </Button>
            </div>
          ) : (
            <Button
              className="mt-4 rounded-full bg-brand-orange text-white font-semibold hover:bg-brand-orange-dark"
              isDisabled={isSubmitting}
              type="button"
              variant="primary"
              onPress={() => void startCheckout()}
            >
              Proにアップグレード
            </Button>
          )}
          {error ? (
            <div className="mt-4 rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
              <p className="break-words text-brand-danger text-sm" role="alert">
                {error}
              </p>
            </div>
          ) : null}
          {portalError ? (
            <div className="mt-4 rounded-[14px] bg-brand-danger/5 border border-brand-danger/20 p-3">
              <p className="break-words text-brand-danger text-sm" role="alert">
                {portalError}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
