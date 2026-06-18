import { type RecipeDraftContent } from "@recipestock/schemas";
import { RecipeImportError } from "../types";
import {
  type DeterministicImportAdapter,
  type DeterministicImportContext,
  type DeterministicImportMatchInput,
} from "./types";

const COOKPAD_HOST = "cookpad.com";
const COOKPAD_RECIPE_PATH = /^\/jp\/recipes\/(\d+)(?:\/print)?\/?$/;

type IngredientCapture = {
  isHeadline: boolean;
  name: string;
  amount: string;
};

type StepCapture = {
  text: string;
  imageUrls: string[];
};

type CookpadExtraction = {
  title: string;
  coverImageUrl?: string;
  servingsText: string;
  ingredientRows: IngredientCapture[];
  note: string;
  steps: StepCapture[];
};

type HtmlRewriterElement = Parameters<
  NonNullable<HTMLRewriterElementContentHandlers["element"]>
>[0];

const getCookpadRecipeId = (normalizedUrl: string) => {
  const url = new URL(normalizedUrl);
  if (url.hostname.replace(/^www\./, "") !== COOKPAD_HOST) return null;
  return COOKPAD_RECIPE_PATH.exec(url.pathname)?.[1] ?? null;
};

const createCookpadUrl = (recipeId: string, print: boolean) =>
  `https://${COOKPAD_HOST}/jp/recipes/${recipeId}${print ? "/print" : ""}`;

export const cookpadImportAdapter: DeterministicImportAdapter = {
  id: "cookpad",

  match({ normalizedUrl }: DeterministicImportMatchInput) {
    return getCookpadRecipeId(normalizedUrl) !== null;
  },

  resolveFetchUrl({ normalizedUrl }: DeterministicImportMatchInput) {
    const recipeId = getCookpadRecipeId(normalizedUrl);
    if (!recipeId) {
      throw new RecipeImportError("invalid_url", "Cookpad recipe URL is invalid.");
    }

    return createCookpadUrl(recipeId, true);
  },

  async convert(context: DeterministicImportContext) {
    const recipeId = getCookpadRecipeId(context.normalizedUrl);
    if (!recipeId) {
      throw new RecipeImportError("invalid_url", "Cookpad recipe URL is invalid.");
    }

    const extraction = await extractCookpadPrintRecipe(context);
    const ingredientGroups = buildIngredientGroups(extraction.ingredientRows);
    const steps = extraction.steps
      .map((step) => ({
        text: normalizeText(step.text) || undefined,
        images: step.imageUrls.map((url) => ({
          type: "externalImageUrl" as const,
          url,
        })),
      }))
      .filter((step) => step.text || step.images.length > 0);
    const title = normalizeText(extraction.title);

    if (
      !title ||
      ingredientGroups.every((group) => group.ingredients.length === 0) ||
      steps.length === 0
    ) {
      throw new RecipeImportError(
        "extraction_failed",
        "Cookpad recipe structure could not be extracted.",
      );
    }

    const recipeDraftContent: RecipeDraftContent = {
      title,
      ...(normalizeText(extraction.servingsText)
        ? { servingsText: normalizeText(extraction.servingsText) }
        : {}),
      ...(extraction.coverImageUrl
        ? {
            coverImage: {
              type: "externalImageUrl",
              url: extraction.coverImageUrl,
            } as const,
          }
        : {}),
      ingredientGroups,
      steps,
      ...(normalizeText(extraction.note) ? { note: normalizeText(extraction.note) } : {}),
    };

    return {
      recipeDraftContent,
      source: {
        sourceUrl: createCookpadUrl(recipeId, false),
        sourceName: "クックパッド",
      },
      warnings: [],
    };
  },
};

