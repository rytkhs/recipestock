import {
  apiErrorResponseSchema,
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
import { getResponse } from "msw";
import { expect, it } from "vitest";
import { type ZodType } from "zod";
import { createHandlers } from "./handlers";
import { scenarios } from "./scenarios";

it("シナリオのidが重複していない", () => {
  const ids = scenarios.map(({ id }) => id);
  expect(new Set(ids).size).toBe(ids.length);
});

// dev:mockが実際に返すJSONを検証し、詳細responseの組み立てをテスト側に複製しない。
it.each(scenarios)("$id: API契約とフィクスチャの参照関係を満たす", async (scenario) => {
  const state = scenario.build();
  const handlers = createHandlers(state, { delayMs: 0 });
  const requests: [string, ZodType][] = [
    ["/api/me", getMeResponseSchema],
    ["/api/billing/status", getBillingStatusResponseSchema],
    ["/api/billing/pro-price", getProPriceResponseSchema],
    ["/api/recipes", listRecipesResponseSchema],
    ["/api/tags", listTagsResponseSchema],
    ["/api/import/jobs/recent", recentImportJobsResponseSchema],
    ["/api/push-subscriptions", getPushSubscriptionsResponseSchema],
    ["/api/shortcut-credentials", listShortcutCredentialsResponseSchema],
    ...state.recipes.map(({ id }): [string, ZodType] => [
      `/api/recipes/${id}`,
      getRecipeResponseSchema,
    ]),
  ];
  for (const [path, schema] of requests) {
    const response = await getResponse(
      handlers,
      new Request(new URL(path, window.location.origin)),
    );
    if (!response) throw new Error(`No mock response for ${path}`);
    const result = (response.ok ? schema : apiErrorResponseSchema).safeParse(await response.json());
    expect(result.error?.issues ?? null, path).toBeNull();
  }

  const recipeIds = new Set(state.recipes.map(({ id }) => id));
  const tagIds = new Set(state.tags.map(({ id }) => id));
  expect(Object.keys(state.recipeContents).filter((id) => !recipeIds.has(id))).toEqual([]);
  for (const [recipeId, attachedTagIds] of Object.entries(state.recipeTags)) {
    expect(recipeIds.has(recipeId), recipeId).toBe(true);
    expect(attachedTagIds.filter((id) => !tagIds.has(id))).toEqual([]);
  }
  for (const jobId of Object.keys(state.importJobSourceTexts)) {
    expect(state.importJobs.find(({ id }) => id === jobId)?.kind, jobId).toBe("text");
  }
});
