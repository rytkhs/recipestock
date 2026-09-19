import {
  getBillingStatusResponseSchema,
  getMeResponseSchema,
  getProPriceResponseSchema,
  getPushSubscriptionsResponseSchema,
  getRecipeResponseSchema,
  listRecipesResponseSchema,
  listShortcutCredentialsResponseSchema,
  listTagsResponseSchema,
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

  it("proPriceがGetProPriceResponseの形をしている", () => {
    expectValid(getProPriceResponseSchema, state.proPrice);
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

  it("tagsがListTagsResponseのタグの形をしている", () => {
    expectValid(listTagsResponseSchema, {
      tags: state.tags.map((tag) => ({ ...tag, recipeCount: 0 })),
    });
  });

  it("recipeTagsは一覧にあるRecipeと、語彙にあるタグだけを指している", () => {
    const recipeIds = new Set(state.recipes.map((recipe) => recipe.id));
    const tagIds = new Set(state.tags.map((tag) => tag.id));

    for (const [recipeId, attachedTagIds] of Object.entries(state.recipeTags)) {
      expect(recipeIds.has(recipeId)).toBe(true);
      expect(attachedTagIds.filter((tagId) => !tagIds.has(tagId))).toEqual([]);
    }
  });

  it("importJobSourceTextsはテキストの取り込みjobだけを指している", () => {
    for (const jobId of Object.keys(state.importJobSourceTexts)) {
      expect(state.importJobs.find((job) => job.id === jobId)?.kind).toBe("text");
    }
  });

  it("recipeContentsは一覧にあるRecipeだけを指している", () => {
    const recipeIds = new Set(state.recipes.map((recipe) => recipe.id));

    expect(
      Object.keys(state.recipeContents).filter((recipeId) => !recipeIds.has(recipeId)),
    ).toEqual([]);
  });

  it("各Recipeの詳細がGetRecipeResponseの形をしている", () => {
    for (const recipe of state.recipes) {
      const fixture = recipeDetailFixture(recipe.id);
      const detail = recipe.locked
        ? { id: recipe.id, locked: true as const }
        : { ...fixture, content: { ...fixture.content, ...state.recipeContents[recipe.id] } };

      expectValid(getRecipeResponseSchema, { recipe: detail });
    }
  });
});