const extractCookpadPrintRecipe = async (
  context: DeterministicImportContext,
): Promise<CookpadExtraction> => {
  const extraction: CookpadExtraction = {
    title: "",
    servingsText: "",
    ingredientRows: [],
    note: "",
    steps: [],
  };
  const ingredientStack: IngredientCapture[] = [];
  const stepStack: StepCapture[] = [];
  let recipeRootFound = false;

  await new HTMLRewriter()
    .on("#recipe-print", {
      element() {
        recipeRootFound = true;
      },
    })
    .on('#recipe-print header span[dir="auto"]', {
      text(text) {
        extraction.title += text.text;
      },
    })
    .on("#recipe-print img.aspect-square", {
      element(element) {
        if (extraction.coverImageUrl) return;
        extraction.coverImageUrl = resolveImageUrl(element.getAttribute("src"), context.finalUrl);
      },
    })
    .on("#recipe-print .mise-icon-text", {
      text(text) {
        extraction.servingsText += text.text;
      },
    })
    .on("#recipe-print li.justified-quantity-and-name", {
      element(element) {
        const capture: IngredientCapture = {
          isHeadline: hasClass(element, "headline"),
          name: "",
          amount: "",
        };
        ingredientStack.push(capture);
        element.onEndTag(() => {
          extraction.ingredientRows.push(capture);
          removeCapture(ingredientStack, capture);
        });
      },
    })
    .on("#recipe-print li.justified-quantity-and-name span", {
      text(text) {
        const capture = ingredientStack.at(-1);
        if (capture) capture.name += text.text;
      },
    })
    .on("#recipe-print li.justified-quantity-and-name bdi", {
      text(text) {
        const capture = ingredientStack.at(-1);
        if (capture) capture.amount += text.text;
      },
    })
    .on("#recipe-print div.mb-rg p", {
      text(text) {
        extraction.note += text.text;
      },
    })
    .on("#recipe-print ol.grid > li", {
      element(element) {
        const capture: StepCapture = { text: "", imageUrls: [] };
        stepStack.push(capture);
        element.onEndTag(() => {
          extraction.steps.push(capture);
          removeCapture(stepStack, capture);
        });
      },
    })
    .on("#recipe-print ol.grid > li p", {
      text(text) {
        const capture = stepStack.at(-1);
        if (capture) capture.text += text.text;
      },
    })
    .on("#recipe-print ol.grid > li img", {
      element(element) {
        const capture = stepStack.at(-1);
        const url = resolveImageUrl(element.getAttribute("src"), context.finalUrl);
        if (capture && url) capture.imageUrls.push(url);
      },
    })
    .transform(importPageBodyToResponse(context.page))
    .text();

  if (!recipeRootFound) {
    throw new RecipeImportError("extraction_failed", "Cookpad print recipe container was missing.");
  }

  return extraction;
};

const buildIngredientGroups = (rows: IngredientCapture[]) => {
  const groups: RecipeDraftContent["ingredientGroups"] = [];
  let currentGroup: RecipeDraftContent["ingredientGroups"][number] = {
    ingredients: [],
  };

  for (const row of rows) {
    const name = normalizeText(row.name);
    if (row.isHeadline) {
      if (currentGroup.ingredients.length > 0 || currentGroup.label) {
        groups.push(currentGroup);
      }
      currentGroup = {
        ...(normalizeHeadline(name) ? { label: normalizeHeadline(name) } : {}),
        ingredients: [],
      };
      continue;
    }

    if (name) {
      currentGroup.ingredients.push({
        name,
        amount: normalizeText(row.amount),
      });
    }
  }

  if (currentGroup.ingredients.length > 0 || currentGroup.label) {
    groups.push(currentGroup);
  }

  return groups;
};

const normalizeHeadline = (value: string) => value.replace(/^■\s*/, "").trim();

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const hasClass = (element: HtmlRewriterElement, className: string) =>
  element
    .getAttribute("class")
    ?.split(/\s+/)
    .some((value) => value === className) ?? false;

const resolveImageUrl = (rawUrl: string | null, baseUrl: string) => {
  if (!rawUrl) return undefined;

  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return undefined;
  }
};

const removeCapture = <T>(stack: T[], capture: T) => {
  const index = stack.lastIndexOf(capture);
  if (index >= 0) stack.splice(index, 1);
};

const importPageBodyToResponse = (page: DeterministicImportContext["page"]) => {
  if (typeof page.body !== "string") return page.body.clone();

  return new Response(page.body, {
    headers: page.contentType ? { "content-type": page.contentType } : undefined,
  });
};
