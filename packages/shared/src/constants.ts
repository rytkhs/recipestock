export const FREE_RECIPE_LIMIT = 5;

export const PLAN_NAMES = ["free", "pro"] as const;

export type Plan = (typeof PLAN_NAMES)[number];

export const PLAN_LIMITS = {
  free: {
    savedRecipes: FREE_RECIPE_LIMIT,
    monthlyAiImports: 10,
  },
  pro: {
    savedRecipes: null,
    monthlyAiImports: 300,
  },
} as const satisfies Record<Plan, { savedRecipes: number | null; monthlyAiImports: number }>;

/**
 * 共有から取り込む設定の③で、設定画面が共有メニューへ渡すURLのpath。設定画面そのもののpathであり、
 * ショートカットから届いた最初のURLがこのpathなら、apiは取り込みではなく設定の確認として扱う。
 */
export const IOS_SHARE_SETUP_CHECK_PATH = "/settings/share";
