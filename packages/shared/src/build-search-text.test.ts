import { describe, expect, it } from "vitest";
import { buildSearchText } from "./build-search-text";

describe("buildSearchText", () => {
  it("レシピ名、材料名、メモ、出典名だけから検索テキストを作る", () => {
    expect(
      buildSearchText({
        title: "Tomato Pasta",
        sourceName: "Example Kitchen",
        ingredientNames: ["トマト缶", "Basil"],
        ingredientAmounts: ["1缶"],
        stepTexts: ["煮詰める"],
        note: "仕上げにオリーブオイル。",
        sourceUrl: "https://example.com/recipes/tomato",
      }),
    ).toBe("tomato pasta example kitchen トマト缶 basil 仕上げにオリーブオイル。");
  });
});
