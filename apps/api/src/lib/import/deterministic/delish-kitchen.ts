import { type RecipeDraftContent } from "@recipestock/schemas";
import { type FetchedImportPage, RecipeImportError } from "../types";
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
  servingsText: string;
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
  servingsText: string;
  ingredients: string[];
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
  id: "delish-kitchen",

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
    const structuredRecipe = extractMatchingJsonLdRecipe(
      extraction.jsonLdDocuments,
      page.finalUrl,
      canonicalUrl,
    );

    if (extraction.canonicalUrl !== canonicalUrl || !structuredRecipe) {
      throw new RecipeImportError(
        "extraction_failed",
        "Delish Kitchen recipe identity could not be verified.",
      );
    }

    const title = normalizeText([extraction.lead, extraction.title].join(" "));
    const ingredientGroups = buildIngredientGroups(extraction.ingredientRows);
    const htmlIngredients = ingredientGroups.flatMap((group) =>
      group.ingredients.map(({ name, amount }) => normalizeText(`${name} ${amount}`)),
    );
    const htmlStepTexts = extraction.steps.map((step) => normalizeText(step.text));
    const structuredStepTexts = structuredRecipe.steps.map((step) => normalizeText(step.text));
    const isPartialImport = extraction.isRestricted && htmlStepTexts.length === 0;

    if (
      !title ||
      htmlIngredients.length === 0 ||
      !arraysEqual(htmlIngredients, structuredRecipe.ingredients.map(normalizeText)) ||
      (!isPartialImport &&
        (htmlStepTexts.length === 0 || !arraysEqual(htmlStepTexts, structuredStepTexts))) ||
      (normalizeServingsText(extraction.servingsText) &&
        normalizeText(structuredRecipe.servingsText) &&
        normalizeServingsText(extraction.servingsText) !==
          normalizeText(structuredRecipe.servingsText))
    ) {
      throw new RecipeImportError(
        "extraction_failed",
        "Delish Kitchen recipe structure could not be extracted.",
      );
    }

    const steps = isPartialImport
      ? []
      : extraction.steps.map((step, index) => {
          const text = buildStepText(step);
          return {
            ...(text ? { text } : {}),
            images: structuredRecipe.steps[index].imageUrls.map((url) => ({
              type: "externalImageUrl" as const,
              url,
            })),
          };
        });
    const coverImageUrl = structuredRecipe.imageUrls[0];
    const note = buildRecipeNote(extraction.attentionItems, isPartialImport);
    const servingsText = normalizeServingsText(extraction.servingsText);

    const recipeDraftContent: RecipeDraftContent = {
      title,
      ...(servingsText ? { servingsText } : {}),
      ...(coverImageUrl
        ? {
            coverImage: {
              type: "externalImageUrl",
              url: coverImageUrl,
            } as const,
          }
        : {}),
      ingredientGroups,
      steps,
      ...(note ? { note } : {}),
    };

    return {
      recipeDraftContent,
      source: {
        sourceUrl: canonicalUrl,
        sourceName: "デリッシュキッチン",
      },
      warnings: [],
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
    servingsText: "",
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
        extraction.canonicalUrl = resolveHttpUrl(element.getAttribute("href"), page.finalUrl);
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
        extraction.servingsText += text.text;
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
      text(text) {
        const capture = stepStack.at(-1);
        if (capture) capture.text += text.text;
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
    .on(".premium-service-section", {
      element() {
        extraction.isRestricted = true;
      },
    })
    .transform(importPageBodyToResponse(page))
    .text();

  return extraction;
};

const extractMatchingJsonLdRecipe = (
  documents: string[],
  baseUrl: string,
  canonicalUrl: string,
): DelishKitchenJsonLdRecipe | undefined => {
  const matches: DelishKitchenJsonLdRecipe[] = [];

  for (const document of documents) {
    try {
      for (const node of collectJsonLdRecipeNodes(JSON.parse(document))) {
        const recipe = normalizeJsonLdRecipe(node, baseUrl);
        if (recipe.canonicalUrl === canonicalUrl) matches.push(recipe);
      }
    } catch {}
  }

  return matches.length === 1 ? matches[0] : undefined;
};

const collectJsonLdRecipeNodes = (value: unknown): Record<string, unknown>[] => {
  const recipes: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;

    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    if (types.some((type) => typeof type === "string" && type.toLowerCase() === "recipe")) {
      recipes.push(node);
    }

    for (const child of Object.values(node)) visit(child);
  };

  visit(value);
  return recipes;
};

const normalizeJsonLdRecipe = (
  recipe: Record<string, unknown>,
  baseUrl: string,
): DelishKitchenJsonLdRecipe => ({
  canonicalUrl: extractJsonLdCanonicalUrl(recipe.mainEntityOfPage, baseUrl),
  servingsText: firstText(recipe.recipeYield),
  ingredients: extractTexts(recipe.recipeIngredient),
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
      const label = normalizeText(row.label);
      currentGroup = {
        ...(label ? { label } : {}),
        ingredients: [],
      };
      continue;
    }

    const name = normalizeText(row.name);
    if (name) {
      currentGroup.ingredients.push({
        name,
        amount: normalizeText(row.amount),
      });
    }
  }

  if (currentGroup.ingredients.length > 0 || currentGroup.label) groups.push(currentGroup);
  return groups.filter((group) => group.ingredients.length > 0);
};

const buildStepText = (step: StepCapture) => {
  const text = normalizeText(step.text);
  const points = step.points.map(normalizeText).filter(Boolean);
  if (points.length === 0) return text;
  return `${text}\n\nポイント: ${points.join("\n")}`;
};

const buildRecipeNote = (items: string[], isPartialImport: boolean) => {
  const normalizedItems = items.map(normalizeText).filter(Boolean);
  const sections = [
    ...(isPartialImport ? [RESTRICTED_RECIPE_NOTE] : []),
    ...(normalizedItems.length > 0 ? [`注意事項:\n${normalizedItems.join("\n")}`] : []),
  ];
  return sections.join("\n\n");
};

const extractTexts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === "string" || typeof item === "number" ? [String(item)] : [],
      )
    : [];

const firstText = (value: unknown) => extractTexts(Array.isArray(value) ? value : [value])[0] ?? "";

const arraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeServingsText = (value: string) =>
  normalizeText(value).replace(/^【/, "").replace(/】$/, "").trim();

const resolveHttpUrl = (rawUrl: string | null, baseUrl: string) => {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const removeCapture = <T>(stack: T[], capture: T) => {
  const index = stack.lastIndexOf(capture);
  if (index >= 0) stack.splice(index, 1);
};

const importPageBodyToResponse = (page: FetchedImportPage) => {
  if (typeof page.body !== "string") return page.body.clone();
  return new Response(page.body, {
    headers: page.contentType ? { "content-type": page.contentType } : undefined,
  });
};
