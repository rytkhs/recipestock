import { describe, expect, it } from "vitest";
import { withOccurrenceKeys } from "./occurrence-keys";

describe("withOccurrenceKeys", () => {
  it("重複した項目も順序を保ち、互いに異なるキーを持つ", () => {
    const items = ["塩", "砂糖", "塩"];
    const entries = withOccurrenceKeys(items, (name) => name);
    expect(entries.map(({ item }) => item)).toEqual(items);
    expect(new Set(entries.map(({ key }) => key)).size).toBe(3);
  });
});
