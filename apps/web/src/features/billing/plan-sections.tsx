import { FREE_RECIPE_LIMIT } from "@recipestock/shared";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SkeletonBlock } from "../../components/loading";
import { SectionHeader } from "../../components/section-header";
import { fetchProPrice, proPriceQueryKey } from "./api";
import { formatJstDate, formatJstMonthDay, type PlanState } from "./plan-state";

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

const ErrorMessage = ({ children }: { children: string }) => (
  <div className="mt-4 rounded-[14px] border border-brand-danger/20 bg-brand-danger/5 p-3">
    <p className="break-words text-brand-danger text-sm" role="alert">
      {children}
    </p>
  </div>
);

// 上限が5件と少ないので、つながったバーより1件ずつの枠のほうが残りを数えやすい。
const SavedRecipesMeter = ({ state }: { state: PlanState }) => {
  const limit = state.recipeLimit ?? 0;
  const cells = Array.from({ length: limit }, (_, index) => index + 1);
  const filledClass = state.savedRecipes === "room" ? "bg-brand-sage" : "bg-brand-orange";

  return (
    <div aria-hidden="true" className="mt-2 flex gap-1.5">
      {cells.map((cell) => (
        <span
          className={cn(
            "h-2.5 flex-1 rounded-full",
            cell <= state.recipeCount ? filledClass : "bg-brand-line-soft",
          )}
          key={cell}
        />
      ))}
    </div>
  );
};

const savedRecipesMessage = (state: PlanState) => {
  const limit = state.recipeLimit ?? 0;

  if (state.savedRecipes === "room") {
    return `あと${limit - state.recipeCount}件保存できます。`;
  }
  if (state.savedRecipes === "full") {
    return "上限に達しています。新しく保存するには、Proにするか、いらないレシピを削除してください。";
  }
  return `${state.recipeCount}件のうち、開けるのは新しく保存した${limit}件だけです。ほかの${state.lockedCount}件はロック中ですが、消えてはいません。`;
};

export const CurrentPlanSection = ({ state }: { state: PlanState }) => {
  const headingId = useId();
  const isFree = state.plan === "free";

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="今のプラン" />
      <p className="mt-4 font-bold text-3xl text-brand-ink">{isFree ? "Free" : "Pro"}</p>
      <dl className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-brand-muted text-sm">保存したレシピ</dt>
          {/* 上限を超えているときに「12 / 5件」と出すと数が壊れて見えるので、件数だけにして下の文で説明する。 */}
          <dd className="font-semibold text-brand-ink tabular-nums">
            {state.savedRecipes === "room" || state.savedRecipes === "full"
              ? `${state.recipeCount} / ${state.recipeLimit}件`
              : state.savedRecipes === "locked"
                ? `${state.recipeCount}件`
                : `${state.recipeCount}件（上限なし）`}
          </dd>
        </div>
      </dl>
      {isFree ? (
        <>
          <SavedRecipesMeter state={state} />
          <p
            className={cn(
              "mt-3 text-sm leading-6",
              state.savedRecipes === "room" ? "text-brand-muted" : "text-brand-orange-dark",
            )}
          >
            {savedRecipesMessage(state)}
          </p>
        </>
      ) : null}
      {state.importLimitReached ? (
        <p className="mt-3 text-brand-orange-dark text-sm leading-6">
          今月のAI取り込みは上限に達しました。{formatJstMonthDay(state.importResetAt)}
          からまた取り込めます。手入力での保存はできます。
        </p>
      ) : null}
    </section>
  );
};

const ProPrice = () => {
  const proPrice = useQuery({ queryKey: proPriceQueryKey, queryFn: fetchProPrice, retry: false });

  if (proPrice.isPending) {
    return <SkeletonBlock className="h-5 w-56" />;
  }

  // 値段を読めなくても、Stripeの決済画面には値段が出るので、申し込みは止めない。
  return (
    <p className="font-medium text-brand-ink text-sm">
      {proPrice.data ? `月額 ${yen.format(proPrice.data.amount)}（税込）· ` : null}
      いつでも解約できます
    </p>
  );
};

