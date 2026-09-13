import {
  type GetBillingStatusResponse,
  type GetMeResponse,
  type GetPushSubscriptionsResponse,
  type ImportJobSummary,
  type ListShortcutCredentialsResponse,
  type RecipeDetail,
  type RecipeListItem,
} from "@recipestock/schemas";
import { PLAN_LIMITS, type Plan } from "@recipestock/shared";

// モックの世界の住人。router-test-utilsが使っている値と同じにしておく。
export const MOCK_USER_ID = "user_123";
export const MOCK_USER_EMAIL = "chef@example.com";

export type SessionFixture = {
  session: { id: string; userId: string };
  user: { id: string; email: string; name: string };
};

export const sessionFixture = (): SessionFixture => ({
  session: { id: "session_123", userId: MOCK_USER_ID },
  user: { id: MOCK_USER_ID, email: MOCK_USER_EMAIL, name: "chef" },
});

export const viewerFixture = (overrides: Partial<GetMeResponse> = {}): GetMeResponse => {
  const plan: Plan = overrides.plan ?? "free";
  const limits = PLAN_LIMITS[plan];

  return {
    userId: MOCK_USER_ID,
    email: MOCK_USER_EMAIL,
    plan,
    recipeCount: 0,
    recipeLimit: limits.savedRecipes,
    isRecipeLimitReached: false,
    aiUsage: {
      month: "2026-05",
      used: 0,
      limit: limits.monthlyAiImports,
      resetAt: "2026-05-31T15:00:00.000Z",
    },
    ...overrides,
  };
};

export const billingStatusFixture = (
  overrides: Partial<GetBillingStatusResponse> = {},
): GetBillingStatusResponse => ({
  plan: "free",
  subscription: null,
  ...overrides,
});

const encodeObjectKey = (objectKey: string) =>
  objectKey.split("/").map(encodeURIComponent).join("/");

// APIと同じ形のURLを作る。実装は apps/api/src/recipe-thumbnails.ts:26 と apps/api/src/images.ts:44。
export const recipeThumbnailUrl = (objectKey: string) =>
  `/api/images/thumbnail/v1/${encodeObjectKey(objectKey)}`;

export const recipeImageUrl = (objectKey: string) =>
  `/api/images/object/${encodeObjectKey(objectKey)}`;

const objectKeyFor = (recipeId: string, name: string) =>
  `recipes/${MOCK_USER_ID}/${recipeId}/${name}.webp`;

type RecipeSeed = {
  title: string;
  sourceName: string | null;
  sourceUrl: string | null;
  /** 更新日を「今日から何日前か」で置く。棚の期間見出しが複数出るようにばらけさせている。 */
  updatedDaysAgo: number;
};

