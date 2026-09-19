import {
  type GetBillingStatusResponse,
  type GetMeResponse,
  type GetProPriceResponse,
  type GetPushSubscriptionsResponse,
  type ImportJobSummary,
  type ListShortcutCredentialsResponse,
  type RecipeListItem,
} from "@recipestock/schemas";
import { FREE_RECIPE_LIMIT } from "@recipestock/shared";
import {
  billingStatusFixture,
  brokenImageRecipeContentFixture,
  googleLoginAccountsFixture,
  imageOnlyRecipeContentFixture,
  importJobFixture,
  type LoginAccountFixture,
  MOCK_RECIPE_SEED_COUNT,
  type MockTag,
  mockRecipeId,
  passwordLoginAccountsFixture,
  proBillingStatusFixture,
  proPriceFixture,
  pushSubscriptionsFixture,
  type RecipeContentOverride,
  recipeListFixture,
  recipeTagsFixture,
  type SessionFixture,
  sessionFixture,
  shortcutCredentialsFixture,
  tagsFixture,
  viewerFixture,
} from "./fixtures";

/**
 * シナリオが宣言するのは「サーバが持っている状態」だけ。
 * 検索・ページング・ロック判定・タグの絞り込みはハンドラ側が1箇所で処理する。
 */
export type MockState = {
  /** null なら未ログイン。get-session が 200 null を返す。 */
  session: SessionFixture | null;
  /** true なら get-session をネットワークエラーにする(接続不可の確認用)。 */
  sessionFailure: boolean;
  /** ログイン方法。"credential" を持たない人は、設定にパスワードの行が出ない。 */
  loginAccounts: LoginAccountFixture[];
  viewer: GetMeResponse;
  billing: GetBillingStatusResponse;
  recipes: RecipeListItem[];
  /** 利用者のタグ。並びは作った順。 */
  tags: MockTag[];
  /** Recipeのidごとに、付けたタグのidを付けた順に持つ。 */
  recipeTags: Record<string, string[]>;
  /** Recipeのidごとに、詳細の本文をfixtureから差し替える部分。 */
  recipeContents: Record<string, RecipeContentOverride>;
  importJobs: ImportJobSummary[];
  /** テキスト取り込みのjobが保持し、本人向けの詳細APIから返す原文。 */
  importJobSourceTexts: Record<string, string>;
  pushSubscriptions: GetPushSubscriptionsResponse;
  shortcutCredentials: ListShortcutCredentialsResponse;
  proPrice: GetProPriceResponse;
  /** 指定すると、課金の状態をこの回数より多く読んだところでProに変わる(決済から戻った直後の再現)。 */
  upgradeAfterBillingReads?: number;
  failures: {
    /** "always" は全ページ、"after-first-page" は2ページ目以降を500にする。 */
    listRecipes?: "always" | "after-first-page";
  };
};

// 1つのシナリオが複数の画面に効くので、画面ではなく状態の種類で分ける。パネルはこの順に並べる。
export const scenarioGroups = [
  { id: "base", label: "基本" },
  { id: "recipes", label: "レシピ一覧・詳細" },
  { id: "plan", label: "プラン・上限" },
  { id: "import", label: "取り込み" },
  { id: "account", label: "アカウント" },
  { id: "session", label: "セッション" },
] as const;

export type Scenario = {
  id: string;
  group: (typeof scenarioGroups)[number]["id"];
  label: string;
  build: () => MockState;
};

const baseState = (): MockState => ({
  session: sessionFixture(),
  sessionFailure: false,
  loginAccounts: passwordLoginAccountsFixture(),
  viewer: viewerFixture({ plan: "pro", recipeCount: MOCK_RECIPE_SEED_COUNT }),
  billing: proBillingStatusFixture(),
  recipes: recipeListFixture(),
  tags: tagsFixture(),
  recipeTags: recipeTagsFixture(),
  recipeContents: {},
  importJobs: [],
  importJobSourceTexts: {},
  pushSubscriptions: pushSubscriptionsFixture(),
  shortcutCredentials: shortcutCredentialsFixture(),
  proPrice: proPriceFixture(),
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
    recipeTags: recipeTagsFixture({ count: recipeCount }),
  };
};

// 一覧のサムネイルと、開いた詳細の画像がどちらも読み込めないRecipe。
const brokenImageRecipeIndexes = [1, 4, 7];

