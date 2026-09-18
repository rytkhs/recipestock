import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConnectionUnavailable } from "../components/connection-unavailable";
import { SettingsPageSkeleton } from "../components/loading";
import {
  billingRedirect,
  billingStatusQueryKey,
  createBillingPortal,
  createCheckout,
} from "../features/billing/api";
import { BillingNotice } from "../features/billing/billing-notice";
import {
  ContractSection,
  CurrentPlanSection,
  ProOfferSection,
} from "../features/billing/plan-sections";
import { derivePlanState, type PlanState } from "../features/billing/plan-state";
import {
  type CheckoutConfirmation,
  useCheckoutConfirmation,
} from "../features/billing/use-checkout-confirmation";
import {
  SettingsSubpageTopBar,
  settingsPageBodyClass,
  settingsPageClass,
} from "../features/settings/settings-page";
import { ApiClientError } from "../lib/api";
import { useViewer, viewerQueryKey } from "../lib/viewer";

const billingRouteApi = getRouteApi("/_protected/settings/billing");

type SettingsBillingSearch = ReturnType<typeof billingRouteApi.useSearch>;

/**
 * 冒頭に出すお知らせを1つだけ選ぶ。URLが運ぶのは「起きたこと」だけで、直し方は今の状態から組み立てる。
 * 通知を見てから開くまでにレシピを消していれば、上限のままだとは言わない。
 */
const ArrivalNotice = ({
  arrival,
  confirmation,
  isPortalSubmitting,
  onOpenPortal,
  onRecheck,
  state,
}: {
  arrival: SettingsBillingSearch;
  confirmation: CheckoutConfirmation;
  isPortalSubmitting: boolean;
  onOpenPortal: () => void;
  onRecheck: () => void;
  state: PlanState;
}) => {
  if (confirmation === "waiting") {
    return (
      <BillingNotice
        icon={<Spinner aria-hidden="true" className="text-brand-sage" role="presentation" />}
        title="Proへの切り替えを確認しています"
        tone="info"
      >
        少しお待ちください。
      </BillingNotice>
    );
  }

  if (confirmation === "confirmed") {
    return (
      <BillingNotice title="Proになりました" tone="success">
        これからはレシピを上限なく保存できます。
      </BillingNotice>
    );
  }

  if (confirmation === "timed_out") {
    return (
      <BillingNotice
        action={
          <Button size="sm" type="button" variant="outline" onClick={onRecheck}>
            もう一度確認
          </Button>
        }
        title="手続きは受け付けました"
        tone="info"
      >
        反映に時間がかかっています。少し時間をおいてから、もう一度確認してください。
      </BillingNotice>
    );
  }

  if (state.contract?.kind === "payment_failed") {
    return (
      <BillingNotice
        action={
          <Button disabled={isPortalSubmitting} size="sm" type="button" onClick={onOpenPortal}>
            支払い方法を更新
          </Button>
        }
        title="お支払いを確認できません"
        tone="warning"
      >
        支払い方法を更新してください。このままだとFreeに戻ります。
      </BillingNotice>
    );
  }

  if (arrival.from === "shortcut" && arrival.upsell === "recipe_limit") {
    const isStillFull = state.plan === "free" && state.savedRecipes !== "room";

    return (
      <BillingNotice title="共有したレシピは保存されていません" tone="warning">
        {isStillFull
          ? "保存できる上限に達していたためです。保存できるようにしてから、もう一度共有してください。"
          : "保存できる上限に達していたためです。今は保存できるので、もう一度共有してください。"}
      </BillingNotice>
    );
  }

  if (arrival.from === "shortcut" && arrival.upsell === "ai_usage_limit") {
    return (
      <BillingNotice title="共有したレシピは取り込まれていません" tone="warning">
        {/* また取り込める日は、下の「今のプラン」に出ている。 */}
        {state.importLimitReached
          ? `今月の取り込み回数の上限に達していたためです。${
              state.plan === "free" ? "Proにすると、もっと取り込めます。" : ""
            }`
          : "今月の取り込み回数の上限に達していたためです。今は取り込めるので、もう一度共有してください。"}
      </BillingNotice>
    );
  }

  if (arrival.checkout === "cancel") {
    return (
      <BillingNotice title="手続きを中止しました" tone="info">
        料金はかかっていません。
      </BillingNotice>
    );
  }

  return null;
};

