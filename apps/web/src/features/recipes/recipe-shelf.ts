import { type RecipeListItem } from "@recipestock/schemas";
import { type RecipeViewMode } from "./view-mode";

// 棚の骨格。skeletonが同じ形で出るように、実カードと同じclassをここから配る。
export const recipeShelfContainerClass = (viewMode: RecipeViewMode) =>
  viewMode === "grid"
    ? "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-8 lg:grid-cols-4"
    : "flex flex-col divide-y divide-brand-line-soft";

export type RecipeShelfSection = {
  key: string;
  label: string;
  recipes: RecipeListItem[];
};

// 一覧APIはupdatedAt降順で返す。見出しも同じ軸で切らないと区切りが飛び飛びになるので、
// createdAtではなくupdatedAtで期間を決める。
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfWeek = (now: Date) => {
  const start = startOfDay(now);
  const daysSinceMonday = (start.getDay() + 6) % 7;

  start.setDate(start.getDate() - daysSinceMonday);
  return start;
};

const resolvePeriod = (updatedAt: Date, now: Date) => {
  if (Number.isNaN(updatedAt.getTime())) {
    return { key: "unknown", label: "日付不明" };
  }

  if (updatedAt.getTime() >= startOfWeek(now).getTime()) {
    return { key: "this-week", label: "今週" };
  }

  const isSameYear = updatedAt.getFullYear() === now.getFullYear();

  if (isSameYear && updatedAt.getMonth() === now.getMonth()) {
    return { key: "this-month", label: "今月" };
  }

  const month = updatedAt.getMonth() + 1;

  return {
    key: `${updatedAt.getFullYear()}-${month}`,
    label: isSameYear ? `${month}月` : `${updatedAt.getFullYear()}年${month}月`,
  };
};

export const groupRecipesByPeriod = (
  recipes: readonly RecipeListItem[],
  now = new Date(),
): RecipeShelfSection[] => {
  const sections: RecipeShelfSection[] = [];

  for (const recipe of recipes) {
    const { key, label } = resolvePeriod(new Date(recipe.updatedAt), now);
    const currentSection = sections.at(-1);

    if (currentSection?.key === key) {
      currentSection.recipes.push(recipe);
      continue;
    }

    sections.push({ key, label, recipes: [recipe] });
  }

  return sections;
};

export const formatRecipeUpdatedAt = (updatedAt: string, now = new Date()) => {
  const date = new Date(updatedAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();

  return date.getFullYear() === now.getFullYear()
    ? `${month}月${day}日`
    : `${date.getFullYear()}年${month}月${day}日`;
};