// 1ページ20件なので、既定の取得でも2ページ目が出る件数を用意する。
const recipeSeeds: RecipeSeed[] = [
  {
    title: "鶏むね肉のみぞれ煮",
    sourceName: "クックパッド",
    sourceUrl: "https://cookpad.com/recipe/mock0001",
    updatedDaysAgo: 0,
  },
  {
    title: "基本のポテトサラダ",
    sourceName: "白ごはん.com",
    sourceUrl: "https://www.sirogohan.com/recipe/potesara/",
    updatedDaysAgo: 0,
  },
  {
    title: "台湾まぜそば",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0003",
    updatedDaysAgo: 1,
  },
  {
    title: "トマトとモッツァレラの冷製パスタ",
    sourceName: "Instagram",
    sourceUrl: "https://www.instagram.com/p/mock0004/",
    updatedDaysAgo: 2,
  },
  {
    title: "豚バラ大根",
    sourceName: "クラシル",
    sourceUrl: "https://www.kurashiru.com/recipes/mock0005",
    updatedDaysAgo: 3,
  },
  { title: "きのこたっぷりクリームリゾット", sourceName: null, sourceUrl: null, updatedDaysAgo: 9 },
  { title: "さばの味噌煮", sourceName: "『和食の基本』", sourceUrl: null, updatedDaysAgo: 11 },
  {
    title: "ガパオライス",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0008",
    updatedDaysAgo: 13,
  },
  { title: "キャロットラペ", sourceName: null, sourceUrl: null, updatedDaysAgo: 15 },
  {
    title: "牛すじ煮込み",
    sourceName: "デリッシュキッチン",
    sourceUrl: "https://delishkitchen.tv/recipes/mock0010",
    updatedDaysAgo: 18,
  },
  {
    title: "あさりの酒蒸し",
    sourceName: "白ごはん.com",
    sourceUrl: "https://www.sirogohan.com/recipe/asari/",
    updatedDaysAgo: 21,
  },
  {
    title: "抹茶のパウンドケーキ",
    sourceName: "Instagram",
    sourceUrl: "https://www.instagram.com/p/mock0012/",
    updatedDaysAgo: 24,
  },
  {
    title: "麻婆豆腐",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0013",
    updatedDaysAgo: 38,
  },
  {
    title: "じゃがいもとベーコンのガレット",
    sourceName: null,
    sourceUrl: null,
    updatedDaysAgo: 41,
  },
  {
    title: "鮭とほうれん草のクリームパスタ",
    sourceName: "クラシル",
    sourceUrl: "https://www.kurashiru.com/recipes/mock0015",
    updatedDaysAgo: 44,
  },
  { title: "かぼちゃの煮物", sourceName: "『和食の基本』", sourceUrl: null, updatedDaysAgo: 47 },
  {
    title: "スパイスチキンカレー",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0017",
    updatedDaysAgo: 51,
  },
  {
    title: "ブロッコリーとエビのアヒージョ",
    sourceName: "Instagram",
    sourceUrl: "https://www.instagram.com/p/mock0018/",
    updatedDaysAgo: 55,
  },
  {
    title: "肉じゃが",
    sourceName: "白ごはん.com",
    sourceUrl: "https://www.sirogohan.com/recipe/nikujaga/",
    updatedDaysAgo: 58,
  },
  { title: "しらすとねぎの和風ピザ", sourceName: null, sourceUrl: null, updatedDaysAgo: 62 },
  {
    title: "手羽元のさっぱり煮",
    sourceName: "クックパッド",
    sourceUrl: "https://cookpad.com/recipe/mock0021",
    updatedDaysAgo: 76,
  },
  { title: "きんぴらごぼう", sourceName: "『和食の基本』", sourceUrl: null, updatedDaysAgo: 80 },
  {
    title: "ビーフストロガノフ",
    sourceName: "デリッシュキッチン",
    sourceUrl: "https://delishkitchen.tv/recipes/mock0023",
    updatedDaysAgo: 84,
  },
  { title: "焼きねぎのマリネ", sourceName: null, sourceUrl: null, updatedDaysAgo: 88 },
  {
    title: "バスクチーズケーキ",
    sourceName: "Instagram",
    sourceUrl: "https://www.instagram.com/p/mock0025/",
    updatedDaysAgo: 112,
  },
  {
    title: "参鶏湯風スープ",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0026",
    updatedDaysAgo: 120,
  },
];

export const MOCK_RECIPE_SEED_COUNT = recipeSeeds.length;

const daysAgoIso = (days: number, now: Date) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

export const mockRecipeId = (index: number) => `recipe_${String(index + 1).padStart(3, "0")}`;

export type RecipeListFixtureOptions = {
  count?: number;
  /** この件数を超えたRecipeを locked: true にする。free棚の確認用。 */
  unlockedCount?: number;
  withCoverImage?: boolean;
  /** このindexのカバー画像を404にする。読み込み失敗の表示確認用。 */
  brokenCoverIndexes?: readonly number[];
  now?: Date;
};

