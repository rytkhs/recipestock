import { type RecipeListItem } from "@recipestock/schemas";
import { formatRecipeUpdatedAt, groupRecipesByPeriod } from "./recipe-shelf";

const now = new Date(2026, 4, 26, 12, 0, 0);

const recipe = (id: string, updatedAt: Date): RecipeListItem => ({
  id,
  title: id,
  coverImageUrl: null,
  sourceName: null,
  createdAt: updatedAt.toISOString(),
  updatedAt: updatedAt.toISOString(),
  locked: false,
});

describe("groupRecipesByPeriod", () => {
  it("同じ期間のRecipeを1つの区切りにまとめる", () => {
    const sections = groupRecipesByPeriod(
      [recipe("recipe_1", now), recipe("recipe_2", new Date(2026, 4, 25, 9, 0, 0))],
      now,
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe("今週");
    expect(sections[0].recipes.map((item) => item.id)).toEqual(["recipe_1", "recipe_2"]);
  });

  it("今週・今月・過去の月で区切りを変える", () => {
    const sections = groupRecipesByPeriod(
      [
        recipe("this_week", now),
        recipe("this_month", new Date(2026, 4, 16)),
        recipe("march", new Date(2026, 2, 10)),
      ],
      now,
    );

    expect(sections.map((section) => section.label)).toEqual(["今週", "今月", "3月"]);
  });

  it("前の年の区切りには年を付ける", () => {
    const sections = groupRecipesByPeriod([recipe("last_year", new Date(2025, 10, 2))], now);

    expect(sections[0].label).toBe("2025年11月");
  });

  it("日付が読めないRecipeも区切りに載せる", () => {
    const broken = { ...recipe("broken", now), updatedAt: "not-a-date" };

    expect(groupRecipesByPeriod([broken], now)[0].label).toBe("日付不明");
  });
});

describe("formatRecipeUpdatedAt", () => {
  it("同じ年は月日だけを出す", () => {
    expect(formatRecipeUpdatedAt(new Date(2026, 4, 26).toISOString(), now)).toBe("5月26日");
  });

  it("違う年は年から出す", () => {
    expect(formatRecipeUpdatedAt(new Date(2025, 10, 2).toISOString(), now)).toBe("2025年11月2日");
  });

  it("日付が読めないときは何も出さない", () => {
    expect(formatRecipeUpdatedAt("not-a-date", now)).toBe("");
  });
});
