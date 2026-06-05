import { Button, Input, Label, TextField } from "@heroui/react";
import {
  type CreateBillingPortalResponse,
  type CreateCheckoutResponse,
  type GetBillingStatusResponse,
} from "@recipestock/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ApiClientError, api, parseApiResponse } from "../lib/api";
import { changeEmail, changePassword } from "../lib/auth";
import { billingStatusQueryKey } from "../lib/billing";
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
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="font-semibold text-3xl">Settings</h1>
      <div className="mt-6 grid gap-4">
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-semibold text-xl">アカウント</h2>
          <p className="mt-2 text-default-600 text-sm">
            現在のメールアドレス: {viewer.data?.email ?? ""}
          </p>
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <form className="grid content-start gap-3" onSubmit={handleEmailChange}>
              <h3 className="font-semibold text-base">メールアドレス変更</h3>
              <TextField isRequired type="email">
                <Label>新しいメールアドレス</Label>
                <Input
                  autoComplete="email"
                  inputMode="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                />
              </TextField>
              <Button isDisabled={isEmailSubmitting} type="submit" variant="secondary">
                確認メールを送信
              </Button>
              {emailMessage ? (
                <p className="font-medium text-success" role="status">
                  {emailMessage}
                </p>
              ) : null}
              {emailError ? (
                <p className="text-danger" role="alert">
                  {emailError}
                </p>
              ) : null}
            </form>

            <form className="grid content-start gap-3" onSubmit={handlePasswordChange}>
              <h3 className="font-semibold text-base">パスワード変更</h3>
              <TextField isRequired type="password">
                <Label>現在のパスワード</Label>
                <Input
                  autoComplete="current-password"
                  maxLength={128}
                  minLength={8}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </TextField>
              <TextField isRequired type="password">
                <Label>新しいパスワード</Label>
                <Input
                  autoComplete="new-password"
                  maxLength={128}
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </TextField>
              <Button isDisabled={isPasswordSubmitting} type="submit" variant="secondary">
                パスワードを変更
              </Button>
              {passwordMessage ? (
                <p className="font-medium text-success" role="status">
                  {passwordMessage}
                </p>
              ) : null}
              {passwordError ? (
                <p className="text-danger" role="alert">
                  {passwordError}
                </p>
              ) : null}
            </form>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-semibold text-xl">プラン</h2>
          <p className="mt-2 text-default-600 text-sm">
            現在のプラン: {viewer.data?.plan === "pro" ? "Pro" : "Free"}
          </p>
          <Link
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-accent px-4 font-semibold text-accent-foreground text-sm"
            to="/settings/billing"
          >
            課金設定
          </Link>
        </div>
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
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="font-semibold text-3xl">課金設定</h1>
      {message ? (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-default-700">
          {message}
        </p>
      ) : null}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-semibold text-xl">現在のプラン</h2>
          <p className="mt-3 font-semibold text-2xl">{isPro ? "Pro" : "Free"}</p>
          {cancellationMessage ? (
            <p className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-default-700 text-sm">
              {cancellationMessage}
            </p>
          ) : null}
          <p className="mt-2 text-default-600 text-sm">
            保存件数: {viewer.data?.recipeCount ?? 0}
            {viewer.data?.recipeLimit === null ? "" : ` / ${viewer.data?.recipeLimit ?? 5}`}
          </p>
          <p className="mt-1 text-default-600 text-sm">
            AI月次上限: {viewer.data?.aiUsage.limit ?? 0} 回
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-semibold text-xl">Pro</h2>
          <p className="mt-2 text-default-600 text-sm">
            保存件数の上限なしでレシピを保存できます。
          </p>
          {isPro ? (
            <div className="mt-4">
              <p className="font-semibold text-accent">
                {cancellationMessage ? "Proは請求期間終了まで利用できます。" : "Pro契約中です。"}
              </p>
              <Button
                className="mt-4"
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
              className="mt-4"
              isDisabled={isSubmitting}
              type="button"
              variant="primary"
              onPress={() => void startCheckout()}
            >
              Pro契約
            </Button>
          )}
          {error ? (
            <p className="mt-4 text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {portalError ? (
            <p className="mt-4 text-danger" role="alert">
              {portalError}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
};
