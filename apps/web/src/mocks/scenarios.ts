import {
  type GetBillingStatusResponse,
  type GetMeResponse,
  type GetPushSubscriptionsResponse,
  type ImportJobSummary,
  type ListShortcutCredentialsResponse,
  type RecipeListItem,
} from "@recipestock/schemas";
import { FREE_RECIPE_LIMIT } from "@recipestock/shared";
import {
  billingStatusFixture,
  importJobFixture,
  MOCK_RECIPE_SEED_COUNT,
  pushSubscriptionsFixture,
  recipeListFixture,
  type SessionFixture,
  sessionFixture,
  shortcutCredentialsFixture,
  viewerFixture,
} from "./fixtures";

/**
 * シナリオが宣言するのは「サーバが持っている状態」だけ。
 * 検索・ページング・ロック判定はハンドラ側が1箇所で処理する。
 */
export type MockState = {
  /** null なら未ログイン。get-session が 200 null を返す。 */
  session: SessionFixture | null;
  /** true なら get-session をネットワークエラーにする(接続不可の確認用)。 */
  sessionFailure: boolean;
  viewer: GetMeResponse;
  billing: GetBillingStatusResponse;
  recipes: RecipeListItem[];
  importJobs: ImportJobSummary[];
  pushSubscriptions: GetPushSubscriptionsResponse;
  shortcutCredentials: ListShortcutCredentialsResponse;
  failures: {
    /** "always" は全ページ、"after-first-page" は2ページ目以降を500にする。 */
    listRecipes?: "always" | "after-first-page";
  };
};

export type Scenario = {
  id: string;
  label: string;
  build: () => MockState;
};

const baseState = (): MockState => ({
  session: sessionFixture(),
  sessionFailure: false,
  viewer: viewerFixture({ plan: "pro", recipeCount: MOCK_RECIPE_SEED_COUNT }),
  billing: billingStatusFixture({
    plan: "pro",
    subscription: {
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAt: null,
    },
  }),
  recipes: recipeListFixture(),
  importJobs: [],
  pushSubscriptions: pushSubscriptionsFixture(),
  shortcutCredentials: shortcutCredentialsFixture(),
  failures: {},
});

const freeState = (recipeCount: number): MockState => {
  const state = baseState();
  const recipes = recipeListFixture({ count: recipeCount, unlockedCount: FREE_RECIPE_LIMIT });

  return {
    ...state,
    viewer: viewerFixture({
      plan: "free",
      recipeCount,
      isRecipeLimitReached: recipeCount >= FREE_RECIPE_LIMIT,
    }),
    billing: billingStatusFixture(),
    recipes,
  };
};

export const scenarios: Scenario[] = [
  {
    id: "default",
    label: "通常(Pro・複数ページ)",
    build: baseState,
  },
  {
    id: "empty",
    label: "レシピなし",
    build: () => ({
      ...baseState(),
      viewer: viewerFixture({ plan: "free", recipeCount: 0 }),
      billing: billingStatusFixture(),
      recipes: [],
    }),
  },
  {
    id: "free-locked",
    label: "フリープラン(末尾がロック)",
    build: () => freeState(12),
  },
  {
    id: "limit-reached",
    label: "フリープラン(保存上限ちょうど)",
    build: () => freeState(FREE_RECIPE_LIMIT),
  },
  {
    id: "list-error",
    label: "一覧の取得失敗",
    build: () => ({ ...baseState(), failures: { listRecipes: "always" } }),
  },
  {
    id: "next-page-error",
    label: "2ページ目の取得失敗",
    build: () => ({ ...baseState(), failures: { listRecipes: "after-first-page" } }),
  },
  {
    id: "importing",
    label: "取り込み中",
    build: () => ({
      ...baseState(),
      importJobs: [importJobFixture({ status: "running" })],
    }),
  },
  {
    id: "import-failed",
    label: "取り込み失敗",
    build: () => ({
      ...baseState(),
      importJobs: [
        importJobFixture({
          id: "job_failed",
          status: "failed",
          errorCode: "unsupported_page",
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          finishedAt: new Date(Date.now() - 30_000).toISOString(),
        }),
      ],
    }),
  },
  {
    id: "no-cover",
    label: "カバー画像なし",
    build: () => ({ ...baseState(), recipes: recipeListFixture({ withCoverImage: false }) }),
  },
  {
    id: "broken-image",
    label: "カバー画像の読み込み失敗",
    build: () => ({
      ...baseState(),
      recipes: recipeListFixture({ brokenCoverIndexes: [1, 4, 7] }),
    }),
  },
  {
    id: "signed-out",
    label: "未ログイン",
    build: () => ({ ...baseState(), session: null }),
  },
  {
    id: "offline",
    label: "接続不可",
    build: () => ({ ...baseState(), sessionFailure: true }),
  },
];

const defaultScenario = scenarios[0];

export const findScenario = (id: string | null | undefined): Scenario =>
  scenarios.find((scenario) => scenario.id === id) ?? defaultScenario;
