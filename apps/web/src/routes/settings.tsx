import { Button } from "@heroui/react";
import { type CreateCheckoutResponse } from "@recipestock/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { ApiClientError, api, parseApiResponse } from "../lib/api";
import { useViewer, viewerQueryKey } from "../lib/viewer";

const createCheckout = () =>
  parseApiResponse<CreateCheckoutResponse>(api.api.billing.checkout.$post());

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

export const SettingsIndexRoute = () => {
  const viewer = useViewer({ enabled: true });

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="font-semibold text-3xl">Settings</h1>
      <div className="mt-6 grid gap-4">
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
  const search = useRouterState({ select: (state) => state.location.search });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const message = checkoutMessage((search as { checkout?: unknown }).checkout);
  const isPro = viewer.data?.plan === "pro";

  const startCheckout = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await createCheckout();
      checkoutRedirect.assign(response.url);
    } catch (checkoutError) {
      setError(checkoutErrorMessage(checkoutError));

      if (checkoutError instanceof ApiClientError && checkoutError.code === "already_subscribed") {
        await queryClient.invalidateQueries({ queryKey: viewerQueryKey });
      }
    } finally {
      setIsSubmitting(false);
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
            <p className="mt-4 font-semibold text-accent">Pro契約中です。</p>
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
        </div>
      </div>
    </section>
  );
};