export const ProOfferSection = ({
  error,
  isSubmitting,
  onUpgrade,
  state,
}: {
  error: string | null;
  isSubmitting: boolean;
  onUpgrade: () => void;
  state: PlanState;
}) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="Proにすると" />
      {state.savedRecipes === "locked" ? (
        <p className="mt-4 text-brand-ink text-sm leading-6">
          ロック中の{state.lockedCount}件も、すべて開けるようになります。
        </p>
      ) : null}
      <table className="mt-4 w-full table-fixed text-sm">
        <thead>
          <tr className="border-brand-line-soft border-b text-brand-muted">
            <th className="w-2/5 py-2 text-left font-normal" scope="col">
              <span className="sr-only">項目</span>
            </th>
            <th className="py-2 text-left font-semibold" scope="col">
              Free
            </th>
            <th className="py-2 text-left font-semibold text-brand-sage-dark" scope="col">
              Pro
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-line-soft">
          <tr>
            <th className="py-3 pr-2 text-left font-normal text-brand-muted" scope="row">
              保存できるレシピ
            </th>
            <td className="py-3 text-brand-ink">{state.recipeLimit}件まで</td>
            <td className="py-3 font-semibold text-brand-ink">上限なし</td>
          </tr>
          <tr>
            <th className="py-3 pr-2 text-left font-normal text-brand-muted" scope="row">
              AI取り込み
            </th>
            <td className="py-3 text-brand-ink">月{state.importLimit}回まで</td>
            <td className="py-3 font-semibold text-brand-ink">たっぷり</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-brand-muted text-xs leading-5">
        Proにも、ごく多い利用を防ぐための上限があります。
      </p>

      {/* 押す前に値段が目に入るよう、値段をボタンの上に置く。 */}
      <div className="mt-6 grid justify-items-start gap-3">
        <ProPrice />
        <Button
          className="h-11 w-full text-base sm:w-auto sm:px-8"
          disabled={isSubmitting}
          type="button"
          onClick={onUpgrade}
        >
          Proにする
        </Button>
        <p className="text-brand-muted text-xs">お支払いはStripeの画面で行います。</p>
      </div>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
    </section>
  );
};

const endingMessage = (state: PlanState) => {
  const lockedAfterEnding = state.recipeCount - FREE_RECIPE_LIMIT;

  // 上限以内なら何もロックされないので、開けるものが減るように読める言い方をしない。
  if (lockedAfterEnding <= 0) {
    return `それまではProのまま使えます。Freeに戻ると、保存できるのは${FREE_RECIPE_LIMIT}件までになります。今のレシピはすべて開けます。`;
  }
  return `それまではProのまま使えます。Freeに戻ると、開けるのは新しく保存した${FREE_RECIPE_LIMIT}件だけになります。ほかの${lockedAfterEnding}件はロックされますが、消えません。`;
};

export const ContractSection = ({
  error,
  isLoading,
  isSubmitting,
  loadFailed,
  onOpenPortal,
  onRetryLoad,
  state,
}: {
  error: string | null;
  isLoading: boolean;
  isSubmitting: boolean;
  loadFailed: boolean;
  onOpenPortal: () => void;
  onRetryLoad: () => void;
  state: PlanState;
}) => {
  const headingId = useId();
  const contract = state.contract;

  return (
    <section aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="契約" />

      {isLoading ? <SkeletonBlock className="mt-4 h-5 w-48" /> : null}
      {loadFailed ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-brand-muted text-sm">契約の状態を読み込めませんでした。</p>
          <Button size="sm" type="button" variant="outline" onClick={onRetryLoad}>
            もう一度読み込む
          </Button>
        </div>
      ) : null}

      {contract?.kind === "renewing" && contract.renewsAt ? (
        <dl className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-brand-muted text-sm">次の更新日</dt>
            <dd className="font-semibold text-brand-ink">{formatJstDate(contract.renewsAt)}</dd>
          </div>
        </dl>
      ) : null}

      {contract?.kind === "ending" ? (
        <div className="mt-4">
          <p className="font-semibold text-brand-ink">
            {contract.endsAt
              ? `${formatJstDate(contract.endsAt)}にFreeに戻ります`
              : "契約期間の終わりにFreeに戻ります"}
          </p>
          <p className="mt-1 text-brand-muted text-sm leading-6">{endingMessage(state)}</p>
          <Button
            className="mt-4 h-11 w-full text-base sm:w-auto sm:px-8"
            disabled={isSubmitting}
            type="button"
            onClick={onOpenPortal}
          >
            Proを続ける
          </Button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-2 sm:flex sm:items-center sm:gap-4">
        <Button
          className="h-10 w-full sm:w-auto sm:px-6"
          disabled={isSubmitting}
          type="button"
          variant="outline"
          onClick={onOpenPortal}
        >
          契約を管理
        </Button>
        <p className="text-brand-muted text-xs">支払い方法の変更・領収書・解約</p>
      </div>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
    </section>
  );
};
