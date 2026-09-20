import {
  getBillingStatusResponseSchema,
  getMeResponseSchema,
  getProPriceResponseSchema,
  getPushSubscriptionsResponseSchema,
  getRecipeResponseSchema,
  listRecipesResponseSchema,
  listShortcutCredentialsResponseSchema,
  listTagsResponseSchema,
  MAX_RECIPE_NOTE_LENGTH,
  MAX_RECIPE_REFERENCE_IMAGES,
  MAX_RECIPE_SOURCE_NAME_LENGTH,
  MAX_RECIPE_STEP_IMAGES,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_TAGS,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPE_TOTAL_IMAGES,
  recentImportJobsResponseSchema,
} from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import { type ZodType } from "zod";
import { recipeDetailFixture } from "./fixtures";
import { findScenario, scenarios } from "./scenarios";

// 失敗時にどのフィールドがズレたか出るように、issueを露出させて比較する。
const expectValid = (schema: ZodType, value: unknown) => {
  const result = schema.safeParse(value);

  expect(result.error?.issues ?? null).toBeNull();
};

it("シナリオのidが重複していない", () => {
  const ids = scenarios.map((scenario) => scenario.id);

  expect(new Set(ids).size).toBe(ids.length);
});

describe("設定シナリオ", () => {
  it("パスワードとGoogleの両方をログイン方法に持つ", () => {
    expect(
      findScenario("password-and-google")
        .build()
        .loginAccounts.map((account) => account.providerId),
    ).toEqual(["credential", "google"]);
  });

  it("共有に連携している2台を持つ", () => {
    const { credentials } = findScenario("linked-devices").build().shortcutCredentials;

    expect(credentials).toHaveLength(2);
    expect(credentials.map(({ name }) => name)).toEqual(["iPhone", "iPad"]);
  });

  it("ProのAI取り込み上限を持つ", () => {
    const { viewer } = findScenario("pro-import-limit").build();

    expect(viewer.plan).toBe("pro");
    expect(viewer.aiUsage.used).toBe(viewer.aiUsage.limit);
  });

  it("Free上限以内で解約予約中のProを持つ", () => {
    const state = findScenario("pro-canceling-no-lock").build();

    expect(state.viewer).toMatchObject({ plan: "pro", recipeCount: 3 });
    expect(state.recipes).toHaveLength(3);
    expect(state.billing.subscription?.cancelAtPeriodEnd).toBe(true);
  });
});

describe("レシピシナリオ", () => {
  it("本文のバリエーションを1つの一覧から開ける", () => {
    const state = findScenario("content-variants").build();

    expect(state.recipes.map((recipe) => recipe.title)).toEqual([
      "材料だけのレシピ",
      "手順だけのレシピ",
      "メモだけのレシピ",
      "URLだけの出典を持つレシピ",
      "画像URLが欠けたレシピ",
      "タイトルだけのレシピ",
    ]);
    expect(state.recipes.filter((recipe) => recipe.coverImageUrl)).toHaveLength(2);
    expect(state.recipeContents.recipe_006).toMatchObject({
      referenceImages: [],
      ingredientGroups: [],
      steps: [],
    });
    expect(state.recipeContents.recipe_005?.coverImage).not.toHaveProperty("url");
    expect(state.recipeContents.recipe_005?.referenceImages?.[0]).not.toHaveProperty("url");
    expect(state.recipeContents.recipe_005?.steps?.[0]?.images[0]).not.toHaveProperty("url");
  });

  it("長文シナリオは書き込み上限ちょうどの本文と10個のタグを持つ", () => {
    const state = findScenario("long-content").build();
    const [recipe] = state.recipes;
    const content = state.recipeContents[recipe.id];

    expect(recipe.title).toHaveLength(MAX_RECIPE_TITLE_LENGTH);
    expect(recipe.sourceName).toHaveLength(MAX_RECIPE_SOURCE_NAME_LENGTH);
    expect(content.steps?.[0]?.text).toHaveLength(MAX_RECIPE_STEP_TEXT_LENGTH);
    expect(content.note).toHaveLength(MAX_RECIPE_NOTE_LENGTH);
    expect(state.recipeTags[recipe.id]).toHaveLength(MAX_RECIPE_TAGS);
  });

  it("画像上限シナリオはレシピ画像・手順・全体の各境界を持つ", () => {
    const state = findScenario("edit-image-limits").build();
    const [referenceLimit, stepLimit, totalLimit] = state.recipes;
    const referenceContent = state.recipeContents[referenceLimit.id];
    const stepContent = state.recipeContents[stepLimit.id];
    const totalContent = state.recipeContents[totalLimit.id];
    const totalImages =
      (totalContent.referenceImages?.length ?? 0) +
      (totalContent.steps ?? []).reduce((count, step) => count + step.images.length, 0);

    expect(referenceContent.referenceImages).toHaveLength(MAX_RECIPE_REFERENCE_IMAGES);
    expect(stepContent.steps?.[0]?.images).toHaveLength(MAX_RECIPE_STEP_IMAGES);
    expect(totalImages).toBe(MAX_RECIPE_TOTAL_IMAGES);
  });

  it("旧データとタグ上限の境界状態を持つ", () => {
    const legacy = findScenario("legacy-over-limit").build();
    const maxTags = findScenario("max-tags").build();
    const [legacyRecipe] = legacy.recipes;
    const [taggedRecipe] = maxTags.recipes;

    expect(legacy.recipeContents[legacyRecipe.id].steps?.[0]?.text).toHaveLength(
      MAX_RECIPE_STEP_TEXT_LENGTH + 1,
    );
    expect(maxTags.tags).toHaveLength(MAX_RECIPE_TAGS);
    expect(maxTags.recipeTags[taggedRecipe.id]).toHaveLength(MAX_RECIPE_TAGS);
  });
});

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
      const content = { ...fixture.content, ...state.recipeContents[recipe.id] };
      const detail = recipe.locked
        ? { id: recipe.id, locked: true as const }
        : {
            ...fixture,
            title: recipe.title,
            content: {
              ...content,
              title: recipe.title,
              coverImage: recipe.coverImageUrl ? content.coverImage : undefined,
            },
            source: { ...fixture.source, sourceName: recipe.sourceName },
            createdAt: recipe.createdAt,
            updatedAt: recipe.createdAt,
            tags: (state.recipeTags[recipe.id] ?? []).flatMap((tagId) => {
              const tag = state.tags.find((candidate) => candidate.id === tagId);
              return tag ? [tag] : [];
            }),
          };

      expectValid(getRecipeResponseSchema, { recipe: detail });
    }
  });
});
