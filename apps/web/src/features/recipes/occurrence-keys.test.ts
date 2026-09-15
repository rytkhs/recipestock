import { describe, expect, it } from "vitest";
import { withOccurrenceKeys } from "./occurrence-keys";

describe("withOccurrenceKeys", () => {
  it("同じ内容が並んでも、何番目に出てきたかでキーを分ける", () => {
    expect(withOccurrenceKeys(["塩", "砂糖", "塩"], (name) => name)).toEqual([
      { item: "塩", key: "塩#0" },
      { item: "砂糖", key: "砂糖#0" },
      { item: "塩", key: "塩#1" },
    ]);
  });
});
