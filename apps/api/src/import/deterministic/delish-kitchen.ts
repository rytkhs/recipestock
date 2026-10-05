import { type RecipeDraftContent } from "@recipestock/schemas";
import { decodeHtmlText, normalizeTextForComparison } from "../text";
import { type FetchedImportPage, RecipeImportError } from "../types";
import {
  collectJsonLdRecipeNodes,
  getHtmlAttribute,
  importPageBodyToResponse,
  isRecord,
  normalizeHtmlMultilineText,
  normalizeHtmlText,
  removeCapture,
  resolveHttpUrl,
} from "./page";
import {
  type DeterministicImportAdapter,
  type DeterministicImportContext,
  type DeterministicImportMatchInput,
} from "./types";

const DELISH_KITCHEN_HOST = "delishkitchen.tv";
const DELISH_KITCHEN_RECIPE_PATH = /^\/recipes\/([0-9]+)\/?$/;
const DELISH_KITCHEN_RECIPE_PAGE_ID = "recipe";
const RESTRICTED_RECIPE_NOTE =
  "デリッシュキッチンの制限付きレシピのため、手順は取り込まれていません。";
// レシピページで、手順のポイント欄に付くラベルと、注意事項欄の見出し。
const POINT_LABEL = "ポイント";
const ATTENTION_HEADING = "注意事項";

type IngredientRow =
  | {
      type: "group";
      label: string;
    }
  | {
      type: "ingredient";
      name: string;
      amount: string;
    };

type IngredientCapture = {
  name: string;
  amount: string;
};

type StepCapture = {
  text: string;
  points: string[];
};

type DelishKitchenHtmlExtraction = {
  canonicalUrl?: string;
  lead: string;
  title: string;
  yieldText: string;
  ingredientRows: IngredientRow[];
  steps: StepCapture[];
  attentionItems: string[];
  isRestricted: boolean;
  jsonLdDocuments: string[];
};

type DelishKitchenJsonLdStep = {
  text: string;
  imageUrls: string[];
};

type DelishKitchenJsonLdRecipe = {
  canonicalUrl?: string;
  steps: DelishKitchenJsonLdStep[];
  imageUrls: string[];
};

const getDelishKitchenRecipeId = (rawUrl: string) => {
  const url = new URL(rawUrl);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (url.hostname !== DELISH_KITCHEN_HOST && url.hostname !== `www.${DELISH_KITCHEN_HOST}`) ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null;
  }

  return DELISH_KITCHEN_RECIPE_PATH.exec(url.pathname)?.[1] ?? null;
};

const createDelishKitchenRecipeUrl = (recipeId: string) =>
  `https://${DELISH_KITCHEN_HOST}/recipes/${recipeId}`;

export const delishKitchenImportAdapter: DeterministicImportAdapter = {
  sourceName: "デリッシュキッチン",

  match({ normalizedUrl }: DeterministicImportMatchInput) {
    return getDelishKitchenRecipeId(normalizedUrl) !== null;
  },

  resolveFetchRequests({ normalizedUrl }: DeterministicImportMatchInput) {
    const recipeId = getDelishKitchenRecipeId(normalizedUrl);
    if (!recipeId) {
      throw new RecipeImportError("invalid_url", "Delish Kitchen recipe URL is invalid.");
    }

    return [
      {
        id: DELISH_KITCHEN_RECIPE_PAGE_ID,
        url: createDelishKitchenRecipeUrl(recipeId),
      },
    ];
  },

  async convert(context: DeterministicImportContext) {
    const recipeId = getDelishKitchenRecipeId(context.normalizedUrl);
    if (!recipeId) {
      throw new RecipeImportError("invalid_url", "Delish Kitchen recipe URL is invalid.");
    }

    const canonicalUrl = createDelishKitchenRecipeUrl(recipeId);
    const page = requireDelishKitchenPage(context, recipeId);
    const extraction = await extractDelishKitchenRecipe(page);
    const structuredRecipe = findMatchingJsonLdRecipe(
      extraction.jsonLdDocuments,
      page.finalUrl,
      canonicalUrl,
    );

    if (extraction.canonicalUrl !== canonicalUrl) {
      throw new RecipeImportError(
        "extraction_failed",
        "Delish Kitchen recipe identity could not be verified.",
      );
    }

    const title = normalizeHtmlText([extraction.lead, extraction.title].join(" "));
    const ingredientGroups = buildIngredientGroups(extraction.ingredientRows);
    const steps = extraction.steps.flatMap((step, index) => {
      const text = normalizeHtmlMultilineText(step.text);
      const points = step.points.map(normalizeHtmlMultilineText).filter(Boolean);
      const structuredStep = structuredRecipe?.steps[index];
      const imageUrls =
        structuredStep &&
        normalizeTextForComparison(decodeHtmlText(step.text)) ===
          normalizeTextForComparison(structuredStep.text)
          ? structuredStep.imageUrls
          : [];
      if (!text && points.length === 0 && imageUrls.length === 0) return [];
      return [
        {
          ...(text ? { text } : {}),
          supplements: [{ heading: POINT_LABEL, body: points.join("\n") }],
          imageUrls,
        },
      ];
    });
    // 制限付きレシピは、ページに材料は出ても手順が出ないことがある。読める材料だけで取り込み、
    // 手順がないことをnoteの先頭で伝える。
    const isPartialImport = extraction.isRestricted && steps.length === 0;

    if (
      !title ||
      ingredientGroups.every((group) => group.ingredients.length === 0) ||
      (!isPartialImport && steps.length === 0)
    ) {
      throw new RecipeImportError(
        "extraction_failed",
        "Delish Kitchen recipe structure could not be extracted.",
      );
    }
    const coverImageUrl = structuredRecipe?.imageUrls[0];
    const attentionItems = extraction.attentionItems
      .map(normalizeHtmlMultilineText)
      .filter(Boolean);
    const yieldText = normalizeYieldText(extraction.yieldText);

    return {
      draftContent: {
        title,
        ...(yieldText ? { yieldText } : {}),
        ...(coverImageUrl ? { coverImageUrl } : {}),
        ingredientGroups,
        steps,
        ...(isPartialImport ? { notice: RESTRICTED_RECIPE_NOTE } : {}),
        noteSections: [{ heading: ATTENTION_HEADING, body: attentionItems.join("\n") }],
      },
      sourceUrl: canonicalUrl,
    };
  },
};

