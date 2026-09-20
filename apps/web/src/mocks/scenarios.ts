import {
  type GetBillingStatusResponse,
  type GetMeResponse,
  type GetProPriceResponse,
  type GetPushSubscriptionsResponse,
  type ImportJobSummary,
  type ListShortcutCredentialsResponse,
  MAX_INGREDIENT_AMOUNT_LENGTH,
  MAX_INGREDIENT_GROUP_LABEL_LENGTH,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_RECIPE_NOTE_LENGTH,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_SOURCE_NAME_LENGTH,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_TAGS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_TOTAL_IMAGES,
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
  linkedShortcutCredentialsFixture,
  MOCK_RECIPE_SEED_COUNT,
  type MockTag,
  mockRecipeId,
  passwordAndGoogleLoginAccountsFixture,
  passwordLoginAccountsFixture,
  proBillingStatusFixture,
  proPriceFixture,
  pushSubscriptionsFixture,
  type RecipeContentOverride,
  recipeImageFixture,
  recipeImagesFixture,
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
    /** "once" は最初の詳細取得だけを500にし、再読み込みでは成功させる。 */
    getRecipe?: "once" | "always";
    saveRecipe?: "generic" | "image-finalize";
    deleteRecipe?: boolean;
    replaceRecipeTags?: boolean;
    /** "after-first" は最初の1枚だけ成功させ、同時選択した後続を失敗させる。 */
    uploadImage?: "always" | "after-first";
    getViewer?: boolean;
    listTags?: boolean;
    getBillingStatus?: boolean;
    getProPrice?: boolean;
    createCheckout?: boolean;
    createBillingPortal?: boolean;
    listLoginAccounts?: boolean;
    changeEmail?: boolean;
    changePassword?: "generic" | "invalid-password";
    signOut?: boolean;
    getPushSubscriptions?: boolean;
    listShortcutCredentials?: boolean;
    issueShortcutCredential?: boolean;
    revokeShortcutCredential?: boolean;
  };
};

