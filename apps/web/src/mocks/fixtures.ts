import {
  type GetBillingStatusResponse,
  type GetMeResponse,
  type GetProPriceResponse,
  type GetPushSubscriptionsResponse,
  type ImportJobSummary,
  type ListShortcutCredentialsResponse,
  type RecipeDetail,
  type RecipeListItem,
} from "@recipestock/schemas";
import { PLAN_LIMITS, type Plan } from "@recipestock/shared";
import { imagePlaceholderSize } from "./images";

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

const getJstAiUsagePeriod = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  if (!year || !month) {
    throw new Error("Failed to format current JST month.");
  }

  const monthNumber = Number(month);
  const nextMonthYear = monthNumber === 12 ? Number(year) + 1 : Number(year);
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;

  return {
    month: `${year}-${month}`,
    resetAt: new Date(Date.UTC(nextMonthYear, nextMonth - 1, 1, -9)).toISOString(),
  };
};

export const viewerFixture = (
  overrides: Partial<GetMeResponse> = {},
  now = new Date(),
): GetMeResponse => {
  const plan: Plan = overrides.plan ?? "free";
  const limits = PLAN_LIMITS[plan];
  const aiUsagePeriod = getJstAiUsagePeriod(now);

  return {
    userId: MOCK_USER_ID,
    email: MOCK_USER_EMAIL,
    plan,
    recipeCount: 0,
    recipeLimit: limits.savedRecipes,
    isRecipeLimitReached: false,
    aiUsage: {
      month: aiUsagePeriod.month,
      used: 0,
      limit: limits.monthlyAiImports,
      resetAt: aiUsagePeriod.resetAt,
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

// Proで契約中。更新日は開いた日から20日後にする。
export const proBillingStatusFixture = (
  subscription: Partial<NonNullable<GetBillingStatusResponse["subscription"]>> = {},
): GetBillingStatusResponse => ({
  plan: "pro",
  subscription: {
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    cancelAt: null,
    ...subscription,
  },
});

export const proPriceFixture = (): GetProPriceResponse => ({
  amount: 480,
  currency: "jpy",
  interval: "month",
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
  /** 追加日を「今日から何日前か」で置く。棚の期間見出しが複数出るようにばらけさせている。 */
  createdDaysAgo: number;
};

// APIの既定と同じく追加が新しい順に並べる。1ページ20件なので、既定の取得でも2ページ目が出る件数を用意する。
const recipeSeeds: RecipeSeed[] = [
  {
    title: "鶏むね肉のみぞれ煮",
    sourceName: "クックパッド",
    sourceUrl: "https://cookpad.com/recipe/mock0001",
    createdDaysAgo: 0,
  },
  {
    title: "基本のポテトサラダ",
    sourceName: "白ごはん.com",
    sourceUrl: "https://www.sirogohan.com/recipe/potesara/",
    createdDaysAgo: 0,
  },
  {
    title: "台湾まぜそば",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0003",
    createdDaysAgo: 1,
  },
  {
    title: "トマトとモッツァレラの冷製パスタ",
    sourceName: "Instagram",
    sourceUrl: "https://www.instagram.com/p/mock0004/",
    createdDaysAgo: 2,
  },
  {
    title: "豚バラ大根",
    sourceName: "クラシル",
    sourceUrl: "https://www.kurashiru.com/recipes/mock0005",
    createdDaysAgo: 3,
  },
  { title: "きのこたっぷりクリームリゾット", sourceName: null, sourceUrl: null, createdDaysAgo: 9 },
  { title: "さばの味噌煮", sourceName: "『和食の基本』", sourceUrl: null, createdDaysAgo: 11 },
  {
    title: "ガパオライス",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0008",
    createdDaysAgo: 13,
  },
  { title: "キャロットラペ", sourceName: null, sourceUrl: null, createdDaysAgo: 15 },
  {
    title: "牛すじ煮込み",
    sourceName: "デリッシュキッチン",
    sourceUrl: "https://delishkitchen.tv/recipes/mock0010",
    createdDaysAgo: 18,
  },
  {
    title: "あさりの酒蒸し",
    sourceName: "白ごはん.com",
    sourceUrl: "https://www.sirogohan.com/recipe/asari/",
    createdDaysAgo: 21,
  },
  {
    title: "抹茶のパウンドケーキ",
    sourceName: "Instagram",
    sourceUrl: "https://www.instagram.com/p/mock0012/",
    createdDaysAgo: 24,
  },
  {
    title: "麻婆豆腐",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0013",
    createdDaysAgo: 38,
  },
  {
    title: "じゃがいもとベーコンのガレット",
    sourceName: null,
    sourceUrl: null,
    createdDaysAgo: 41,
  },
  {
    title: "鮭とほうれん草のクリームパスタ",
    sourceName: "クラシル",
    sourceUrl: "https://www.kurashiru.com/recipes/mock0015",
    createdDaysAgo: 44,
  },
  { title: "かぼちゃの煮物", sourceName: "『和食の基本』", sourceUrl: null, createdDaysAgo: 47 },
  {
    title: "スパイスチキンカレー",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0017",
    createdDaysAgo: 51,
  },
  {
    title: "ブロッコリーとエビのアヒージョ",
    sourceName: "Instagram",
    sourceUrl: "https://www.instagram.com/p/mock0018/",
    createdDaysAgo: 55,
  },
  {
    title: "肉じゃが",
    sourceName: "白ごはん.com",
    sourceUrl: "https://www.sirogohan.com/recipe/nikujaga/",
    createdDaysAgo: 58,
  },
  { title: "しらすとねぎの和風ピザ", sourceName: null, sourceUrl: null, createdDaysAgo: 62 },
  {
    title: "手羽元のさっぱり煮",
    sourceName: "クックパッド",
    sourceUrl: "https://cookpad.com/recipe/mock0021",
    createdDaysAgo: 76,
  },
  { title: "きんぴらごぼう", sourceName: "『和食の基本』", sourceUrl: null, createdDaysAgo: 80 },
  {
    title: "ビーフストロガノフ",
    sourceName: "デリッシュキッチン",
    sourceUrl: "https://delishkitchen.tv/recipes/mock0023",
    createdDaysAgo: 84,
  },
  { title: "焼きねぎのマリネ", sourceName: null, sourceUrl: null, createdDaysAgo: 88 },
  {
    title: "バスクチーズケーキ",
    sourceName: "Instagram",
    sourceUrl: "https://www.instagram.com/p/mock0025/",
    createdDaysAgo: 112,
  },
  {
    title: "参鶏湯風スープ",
    sourceName: "YouTube",
    sourceUrl: "https://www.youtube.com/watch?v=mock0026",
    createdDaysAgo: 120,
  },
];

export const MOCK_RECIPE_SEED_COUNT = recipeSeeds.length;

const daysAgoIso = (days: number, now: Date) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

export const mockRecipeId = (index: number) => `recipe_${String(index + 1).padStart(3, "0")}`;

export type MockTag = {
  id: string;
  name: string;
};

// seedのタイトルごとに付けておくタグ。チップ列の件数順とANDの絞り込みを確かめられるよう、件数に差をつけている。
const recipeSeedTagNames: Record<string, string[]> = {
  鶏むね肉のみぞれ煮: ["主菜", "鶏肉"],
  基本のポテトサラダ: ["副菜", "作り置き"],
  台湾まぜそば: ["麺・丼"],
  豚バラ大根: ["主菜", "作り置き"],
  さばの味噌煮: ["主菜"],
  ガパオライス: ["麺・丼", "鶏肉"],
  キャロットラペ: ["副菜", "作り置き", "お弁当"],
  牛すじ煮込み: ["主菜", "作り置き"],
  あさりの酒蒸し: ["おつまみ"],
  抹茶のパウンドケーキ: ["お菓子"],
  麻婆豆腐: ["主菜"],
  かぼちゃの煮物: ["副菜", "作り置き", "お弁当"],
  スパイスチキンカレー: ["主菜", "鶏肉"],
  肉じゃが: ["主菜", "作り置き"],
  手羽元のさっぱり煮: ["主菜", "鶏肉", "作り置き"],
  きんぴらごぼう: ["副菜", "作り置き", "お弁当"],
  焼きねぎのマリネ: ["副菜", "おつまみ"],
  バスクチーズケーキ: ["お菓子"],
};

// seedに付けたタグを、初めて出てきた順に語彙として並べる。
const mockTagNames = [
  ...new Set(recipeSeeds.flatMap((seed) => recipeSeedTagNames[seed.title] ?? [])),
];

const mockTagId = (index: number) => `tag_${String(index + 1).padStart(3, "0")}`;

export const tagsFixture = (): MockTag[] =>
  mockTagNames.map((name, index) => ({ id: mockTagId(index), name }));

// Recipeのidごとに、付けたタグのidを付けた順に持つ。
export const recipeTagsFixture = ({
  count = recipeSeeds.length,
}: {
  count?: number;
} = {}): Record<string, string[]> =>
  Object.fromEntries(
    recipeSeeds
      .slice(0, count)
      .map((seed, index) => [
        mockRecipeId(index),
        (recipeSeedTagNames[seed.title] ?? []).map((name) => mockTagId(mockTagNames.indexOf(name))),
      ]),
  );

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
      createdAt: daysAgoIso(seed.createdDaysAgo, now),
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
      // 取り込みで名前と分量を分けられなかった行は、分量を空にして行全体を名前に入れる。
      { name: "青ねぎ(小口切り) 適量", amount: "" },
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

// APIが保存する画像と同じく、縦横は配信するプレースホルダ画像の実寸に揃える。
const recipeImageFixture = (recipeId: string, name: string) => {
  const objectKey = objectKeyFor(recipeId, name);

  return { objectKey, ...imagePlaceholderSize(objectKey), url: recipeImageUrl(objectKey) };
};

export const recipeDetailFixture = (
  recipeId: string,
  overrides: Partial<RecipeDetail> = {},
): RecipeDetail => {
  const seedIndex = Math.max(
    0,
    recipeSeeds.findIndex((_, index) => mockRecipeId(index) === recipeId),
  );
  const seed = recipeSeeds[seedIndex];
  const now = new Date();

  return {
    id: recipeId,
    title: seed.title,
    content: {
      title: seed.title,
      yieldText: "2人分",
      coverImage: recipeImageFixture(recipeId, "cover"),
      referenceImages: [
        recipeImageFixture(recipeId, "source-1"),
        recipeImageFixture(recipeId, "source-2"),
      ],
      ingredientGroups,
      steps: [
        { text: "鶏むね肉をそぎ切りにし、片栗粉をまぶす。", images: [] },
        {
          text: "フライパンに油を熱し、両面を焼き色がつくまで焼く。",
          images: [recipeImageFixture(recipeId, "step-1")],
        },
        {
          text: "大根おろしと合わせ調味料を加え、5分ほど煮詰める。途中で一度返し、とろみがついたら火を止める。",
          images: [recipeImageFixture(recipeId, "step-2"), recipeImageFixture(recipeId, "step-3")],
        },
        { text: "器に盛り、青ねぎを散らす。", images: [] },
      ],
      note: "大根おろしは汁ごと入れるとやさしい味になる。\n片栗粉をまぶしてから焼くと、むね肉がパサつかない。",
    },
    source: {
      sourceUrl: seed.sourceUrl,
      normalizedSourceUrl: seed.sourceUrl,
      sourceName: seed.sourceName,
    },
    createdAt: daysAgoIso(seed.createdDaysAgo, now),
    updatedAt: daysAgoIso(seed.createdDaysAgo, now),
    tags: [],
    locked: false,
    ...overrides,
  };
};

export type RecipeContentOverride = Partial<RecipeDetail["content"]>;

/**
 * SNSの画像だけの投稿から取り込んだ本文(ADR 0017)。表紙とレシピ画像だけを持つ。
 * 取り込みと同じく、表紙は投稿の1枚目で、レシピ画像にも1枚目から投稿の順に入る。
 */
export const imageOnlyRecipeContentFixture = (
  recipeId: string,
  imageCount: number,
): RecipeContentOverride => ({
  yieldText: undefined,
  referenceImages: Array.from({ length: imageCount }, (_, index) =>
    recipeImageFixture(recipeId, index === 0 ? "cover" : `post-${index + 1}`),
  ),
  ingredientGroups: [],
  steps: [],
  note: undefined,
});

/** 表紙・レシピ画像・手順画像の一部を読み込めない本文。画像の配信はキーに broken を含むと404を返す。 */
export const brokenImageRecipeContentFixture = (recipeId: string): RecipeContentOverride => ({
  coverImage: recipeImageFixture(recipeId, "broken-cover"),
  referenceImages: [
    recipeImageFixture(recipeId, "broken-source-1"),
    recipeImageFixture(recipeId, "source-2"),
  ],
  steps: recipeDetailFixture(recipeId).content.steps.map((step, index) =>
    index === 1 ? { ...step, images: [recipeImageFixture(recipeId, "broken-step-1")] } : step,
  ),
});

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

/** better-authの`/list-accounts`が返す1件。パスワードは"credential"というproviderで持つ。 */
export type LoginAccountFixture = {
  accountId: string;
  createdAt: string;
  id: string;
  providerId: string;
  scopes: string[];
  updatedAt: string;
  userId: string;
};

export const loginAccountFixture = (providerId: string): LoginAccountFixture => ({
  accountId: providerId === "credential" ? MOCK_USER_ID : `${providerId}_account_123`,
  createdAt: "2026-01-01T00:00:00.000Z",
  id: `account_${providerId}`,
  providerId,
  scopes: providerId === "credential" ? [] : ["openid", "email", "profile"],
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: MOCK_USER_ID,
});

/** メールアドレスとパスワードでログインする人。 */
export const passwordLoginAccountsFixture = (): LoginAccountFixture[] => [
  loginAccountFixture("credential"),
];

/** Googleだけでログインする人。パスワードを持たない。 */
export const googleLoginAccountsFixture = (): LoginAccountFixture[] => [
  loginAccountFixture("google"),
];
