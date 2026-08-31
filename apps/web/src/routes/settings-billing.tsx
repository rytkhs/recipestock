import { Button } from "@heroui/react";
import { CaretLeft } from "@phosphor-icons/react";
import {
  type CreateBillingPortalResponse,
  type CreateCheckoutResponse,
  type GetBillingStatusResponse,
} from "@recipestock/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { ConnectionUnavailable } from "../components/connection-unavailable";
import { SettingsSkeleton } from "../components/loading";
import { ScreenTopBar, ScreenTopBarIconButton } from "../components/screen-top-bar";
import { ApiClientError, api, parseApiResponse } from "../lib/api";
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

export const SettingsBillingRoute = () => {
  const queryClient = useQueryClient();
  const viewer = useViewer({ enabled: true });
  const billingStatus = useQuery({
    queryKey: billingStatusQueryKey,
    queryFn: fetchBillingStatus,
    retry: false,
  });
  const navigate = useNavigate();
  const search = useRouterState({ select: (state) => state.location.search });
  const [error, setError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPortalSubmitting, setIsPortalSubmitting] = useState(false);
  const message = checkoutMessage((search as { checkout?: unknown }).checkout);
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

  // planと利用状況がすべてviewer由来なので、この画面だけはviewerを待つ。
  if (!viewer.data) {
    return viewer.isError ? (
      <ConnectionUnavailable
        isRetrying={viewer.isFetching}
        onRetry={async () => {
          await viewer.refetch();
        }}
      />
    ) : (
      <SettingsSkeleton />
    );
  }

  const isPro = (billingStatus.data?.plan ?? viewer.data.plan) === "pro";

  return (
    <section className="mx-auto w-full max-w-[1120px] px-0 pb-10 sm:px-6 lg:px-10">
      <ScreenTopBar
        leading={
          <ScreenTopBarIconButton
            aria-label="設定へ戻る"
            onPress={() => {
              void navigate({ to: "/settings" });
            }}
          >
            <CaretLeft size={21} weight="bold" />
          </ScreenTopBarIconButton>
        }
        title="課金設定"
      />

      <div className="mt-4 px-4 sm:mt-6 sm:px-0">
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
              <span className="font-semibold text-brand-ink">{viewer.data.recipeCount}</span>
              {viewer.data.recipeLimit === null ? "" : ` / ${viewer.data.recipeLimit}`}
            </p>
            <p className="mt-1 text-brand-muted text-sm">
              AI月次上限:{" "}
              <span className="font-semibold text-brand-ink">{viewer.data.aiUsage.limit} 回</span>
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
      </div>
    </section>
  );
};