export const SettingsBillingRoute = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = billingRouteApi.useSearch();
  // 理由は開いたときに一度だけ読んで持ち、URLからは消す。再読み込みや後日のブックマークで古いお知らせを出さない。
  const [arrival] = useState(search);
  const hasArrivalParams = Boolean(search.checkout || search.upsell || search.from);
  const viewer = useViewer({ enabled: true });
  const { billingStatus, confirmation, startWaiting } = useCheckoutConfirmation({
    initiallyWaiting: arrival.checkout === "success",
  });
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [isCheckoutSubmitting, setIsCheckoutSubmitting] = useState(false);
  const [isPortalSubmitting, setIsPortalSubmitting] = useState(false);

  useEffect(() => {
    if (hasArrivalParams) {
      void navigate({ to: "/settings/billing", search: {}, replace: true });
    }
  }, [hasArrivalParams, navigate]);

  const startCheckout = async () => {
    setCheckoutError(null);
    setIsCheckoutSubmitting(true);

    try {
      const response = await createCheckout();
      billingRedirect.assign(response.url);
    } catch (error) {
      // 決済を終えたのに、まだFreeに見えているあいだに押された。二つ目の契約は作らず、Proに変わるのを待つ。
      if (error instanceof ApiClientError && error.code === "already_subscribed") {
        startWaiting();
        await queryClient.invalidateQueries({ queryKey: viewerQueryKey });
        return;
      }

      setCheckoutError("お支払いの画面を開けませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsCheckoutSubmitting(false);
    }
  };

  const openBillingPortal = async () => {
    setPortalError(null);
    setIsPortalSubmitting(true);

    try {
      const response = await createBillingPortal();
      billingRedirect.assign(response.url);
    } catch {
      setPortalError("契約の管理画面を開けませんでした。時間をおいて再度お試しください。");
    } finally {
      setIsPortalSubmitting(false);
    }
  };

  const topBar = <SettingsSubpageTopBar title="プラン" />;

  // プランと件数はviewerから出すので、この画面だけはviewerを待つ。
  if (!viewer.data) {
    return viewer.isError ? (
      <section className={settingsPageClass}>
        {topBar}
        <ConnectionUnavailable
          isRetrying={viewer.isFetching}
          onRetry={async () => {
            await viewer.refetch();
          }}
        />
      </section>
    ) : (
      <SettingsPageSkeleton />
    );
  }

  const state = derivePlanState(viewer.data, billingStatus.data);

  return (
    <section className={settingsPageClass}>
      {topBar}

      <div className={`${settingsPageBodyClass} grid gap-10`}>
        <ArrivalNotice
          arrival={arrival}
          confirmation={confirmation}
          isPortalSubmitting={isPortalSubmitting}
          state={state}
          onOpenPortal={() => void openBillingPortal()}
          onRecheck={startWaiting}
        />

        <CurrentPlanSection state={state} />

        {state.plan === "free" && confirmation === "idle" ? (
          <ProOfferSection
            error={checkoutError}
            isSubmitting={isCheckoutSubmitting}
            state={state}
            onUpgrade={() => void startCheckout()}
          />
        ) : null}

        {state.plan === "pro" ? (
          <ContractSection
            error={portalError}
            isLoading={billingStatus.isPending}
            isSubmitting={isPortalSubmitting}
            loadFailed={billingStatus.isError && !billingStatus.data}
            state={state}
            onOpenPortal={() => void openBillingPortal()}
            onRetryLoad={() => {
              void queryClient.invalidateQueries({ queryKey: billingStatusQueryKey });
            }}
          />
        ) : null}
      </div>
    </section>
  );
};
