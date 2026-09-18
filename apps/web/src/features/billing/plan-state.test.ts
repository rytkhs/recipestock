import { type GetBillingStatusResponse } from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { billingStatusFixture, viewerFixture } from "../../mocks/fixtures";
import {
  derivePlanState,
  isResolvedByUpgrade,
  isStillResolvedByUpgrade,
  planRowValue,
} from "./plan-state";

const proBilling = (
  subscription: Partial<NonNullable<GetBillingStatusResponse["subscription"]>> = {},
) =>
  billingStatusFixture({
    plan: "pro",
    subscription: {
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: "2026-10-07T15:00:00.000Z",
      cancelAt: null,
      ...subscription,
    },
  });

const freeViewer = (recipeCount: number, used = 0) =>
  viewerFixture({
    plan: "free",
    recipeCount,
    aiUsage: {
      month: "2026-09",
      used,
      limit: 10,
      resetAt: "2026-09-30T15:00:00.000Z",
    },
  });

const proViewer = (used = 0) =>
  viewerFixture({
    plan: "pro",
    recipeCount: 128,
    aiUsage: {
      month: "2026-09",
      used,
      limit: 300,
      resetAt: "2026-09-30T15:00:00.000Z",
    },
  });

describe("derivePlanState", () => {
  it.each([
    { recipeCount: 3, savedRecipes: "room", lockedCount: 0 },
    { recipeCount: 5, savedRecipes: "full", lockedCount: 0 },
    { recipeCount: 12, savedRecipes: "locked", lockedCount: 7 },
  ])("Freeで$recipeCount件なら$savedRecipes", ({ recipeCount, savedRecipes, lockedCount }) => {
    expect(derivePlanState(freeViewer(recipeCount))).toMatchObject({
      plan: "free",
      recipeLimit: 5,
      savedRecipes,
      lockedCount,
      contract: null,
    });
  });

  it("取り込みの回数が上限に届いたら上限と戻る日を持つ", () => {
    expect(derivePlanState(freeViewer(1, 10))).toMatchObject({
      importLimit: 10,
      importLimitReached: true,
      importResetAt: "2026-09-30T15:00:00.000Z",
    });
    expect(derivePlanState(freeViewer(1, 9)).importLimitReached).toBe(false);
  });

  it("Proは保存件数に上限がなく、契約の状態を持つ", () => {
    expect(derivePlanState(proViewer(), proBilling())).toMatchObject({
      plan: "pro",
      savedRecipes: "unlimited",
      lockedCount: 0,
      contract: { kind: "renewing", renewsAt: "2026-10-07T15:00:00.000Z" },
    });
  });

  it("解約を予約していれば、終わる日を持つ", () => {
    expect(derivePlanState(proViewer(), proBilling({ cancelAtPeriodEnd: true })).contract).toEqual({
      kind: "ending",
      endsAt: "2026-10-07T15:00:00.000Z",
    });
    expect(
      derivePlanState(proViewer(), proBilling({ cancelAt: "2026-10-01T15:00:00.000Z" })).contract,
    ).toEqual({ kind: "ending", endsAt: "2026-10-01T15:00:00.000Z" });
  });

  it("支払いが遅れていれば、解約の予約より先にそれを持つ", () => {
    expect(
      derivePlanState(proViewer(), proBilling({ status: "past_due", cancelAtPeriodEnd: true }))
        .contract,
    ).toEqual({ kind: "payment_failed" });
  });

  it("契約の状態を読めていなければ、契約を持たない", () => {
    expect(derivePlanState(proViewer()).contract).toBeNull();
  });

  it("Freeなら、課金の状態に古い契約が残っていても契約を持たない", () => {
    expect(derivePlanState(freeViewer(3), proBilling({ status: "canceled" })).contract).toBeNull();
  });
});