const requireDelishKitchenPage = (
  context: DeterministicImportContext,
  recipeId: string,
): FetchedImportPage => {
  const page = context.pages.get(DELISH_KITCHEN_RECIPE_PAGE_ID);
  if (!page || getDelishKitchenRecipeId(page.finalUrl) !== recipeId) {
    throw new RecipeImportError(
      "extraction_failed",
      "Delish Kitchen fetched page did not match the requested recipe.",
    );
  }

  return page;
};

const extractDelishKitchenRecipe = async (
  page: FetchedImportPage,
): Promise<DelishKitchenHtmlExtraction> => {
  const extraction: DelishKitchenHtmlExtraction = {
    lead: "",
    title: "",
    yieldText: "",
    ingredientRows: [],
    steps: [],
    attentionItems: [],
    isRestricted: false,
    jsonLdDocuments: [],
  };
  const groupStack: string[] = [];
  const ingredientStack: IngredientCapture[] = [];
  const stepStack: StepCapture[] = [];
  const pointStack: string[] = [];
  const attentionStack: string[] = [];
  const jsonLdStack: string[] = [];

  await new HTMLRewriter()
    .on('link[rel="canonical"]', {
      element(element) {
        extraction.canonicalUrl = resolveHttpUrl(getHtmlAttribute(element, "href"), page.finalUrl);
      },
    })
    .on('script[type="application/ld+json"]', {
      element(element) {
        jsonLdStack.push("");
        element.onEndTag(() => {
          const document = jsonLdStack.pop();
          if (document) extraction.jsonLdDocuments.push(document);
        });
      },
      text(text) {
        const index = jsonLdStack.length - 1;
        if (index >= 0) jsonLdStack[index] += text.text;
      },
    })
    .on(".recipe-content__main .title-box .lead", {
      text(text) {
        extraction.lead += text.text;
      },
    })
    .on(".recipe-content__main .title-box .title", {
      text(text) {
        extraction.title += text.text;
      },
    })
    .on(".delish-recipe-ingredients .recipe-serving > span", {
      text(text) {
        extraction.yieldText += text.text;
      },
    })
    .on(".delish-recipe-ingredients .ingredient-list > li.ingredient-group__header", {
      element(element) {
        groupStack.push("");
        element.onEndTag(() => {
          const label = groupStack.pop() ?? "";
          extraction.ingredientRows.push({ type: "group", label });
        });
      },
      text(text) {
        const index = groupStack.length - 1;
        if (index >= 0) groupStack[index] += text.text;
      },
    })
    .on(".delish-recipe-ingredients .ingredient-list > li.ingredient", {
      element(element) {
        const capture: IngredientCapture = { name: "", amount: "" };
        ingredientStack.push(capture);
        element.onEndTag(() => {
          extraction.ingredientRows.push({
            type: "ingredient",
            name: capture.name,
            amount: capture.amount,
          });
          removeCapture(ingredientStack, capture);
        });
      },
    })
    .on(".delish-recipe-ingredients .ingredient-name", {
      text(text) {
        const capture = ingredientStack.at(-1);
        if (capture) capture.name += text.text;
      },
    })
    .on(".delish-recipe-ingredients .ingredient-serving", {
      text(text) {
        const capture = ingredientStack.at(-1);
        if (capture) capture.amount += text.text;
      },
    })
    .on(".delish-recipe-steps .steps > li.step", {
      element(element) {
        const capture: StepCapture = { text: "", points: [] };
        stepStack.push(capture);
        element.onEndTag(() => {
          extraction.steps.push(capture);
          removeCapture(stepStack, capture);
        });
      },
    })
    .on(".delish-recipe-steps .step-desc", {
      element() {
        const capture = stepStack.at(-1);
        if (capture?.text) capture.text += "\n";
      },
      text(text) {
        const capture = stepStack.at(-1);
        if (capture) capture.text += text.text;
      },
    })
    .on(".delish-recipe-steps .step-desc br", {
      element() {
        const capture = stepStack.at(-1);
        if (capture) capture.text += "\n";
      },
    })
    .on(".delish-recipe-steps .point", {
      element(element) {
        pointStack.push("");
        element.onEndTag(() => {
          const point = pointStack.pop() ?? "";
          const step = stepStack.at(-1);
          if (step) step.points.push(point);
        });
      },
      text(text) {
        const index = pointStack.length - 1;
        if (index >= 0) pointStack[index] += text.text;
      },
    })
    .on(".delish-recipe-steps .point br", {
      element() {
        const index = pointStack.length - 1;
        if (index >= 0) pointStack[index] += "\n";
      },
    })
    .on(".delish-recipe-attention .attention-item-wrap p", {
      element(element) {
        attentionStack.push("");
        element.onEndTag(() => {
          const item = attentionStack.pop() ?? "";
          extraction.attentionItems.push(item);
        });
      },
      text(text) {
        const index = attentionStack.length - 1;
        if (index >= 0) attentionStack[index] += text.text;
      },
    })
    .on(".delish-recipe-attention .attention-item-wrap p br", {
      element() {
        const index = attentionStack.length - 1;
        if (index >= 0) attentionStack[index] += "\n";
      },
    })
    .on(".premium-service-section", {
      element() {
        extraction.isRestricted = true;
      },
    })
    .transform(importPageBodyToResponse(page))
    .text();

  return extraction;
};

