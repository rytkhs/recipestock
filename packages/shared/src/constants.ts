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
