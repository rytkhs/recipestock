export const FREE_RECIPE_LIMIT = 5;

export const PLAN_LIMITS = {
  free: {
    savedRecipes: FREE_RECIPE_LIMIT,
    monthlyAiImports: 10,
  },
  pro: {
    savedRecipes: null,
    monthlyAiImports: 300,
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;
