import { describe, expect, it } from "vitest";
import { parsePastedIngredients } from "./ingredient-lines";

describe("parsePastedIngredients", () => {
  it("1行を1つの材料にし、空行と行頭の記号を除く", () => {
    expect(
      parsePastedIngredients("・鶏むね肉 1枚(300g)\n\n● 大根　1/4本\r\n片栗粉…大さじ2\n塩"),
    ).toEqual([
      { name: "鶏むね肉", amount: "1枚(300g)" },
      { name: "大根", amount: "1/4本" },
      { name: "片栗粉", amount: "大さじ2" },
      { name: "塩", amount: "" },
    ]);
  });

  it("タブ・コロン・2つ以上の空白で名前と分量を分ける", () => {
    expect(parsePastedIngredients("しょうゆ\t大さじ2\nみりん：大さじ2\nsugar  10g")).toEqual([
      { name: "しょうゆ", amount: "大さじ2" },
      { name: "みりん", amount: "大さじ2" },
      { name: "sugar", amount: "10g" },
    ]);
  });

  it("半角空白1つでは、後ろが分量らしく始まるときだけ分ける", () => {
    expect(
      parsePastedIngredients(
        "鶏もも肉 1枚 (300g)\nA しょうゆ 大さじ2\n青ねぎ(小口切り) 適量\nベーキング パウダー",
      ),
    ).toEqual([
      { name: "鶏もも肉", amount: "1枚 (300g)" },
      { name: "A しょうゆ", amount: "大さじ2" },
      { name: "青ねぎ(小口切り)", amount: "適量" },
      { name: "ベーキング パウダー", amount: "" },
    ]);
  });

  it("番号付きの行は番号を除く", () => {
    expect(parsePastedIngredients("1. 卵 2個\n2) 牛乳 200ml")).toEqual([
      { name: "卵", amount: "2個" },
      { name: "牛乳", amount: "200ml" },
    ]);
  });
});
