import {
  getBillingStatusResponseSchema,
  getMeResponseSchema,
  getPushSubscriptionsResponseSchema,
  getRecipeResponseSchema,
  listRecipesResponseSchema,
  listShortcutCredentialsResponseSchema,
  recentImportJobsResponseSchema,
} from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { type ZodType } from "zod";
import { recipeDetailFixture } from "./fixtures";
import { scenarios } from "./scenarios";

// 失敗時にどのフィールドがズレたか出るように、issueを露出させて比較する。
const expectValid = (schema: ZodType, value: unknown) => {
  const result = schema.safeParse(value);

  expect(result.error?.issues ?? null).toBeNull();
};

// モックのフィクスチャがAPI契約から外れたら、dev:mockを起動しなくてもここで落ちる。
describe.each(
  scenarios.map((scenario) => [scenario.id, scenario] as const),
)("シナリオ %s", (_id, scenario) => {
  const state = scenario.build();

  it("viewerがGetMeResponseの形をしている", () => {
    expectValid(getMeResponseSchema, state.viewer);
  });

  it("billingがGetBillingStatusResponseの形をしている", () => {
    expectValid(getBillingStatusResponseSchema, state.billing);
  });

  it("recipesがListRecipesResponseの形をしている", () => {
    expectValid(listRecipesResponseSchema, { items: state.recipes, nextCursor: null });
  });

  it("importJobsがRecentImportJobsResponseの形をしている", () => {
    expectValid(recentImportJobsResponseSchema, { jobs: state.importJobs });
  });

  it("pushSubscriptionsがGetPushSubscriptionsResponseの形をしている", () => {
    expectValid(getPushSubscriptionsResponseSchema, state.pushSubscriptions);
  });

  it("shortcutCredentialsがListShortcutCredentialsResponseの形をしている", () => {
    expectValid(listShortcutCredentialsResponseSchema, state.shortcutCredentials);
  });

  it("各Recipeの詳細がGetRecipeResponseの形をしている", () => {
    for (const recipe of state.recipes) {
      const detail = recipe.locked
        ? { id: recipe.id, locked: true as const }
        : recipeDetailFixture(recipe.id);

      expectValid(getRecipeResponseSchema, { recipe: detail });
    }
  });
});