// 1つのシナリオが複数の画面に効くので、画面ではなく状態の種類で分ける。パネルはこの順に並べる。
export const scenarioGroups = [
  { id: "base", label: "基本" },
  { id: "recipes", label: "レシピ一覧・詳細" },
  { id: "plan", label: "プラン・上限" },
  { id: "settings", label: "設定・連携" },
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

const fillText = (prefix: string, length: number) =>
  `${prefix}${"あ".repeat(Math.max(0, length - prefix.length))}`;

const withoutImageUrl = (recipeId: string, name: string) => {
  const { url: _url, ...image } = recipeImageFixture(recipeId, name);
  return image;
};

const contentVariantsState = (): MockState => {
  const state = baseState();
  const titles: Record<string, string> = {
    recipe_001: "材料だけのレシピ",
    recipe_002: "手順だけのレシピ",
    recipe_003: "メモだけのレシピ",
    recipe_004: "URLだけの出典を持つレシピ",
    recipe_005: "画像URLが欠けたレシピ",
    recipe_006: "タイトルだけのレシピ",
  };
  const recipes = recipeListFixture({ count: 6 }).map((recipe) => ({
    ...recipe,
    title: titles[recipe.id] ?? recipe.title,
    coverImageUrl:
      recipe.id === "recipe_002" || recipe.id === "recipe_005" ? recipe.coverImageUrl : null,
    sourceName: recipe.id === "recipe_004" || recipe.id === "recipe_006" ? null : recipe.sourceName,
  }));

  return {
    ...state,
    viewer: viewerFixture({ plan: "pro", recipeCount: recipes.length }),
    recipes,
    recipeTags: Object.fromEntries(recipes.map((recipe) => [recipe.id, []])),
    recipeContents: {
      recipe_001: {
        yieldText: "2人分",
        coverImage: undefined,
        referenceImages: [],
        ingredientGroups: [
          {
            ingredients: [
              { name: "じゃがいも", amount: "2個" },
              { name: "塩", amount: "少々" },
            ],
          },
        ],
        steps: [],
        note: undefined,
      },
      recipe_002: {
        yieldText: undefined,
        referenceImages: [],
        ingredientGroups: [],
        steps: [
          { text: "材料を混ぜる。", images: [] },
          { text: "器に盛り付ける。", images: [] },
        ],
        note: undefined,
      },
      recipe_003: {
        yieldText: undefined,
        coverImage: undefined,
        referenceImages: [],
        ingredientGroups: [],
        steps: [],
        note: "次は少しだけ塩を減らす。\n冷めてもおいしかった。",
      },
      recipe_004: {
        yieldText: undefined,
        coverImage: undefined,
        referenceImages: [],
        ingredientGroups: [],
        steps: [],
        note: undefined,
      },
      recipe_005: {
        coverImage: withoutImageUrl("recipe_005", "cover-without-url"),
        referenceImages: [withoutImageUrl("recipe_005", "reference-without-url")],
        ingredientGroups: [],
        steps: [
          {
            text: "画像を見ながら盛り付ける。",
            images: [withoutImageUrl("recipe_005", "step-without-url")],
          },
        ],
        note: undefined,
      },
      recipe_006: {
        yieldText: undefined,
        coverImage: undefined,
        referenceImages: [],
        ingredientGroups: [],
        steps: [],
        note: undefined,
      },
    },
  };
};

const longContentState = (): MockState => {
  const state = baseState();
  const [recipe] = recipeListFixture({ count: 1 });
  const tags = Array.from({ length: MAX_RECIPE_TAGS }, (_, index) => ({
    id: `tag_stress_${index + 1}`,
    name: `長い確認用タグ${String(index + 1).padStart(2, "0")}番`,
  }));
  const title = fillText("表示確認用のとても長いレシピ名", MAX_RECIPE_TITLE_LENGTH);

  return {
    ...state,
    viewer: viewerFixture({ plan: "pro", recipeCount: 1 }),
    recipes: [
      {
        ...recipe,
        title,
        sourceName: fillText("表示確認用の長い出典名", MAX_RECIPE_SOURCE_NAME_LENGTH),
      },
    ],
    tags,
    recipeTags: { [recipe.id]: tags.map((tag) => tag.id) },
    recipeContents: {
      [recipe.id]: {
        title,
        yieldText: "12人分（作り置きと翌日のお弁当を含む）",
        referenceImages: recipeImagesFixture(recipe.id, "stress-reference", 6),
        ingredientGroups: [
          {
            label: fillText("とても長い材料グループ名", MAX_INGREDIENT_GROUP_LABEL_LENGTH),
            ingredients: [
              {
                name: fillText("折り返しを確認するための長い材料名", MAX_INGREDIENT_NAME_LENGTH),
                amount: fillText("大さじ", MAX_INGREDIENT_AMOUNT_LENGTH),
              },
              { name: "分量のない材料をそのまま書いた行", amount: "" },
            ],
          },
        ],
        steps: [
          {
            text: fillText(
              "長い手順の表示を確認する。\n途中に改行を入れ、段落が続く場合も確認する。\n",
              MAX_RECIPE_STEP_TEXT_LENGTH,
            ),
            images: recipeImagesFixture(recipe.id, "stress-step", 3),
          },
          { text: "仕上げに全体を混ぜ、器に盛る。", images: [] },
        ],
        note: fillText(
          "長いメモの表示を確認する。\n翌日に作るときの注意点もここへ残す。\n",
          MAX_RECIPE_NOTE_LENGTH,
        ),
      },
    },
  };
};

const editImageLimitsState = (): MockState => {
  const state = baseState();
  const recipes = recipeListFixture({ count: 3 }).map((recipe, index) => ({
    ...recipe,
    title: ["レシピ画像が20枚", "1つの手順画像が10枚", "画像が合計100枚"][index],
  }));
  const [referenceLimit, stepLimit, totalLimit] = recipes;

  return {
    ...state,
    viewer: viewerFixture({ plan: "pro", recipeCount: recipes.length }),
    recipes,
    recipeTags: Object.fromEntries(recipes.map((recipe) => [recipe.id, []])),
    recipeContents: {
      [referenceLimit.id]: {
        referenceImages: recipeImagesFixture(
          referenceLimit.id,
          "reference-limit",
          MAX_RECIPE_REFERENCE_IMAGES,
        ),
        ingredientGroups: [],
        steps: [],
        note: undefined,
      },
      [stepLimit.id]: {
        referenceImages: [],
        ingredientGroups: [],
        steps: [
          {
            text: "画像上限の手順",
            images: recipeImagesFixture(stepLimit.id, "step-limit", MAX_RECIPE_STEP_IMAGES),
          },
        ],
        note: undefined,
      },
      [totalLimit.id]: {
        referenceImages: recipeImagesFixture(
          totalLimit.id,
          "total-reference",
          MAX_RECIPE_REFERENCE_IMAGES,
        ),
        ingredientGroups: [],
        steps: Array.from(
          {
            length:
              (MAX_RECIPE_TOTAL_IMAGES - MAX_RECIPE_REFERENCE_IMAGES) / MAX_RECIPE_STEP_IMAGES,
          },
          (_, index) => ({
            text: `画像上限を確認する手順${index + 1}`,
            images: recipeImagesFixture(
              totalLimit.id,
              `total-step-${index + 1}`,
              MAX_RECIPE_STEP_IMAGES,
            ),
          }),
        ),
        note: undefined,
      },
    },
  };
};

const maxTagsState = (): MockState => {
  const state = baseState();
  const [recipe] = recipeListFixture({ count: 1 });
  const tags = Array.from({ length: MAX_RECIPE_TAGS }, (_, index) => ({
    id: `tag_max_${index + 1}`,
    name: `確認タグ${index + 1}`,
  }));

  return {
    ...state,
    viewer: viewerFixture({ plan: "pro", recipeCount: 1 }),
    recipes: [{ ...recipe, title: "タグが上限まで付いたレシピ" }],
    tags,
    recipeTags: { [recipe.id]: tags.map((tag) => tag.id) },
  };
};

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
    id: "content-variants",
    group: "recipes",
    label: "本文のバリエーション",
    build: contentVariantsState,
  },
  {
    id: "long-content",
    group: "recipes",
    label: "長い本文・10個のタグ",
    build: longContentState,
  },
  {
    id: "detail-error",
    group: "recipes",
    label: "詳細の初回取得失敗(再読み込みで成功)",
    build: () => ({ ...baseState(), failures: { getRecipe: "once" } }),
  },
  {
    id: "recipe-save-error",
    group: "recipes",
    label: "レシピの作成・更新失敗",
    build: () => ({ ...baseState(), failures: { saveRecipe: "generic" } }),
  },
  {
    id: "recipe-delete-error",
    group: "recipes",
    label: "レシピの削除失敗",
    build: () => ({ ...baseState(), failures: { deleteRecipe: true } }),
  },
  {
    id: "image-finalize-error",
    group: "recipes",
    label: "保存時に画像を確定できない",
    build: () => ({ ...baseState(), failures: { saveRecipe: "image-finalize" } }),
  },
  {
    id: "image-upload-error",
    group: "recipes",
    label: "画像のアップロード失敗(全件)",
    build: () => ({ ...baseState(), failures: { uploadImage: "always" } }),
  },
  {
    id: "image-upload-partial-error",
    group: "recipes",
    label: "画像のアップロード失敗(2枚目以降)",
    build: () => ({ ...baseState(), failures: { uploadImage: "after-first" } }),
  },
  {
    id: "edit-image-limits",
    group: "recipes",
    label: "編集の画像上限(20枚・10枚・合計100枚)",
    build: editImageLimitsState,
  },
  {
    id: "legacy-over-limit",
    group: "recipes",
    label: "現在の文字数上限を超える保存済みレシピ",
    build: () => {
      const state = baseState();
      const [recipe] = recipeListFixture({ count: 1 });

      return {
        ...state,
        viewer: viewerFixture({ plan: "pro", recipeCount: 1 }),
        recipes: [{ ...recipe, title: "上限追加前に保存した長いレシピ" }],
        recipeTags: { [recipe.id]: [] },
        recipeContents: {
          [recipe.id]: {
            referenceImages: [],
            ingredientGroups: [],
            steps: [{ text: "あ".repeat(MAX_RECIPE_STEP_TEXT_LENGTH + 1), images: [] }],
            note: undefined,
          },
        },
      };
    },
  },
  {
    id: "max-tags",
    group: "recipes",
    label: "タグが10個付いたレシピ",
    build: maxTagsState,
  },
  {
    id: "recipe-tag-save-error",
    group: "recipes",
    label: "レシピのタグ保存失敗",
    build: () => ({ ...baseState(), failures: { replaceRecipeTags: true } }),
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
    id: "pro-import-limit",
    group: "plan",
    label: "Pro(今月のAI取り込みが上限)",
    build: () => {
      const state = baseState();

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
    id: "pro-canceling-no-lock",
    group: "plan",
    label: "Pro(解約予約中・Free上限以内)",
    build: () => {
      const state = baseState();
      const recipeCount = 3;

      return {
        ...state,
        viewer: viewerFixture({ plan: "pro", recipeCount }),
        billing: proBillingStatusFixture({ cancelAtPeriodEnd: true }),
        recipes: recipeListFixture({ count: recipeCount }),
        recipeTags: recipeTagsFixture({ count: recipeCount }),
      };
    },
  },
  {
    id: "pro-past-due",
    group: "plan",
    label: "Pro(支払いを確認できない)",
    build: () => ({ ...baseState(), billing: proBillingStatusFixture({ status: "past_due" }) }),
  },
  {
    id: "billing-status-error",
    group: "plan",
    label: "契約状態の取得失敗",
    build: () => ({ ...baseState(), failures: { getBillingStatus: true } }),
  },
  {
    id: "pro-price-error",
    group: "plan",
    label: "Pro価格の取得失敗",
    build: () => ({ ...freeState(2), failures: { getProPrice: true } }),
  },
  {
    id: "checkout-error",
    group: "plan",
    label: "決済画面を開けない",
    build: () => ({ ...freeState(2), failures: { createCheckout: true } }),
  },
  {
    id: "billing-portal-error",
    group: "plan",
    label: "契約管理画面を開けない",
    build: () => ({ ...baseState(), failures: { createBillingPortal: true } }),
  },
  {
    id: "linked-devices",
    group: "settings",
    label: "共有を2台と連携中",
    build: () => ({
      ...baseState(),
      shortcutCredentials: linkedShortcutCredentialsFixture(),
    }),
  },
  {
    id: "viewer-error",
    group: "settings",
    label: "プラン・利用状況の取得失敗",
    build: () => ({ ...baseState(), failures: { getViewer: true } }),
  },
  {
    id: "tags-error",
    group: "settings",
    label: "タグの取得失敗",
    build: () => ({ ...baseState(), failures: { listTags: true } }),
  },
  {
    id: "shortcut-credentials-error",
    group: "settings",
    label: "連携端末の取得失敗",
    build: () => ({ ...baseState(), failures: { listShortcutCredentials: true } }),
  },
  {
    id: "push-subscriptions-error",
    group: "settings",
    label: "通知状態の取得失敗",
    build: () => ({ ...baseState(), failures: { getPushSubscriptions: true } }),
  },
  {
    id: "shortcut-issue-error",
    group: "settings",
    label: "連携キーの発行失敗",
    build: () => ({ ...baseState(), failures: { issueShortcutCredential: true } }),
  },
  {
    id: "shortcut-revoke-error",
    group: "settings",
    label: "端末の連携解除失敗",
    build: () => ({
      ...baseState(),
      shortcutCredentials: linkedShortcutCredentialsFixture(),
      failures: { revokeShortcutCredential: true },
    }),
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
    id: "password-and-google",
    group: "account",
    label: "パスワードとGoogleでログイン",
    build: () => ({
      ...baseState(),
      loginAccounts: passwordAndGoogleLoginAccountsFixture(),
    }),
  },
  {
    id: "login-methods-error",
    group: "account",
    label: "ログイン方法の取得失敗",
    build: () => ({ ...baseState(), failures: { listLoginAccounts: true } }),
  },
  {
    id: "account-write-error",
    group: "account",
    label: "メール・パスワード変更失敗",
    build: () => ({
      ...baseState(),
      failures: { changeEmail: true, changePassword: "generic" },
    }),
  },
  {
    id: "invalid-current-password",
    group: "account",
    label: "現在のパスワードが不一致",
    build: () => ({ ...baseState(), failures: { changePassword: "invalid-password" } }),
  },
  {
    id: "sign-out-error",
    group: "account",
    label: "ログアウト失敗",
    build: () => ({ ...baseState(), failures: { signOut: true } }),
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