export const recipeListFixture = ({
  count = recipeSeeds.length,
  unlockedCount,
  withCoverImage = true,
  brokenCoverIndexes = [],
  now = new Date(),
}: RecipeListFixtureOptions = {}): RecipeListItem[] =>
  recipeSeeds.slice(0, count).map((seed, index) => {
    const id = mockRecipeId(index);
    const isBroken = brokenCoverIndexes.includes(index);
    const coverKey = objectKeyFor(id, isBroken ? "broken-cover" : "cover");

    return {
      id,
      title: seed.title,
      coverImageUrl: withCoverImage ? recipeThumbnailUrl(coverKey) : null,
      sourceName: seed.sourceName,
      createdAt: daysAgoIso(seed.updatedDaysAgo + 3, now),
      updatedAt: daysAgoIso(seed.updatedDaysAgo, now),
      locked: unlockedCount === undefined ? false : index >= unlockedCount,
    };
  });

const ingredientGroups = [
  {
    label: "材料",
    ingredients: [
      { name: "鶏むね肉", amount: "1枚(300g)" },
      { name: "大根", amount: "1/4本" },
      { name: "片栗粉", amount: "大さじ2" },
      { name: "サラダ油", amount: "大さじ1" },
    ],
  },
  {
    label: "合わせ調味料",
    ingredients: [
      { name: "しょうゆ", amount: "大さじ2" },
      { name: "みりん", amount: "大さじ2" },
      { name: "酒", amount: "大さじ1" },
      { name: "砂糖", amount: "小さじ2" },
    ],
  },
];

export const recipeDetailFixture = (
  recipeId: string,
  overrides: Partial<RecipeDetail> = {},
): RecipeDetail => {
  const seedIndex = Math.max(
    0,
    recipeSeeds.findIndex((_, index) => mockRecipeId(index) === recipeId),
  );
  const seed = recipeSeeds[seedIndex];
  const coverKey = objectKeyFor(recipeId, "cover");
  const referenceKey = objectKeyFor(recipeId, "source-1");
  const stepKey = objectKeyFor(recipeId, "step-1");
  const now = new Date();

  return {
    id: recipeId,
    title: seed.title,
    content: {
      title: seed.title,
      yieldText: "2人分",
      coverImage: {
        objectKey: coverKey,
        width: 1200,
        height: 900,
        url: recipeImageUrl(coverKey),
      },
      referenceImages: [
        { objectKey: referenceKey, width: 1080, height: 1080, url: recipeImageUrl(referenceKey) },
      ],
      ingredientGroups,
      steps: [
        { text: "鶏むね肉をそぎ切りにし、片栗粉をまぶす。", images: [] },
        {
          text: "フライパンに油を熱し、両面を焼き色がつくまで焼く。",
          images: [{ objectKey: stepKey, width: 1000, height: 750, url: recipeImageUrl(stepKey) }],
        },
        { text: "大根おろしと合わせ調味料を加え、5分ほど煮詰める。", images: [] },
      ],
      note: "大根おろしは汁ごと入れるとやさしい味になる。",
    },
    source: {
      sourceUrl: seed.sourceUrl,
      normalizedSourceUrl: seed.sourceUrl,
      sourceName: seed.sourceName,
    },
    createdAt: daysAgoIso(seed.updatedDaysAgo + 3, now),
    updatedAt: daysAgoIso(seed.updatedDaysAgo, now),
    locked: false,
    ...overrides,
  };
};

export const importJobFixture = (overrides: Partial<ImportJobSummary> = {}): ImportJobSummary => {
  const now = new Date();

  return {
    id: "job_001",
    kind: "url",
    status: "running",
    url: "https://www.sirogohan.com/recipe/potesara/",
    textPreview: null,
    recipeId: null,
    errorCode: null,
    createdAt: new Date(now.getTime() - 20_000).toISOString(),
    startedAt: new Date(now.getTime() - 15_000).toISOString(),
    finishedAt: null,
    ...overrides,
  };
};

export const pushSubscriptionsFixture = (
  overrides: Partial<GetPushSubscriptionsResponse> = {},
): GetPushSubscriptionsResponse => ({
  applicationServerKey: "BMockApplicationServerKeyForLocalDevelopmentOnly",
  subscriptions: [],
  ...overrides,
});

export const shortcutCredentialsFixture = (
  overrides: Partial<ListShortcutCredentialsResponse> = {},
): ListShortcutCredentialsResponse => ({
  credentials: [],
  ...overrides,
});