describe("planRowValue", () => {
  it.each([
    {
      name: "空きあり",
      state: derivePlanState(freeViewer(3)),
      text: "Free · 3/5件",
      tone: "muted",
    },
    { name: "上限", state: derivePlanState(freeViewer(5)), text: "Free · 5/5件", tone: "warning" },
    {
      name: "ロック中",
      state: derivePlanState(freeViewer(12)),
      text: "Free · 7件ロック中",
      tone: "warning",
    },
    {
      name: "ロック中で取り込みも上限",
      state: derivePlanState(freeViewer(12, 10)),
      text: "Free · 7件ロック中",
      tone: "warning",
    },
    {
      name: "取り込みが上限",
      state: derivePlanState(freeViewer(3, 10)),
      text: "Free · AI取り込み上限",
      tone: "warning",
    },
    { name: "Pro", state: derivePlanState(proViewer(), proBilling()), text: "Pro", tone: "muted" },
    {
      name: "Proで契約を読めない",
      state: derivePlanState(proViewer()),
      text: "Pro",
      tone: "muted",
    },
    {
      name: "Proで解約予約中",
      state: derivePlanState(proViewer(), proBilling({ cancelAtPeriodEnd: true })),
      text: "Pro · 10月8日まで",
      tone: "muted",
    },
    {
      name: "Proで終わる日が分からない解約予約",
      state: derivePlanState(
        proViewer(),
        proBilling({ cancelAtPeriodEnd: true, currentPeriodEnd: null }),
      ),
      text: "Pro · 解約予約中",
      tone: "muted",
    },
    {
      name: "Proで取り込みが上限",
      state: derivePlanState(proViewer(300), proBilling({ cancelAtPeriodEnd: true })),
      text: "Pro · AI取り込み上限",
      tone: "warning",
    },
    {
      name: "Proで支払いを確認できない",
      state: derivePlanState(proViewer(300), proBilling({ status: "past_due" })),
      text: "支払いを確認できません",
      tone: "warning",
    },
  ])("$nameなら「$text」", ({ state, text, tone }) => {
    expect(planRowValue(state)).toEqual({ text, tone });
  });
});

describe("isResolvedByUpgrade", () => {
  it("保存件数の上限は、プランを変えれば直る", () => {
    expect(isResolvedByUpgrade("recipe_limit_exceeded", "free")).toBe(true);
  });

  it("取り込みの回数の上限は、Freeのときだけプランを変えれば直る", () => {
    expect(isResolvedByUpgrade("ai_usage_limit_exceeded", "free")).toBe(true);
    expect(isResolvedByUpgrade("ai_usage_limit_exceeded", "pro")).toBe(false);
    expect(isResolvedByUpgrade("ai_usage_limit_exceeded", undefined)).toBe(false);
  });

  it("上限でないエラーには当てはまらない", () => {
    expect(isResolvedByUpgrade("fetch_failed", "free")).toBe(false);
    expect(isResolvedByUpgrade(null, "free")).toBe(false);
  });
});

describe("isStillResolvedByUpgrade", () => {
  it("Freeで今も保存件数の上限にいれば、プランを変えなければ直らない", () => {
    expect(isStillResolvedByUpgrade("recipe_limit_exceeded", derivePlanState(freeViewer(5)))).toBe(
      true,
    );
    expect(isStillResolvedByUpgrade("recipe_limit_exceeded", derivePlanState(freeViewer(6)))).toBe(
      true,
    );
  });

  it("レシピを消して枠が空いていれば、再試行で直る", () => {
    expect(isStillResolvedByUpgrade("recipe_limit_exceeded", derivePlanState(freeViewer(4)))).toBe(
      false,
    );
  });

  it("Freeで今もAI取り込みの上限にいれば、プランを変えなければ直らない", () => {
    expect(
      isStillResolvedByUpgrade("ai_usage_limit_exceeded", derivePlanState(freeViewer(0, 10))),
    ).toBe(true);
  });

  it("月が替わって回数が戻っていれば、再試行で直る", () => {
    expect(
      isStillResolvedByUpgrade("ai_usage_limit_exceeded", derivePlanState(freeViewer(0, 0))),
    ).toBe(false);
  });

  it("Proにしたあとは、どちらの上限も再試行で直る", () => {
    const state = derivePlanState(proViewer());
    expect(isStillResolvedByUpgrade("recipe_limit_exceeded", state)).toBe(false);
    expect(isStillResolvedByUpgrade("ai_usage_limit_exceeded", state)).toBe(false);
  });

  it("今の状態が分からなければ、再試行を隠さない", () => {
    expect(isStillResolvedByUpgrade("recipe_limit_exceeded", undefined)).toBe(false);
  });
});