const findMatchingJsonLdRecipe = (
  documents: string[],
  baseUrl: string,
  canonicalUrl: string,
): DelishKitchenJsonLdRecipe | undefined => {
  for (const document of documents) {
    try {
      for (const node of collectJsonLdRecipeNodes(JSON.parse(document))) {
        const recipe = normalizeJsonLdRecipe(node, baseUrl);
        if (recipe.canonicalUrl === canonicalUrl) return recipe;
      }
    } catch {}
  }

  return undefined;
};

const normalizeJsonLdRecipe = (
  recipe: Record<string, unknown>,
  baseUrl: string,
): DelishKitchenJsonLdRecipe => ({
  canonicalUrl: extractJsonLdCanonicalUrl(recipe.mainEntityOfPage, baseUrl),
  steps: extractJsonLdSteps(recipe.recipeInstructions, baseUrl),
  imageUrls: extractJsonLdImageUrls(recipe.image, baseUrl),
});

const extractJsonLdCanonicalUrl = (value: unknown, baseUrl: string) => {
  if (typeof value === "string") return resolveHttpUrl(value, baseUrl);
  if (!isRecord(value)) return undefined;
  return resolveHttpUrl(
    typeof value["@id"] === "string"
      ? value["@id"]
      : typeof value.url === "string"
        ? value.url
        : null,
    baseUrl,
  );
};

const extractJsonLdSteps = (value: unknown, baseUrl: string): DelishKitchenJsonLdStep[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((step) => {
    if (!isRecord(step)) return [];
    const text = firstText(step.text);
    if (!text) return [];
    return [
      {
        text,
        imageUrls: extractJsonLdImageUrls(step.image, baseUrl),
      },
    ];
  });
};

const extractJsonLdImageUrls = (value: unknown, baseUrl: string): string[] => {
  const urls: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const url = resolveHttpUrl(node, baseUrl);
      if (url && !urls.includes(url)) urls.push(url);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    visit(node.url);
    visit(node.contentUrl);
  };

  visit(value);
  return urls;
};

const buildIngredientGroups = (rows: IngredientRow[]): RecipeDraftContent["ingredientGroups"] => {
  const groups: RecipeDraftContent["ingredientGroups"] = [];
  let currentGroup: RecipeDraftContent["ingredientGroups"][number] = {
    ingredients: [],
  };

  for (const row of rows) {
    if (row.type === "group") {
      if (currentGroup.ingredients.length > 0 || currentGroup.label) groups.push(currentGroup);
      const label = normalizeHtmlText(row.label);
      currentGroup = {
        ...(label ? { label } : {}),
        ingredients: [],
      };
      continue;
    }

    const name = normalizeHtmlText(row.name);
    if (name) {
      currentGroup.ingredients.push({
        name,
        amount: normalizeHtmlText(row.amount),
      });
    }
  }

  if (currentGroup.ingredients.length > 0 || currentGroup.label) groups.push(currentGroup);
  return groups;
};

const extractTexts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === "string" || typeof item === "number" ? [String(item)] : [],
      )
    : [];

const firstText = (value: unknown) => extractTexts(Array.isArray(value) ? value : [value])[0] ?? "";

const normalizeYieldText = (value: string) =>
  normalizeHtmlText(value).replace(/^【/, "").replace(/】$/, "").trim();