export const scenarios: Scenario[] = [
  {
    id: "default",
    group: "base",
    label: "通常(Pro・複数ページ)",
    build: baseState,
  },
  {
    id: "empty",
    group: "recipes",
    label: "レシピなし",
    build: () => ({
      ...baseState(),
      viewer: viewerFixture({ plan: "free", recipeCount: 0 }),
      billing: billingStatusFixture(),
      recipes: [],
      tags: [],
      recipeTags: {},
    }),
  },
  {
    id: "no-tags",
    group: "recipes",
    label: "タグを持たない(チップ列なし・定番候補)",
    build: () => ({ ...baseState(), tags: [], recipeTags: {} }),
  },
  {
    id: "list-error",
    group: "recipes",
    label: "一覧の取得失敗",
    build: () => ({ ...baseState(), failures: { listRecipes: "always" } }),
  },
  {
    id: "next-page-error",
    group: "recipes",
    label: "2ページ目の取得失敗",
    build: () => ({ ...baseState(), failures: { listRecipes: "after-first-page" } }),
  },
  {
    id: "no-cover",
    group: "recipes",
    label: "カバー画像なし",
    build: () => ({ ...baseState(), recipes: recipeListFixture({ withCoverImage: false }) }),
  },
  {
    id: "image-only",
    group: "recipes",
    label: "画像だけの投稿(材料・手順なし)",
    build: () => {
      const state = baseState();

      return {
        ...state,
        recipeContents: Object.fromEntries(
          // 2件目は表紙と同じ1枚だけの投稿にして、レシピ画像の段を出さない表示も確かめられるようにする。
          state.recipes.map((recipe, index) => [
            recipe.id,
            imageOnlyRecipeContentFixture(recipe.id, index === 1 ? 1 : 4),
          ]),
        ),
      };
    },
  },
  {
    id: "broken-image",
    group: "recipes",
    label: "画像の読み込み失敗",
    build: () => ({
      ...baseState(),
      recipes: recipeListFixture({ brokenCoverIndexes: brokenImageRecipeIndexes }),
      recipeContents: Object.fromEntries(
        brokenImageRecipeIndexes.map((index) => [
          mockRecipeId(index),
          brokenImageRecipeContentFixture(mockRecipeId(index)),
        ]),
      ),
    }),
  },
  {
    id: "free-locked",
    group: "plan",
    label: "Free(末尾がロック)",
    build: () => freeState(12),
  },
  {
    id: "limit-reached",
    group: "plan",
    label: "Free(保存上限ちょうど)",
    build: () => freeState(FREE_RECIPE_LIMIT),
  },
  {
    id: "import-limit",
    group: "plan",
    label: "Free(今月のAI取り込みが上限)",
    build: () => {
      const state = freeState(2);

      return {
        ...state,
        viewer: {
          ...state.viewer,
          aiUsage: { ...state.viewer.aiUsage, used: state.viewer.aiUsage.limit },
        },
      };
    },
  },
  {
    id: "checkout-pending",
    group: "plan",
    label: "決済から戻った直後(数秒でProに変わる)",
    build: () => ({ ...freeState(12), upgradeAfterBillingReads: 2 }),
  },
  {
    id: "pro-canceling",
    group: "plan",
    label: "Pro(解約予約中)",
    build: () => ({
      ...baseState(),
      billing: proBillingStatusFixture({ cancelAtPeriodEnd: true }),
    }),
  },
  {
    id: "pro-past-due",
    group: "plan",
    label: "Pro(支払いを確認できない)",
    build: () => ({ ...baseState(), billing: proBillingStatusFixture({ status: "past_due" }) }),
  },
  {
    id: "importing",
    group: "import",
    label: "取り込み中",
    build: () => ({
      ...baseState(),
      importJobs: [importJobFixture({ status: "running" })],
    }),
  },
  {
    id: "import-failed",
    group: "import",
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
    id: "text-import-failed",
    group: "import",
    label: "テキストの取り込み失敗",
    build: () => ({
      ...baseState(),
      importJobs: [
        importJobFixture({
          id: "job_text_failed",
          kind: "text",
          status: "failed",
          url: null,
          textPreview: "今日の夕飯",
          errorCode: "extraction_failed",
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          finishedAt: new Date(Date.now() - 30_000).toISOString(),
        }),
      ],
      importJobSourceTexts: {
        job_text_failed: "今日の夕飯\n鶏むね肉を焼いただけ。おいしかった。",
      },
    }),
  },
  {
    id: "google-login",
    group: "account",
    label: "Googleだけでログイン(パスワードなし)",
    build: () => ({ ...baseState(), loginAccounts: googleLoginAccountsFixture() }),
  },
  {
    id: "signed-out",
    group: "session",
    label: "未ログイン",
    build: () => ({ ...baseState(), session: null }),
  },
  {
    id: "offline",
    group: "session",
    label: "接続不可",
    build: () => ({ ...baseState(), sessionFailure: true }),
  },
];

const defaultScenario = scenarios[0];

export const findScenario = (id: string | null | undefined): Scenario =>
  scenarios.find((scenario) => scenario.id === id) ?? defaultScenario;
