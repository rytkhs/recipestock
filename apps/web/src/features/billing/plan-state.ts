import { type GetBillingStatusResponse, type GetMeResponse } from "@recipestock/schemas";

/**
 * 保存件数の状態。上限を超えているのは、ProからFreeに戻った人だけである。
 * 超えた分は消さず、新しく保存した上限件数のほかをロックする（ADR 0020）。
 */
export type SavedRecipesState = "unlimited" | "room" | "full" | "locked";

export type ProContract =
  | { kind: "renewing"; renewsAt: string | null }
  | { kind: "ending"; endsAt: string | null }
  | { kind: "payment_failed" };

export type PlanState = {
  plan: GetMeResponse["plan"];
  recipeCount: number;
  recipeLimit: number | null;
  savedRecipes: SavedRecipesState;
  lockedCount: number;
  importLimit: number;
  importLimitReached: boolean;
  importResetAt: string;
  /** Proで、契約の状態を読めたときだけ持つ。 */
  contract: ProContract | null;
};

const deriveSavedRecipes = (recipeCount: number, recipeLimit: number | null): SavedRecipesState => {
  if (recipeLimit === null) return "unlimited";
  if (recipeCount < recipeLimit) return "room";
  return recipeCount === recipeLimit ? "full" : "locked";
};

const deriveContract = (
  subscription: NonNullable<GetBillingStatusResponse["subscription"]>,
): ProContract => {
  if (subscription.status === "past_due") {
    return { kind: "payment_failed" };
  }

  if (subscription.cancelAt || subscription.cancelAtPeriodEnd) {
    return { kind: "ending", endsAt: subscription.cancelAt ?? subscription.currentPeriodEnd };
  }

  return { kind: "renewing", renewsAt: subscription.currentPeriodEnd };
};

/**
 * プランの今の状態を、目次の行とプランのページの両方で同じ判定にする。
 * プランと件数はviewerから、Proの契約の状態は課金の状態から決める。
 */
export const derivePlanState = (
  viewer: GetMeResponse,
  billingStatus?: GetBillingStatusResponse,
): PlanState => {
  const { recipeCount, recipeLimit, aiUsage } = viewer;
  const subscription = viewer.plan === "pro" ? billingStatus?.subscription : null;

  return {
    plan: viewer.plan,
    recipeCount,
    recipeLimit,
    savedRecipes: deriveSavedRecipes(recipeCount, recipeLimit),
    lockedCount: recipeLimit === null ? 0 : Math.max(0, recipeCount - recipeLimit),
    importLimit: aiUsage.limit,
    importLimitReached: aiUsage.used >= aiUsage.limit,
    importResetAt: aiUsage.resetAt,
    contract: subscription ? deriveContract(subscription) : null,
  };
};

const jstMonthDay = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "long",
  day: "numeric",
});

const jstDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/** 「10月1日」。AI取り込みの回数が戻る日のように、1年以内に来る日に使う。 */
export const formatJstMonthDay = (date: string) => jstMonthDay.format(new Date(date));

/** 「2026年10月8日」。請求にかかわる日は年まで書く。 */
export const formatJstDate = (date: string) => jstDate.format(new Date(date));

/**
 * 目次の「プラン」の行に出す値。当てはまるものが複数あれば、手を打つ必要が大きいものを1つだけ出す。
 */
export const planRowValue = (state: PlanState): { text: string; tone: "muted" | "warning" } => {
  if (state.plan === "free") {
    const count = `${state.recipeCount}/${state.recipeLimit}件`;

    if (state.savedRecipes === "locked") {
      return { text: `Free · ${state.lockedCount}件ロック中`, tone: "warning" };
    }
    if (state.savedRecipes === "full") {
      return { text: `Free · ${count}`, tone: "warning" };
    }
    if (state.importLimitReached) {
      return { text: "Free · AI取り込み上限", tone: "warning" };
    }
    return { text: `Free · ${count}`, tone: "muted" };
  }

  if (state.contract?.kind === "payment_failed") {
    return { text: "支払いを確認できません", tone: "warning" };
  }
  if (state.importLimitReached) {
    return { text: "Pro · AI取り込み上限", tone: "warning" };
  }
  if (state.contract?.kind === "ending") {
    return {
      text: state.contract.endsAt
        ? `Pro · ${formatJstMonthDay(state.contract.endsAt)}まで`
        : "Pro · 解約予約中",
      tone: "muted",
    };
  }
  return { text: "Pro", tone: "muted" };
};

/**
 * プランを変えれば直る上限のエラーか。AI取り込みの上限はProにもあるので、Freeのときだけ当てはまる。
 * Webの取り込みAPIはプランでエラーを分けないので、画面が知っているプランで見分ける（ADR 0010）。
 */
export const isResolvedByUpgrade = (
  code: string | null | undefined,
  plan: GetMeResponse["plan"] | undefined,
) => code === "recipe_limit_exceeded" || (code === "ai_usage_limit_exceeded" && plan === "free");
