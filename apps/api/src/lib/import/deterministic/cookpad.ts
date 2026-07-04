import { type RecipeDraftContent } from "@recipestock/schemas";
import { type FetchedImportPage, RecipeImportError } from "../types";
import {
  type DeterministicImportAdapter,
  type DeterministicImportContext,
  type DeterministicImportMatchInput,
} from "./types";

const COOKPAD_HOST = "cookpad.com";
const COOKPAD_RECIPE_PATH = /^\/jp\/recipes\/(\d+)(?:\/print)?\/?$/;
const COOKPAD_PRINT_PAGE_ID = "print";
const COOKPAD_RECIPE_PAGE_ID = "recipe";

type IngredientCapture = {
  isHeadline: boolean;
  name: string;
  amount: string;
};

type PrintStepCapture = {
  text: string;
  imageUrls: string[];
};

type CookpadPrintExtraction = {
  title: string;
  yieldText: string;
  ingredientRows: IngredientCapture[];
  note: string;
  steps: PrintStepCapture[];
};

type ImageCandidate = {
  url: string;
  area: number;
  isQuality80: boolean;
  position: number;
};

type ImageCapture = {
  candidates: ImageCandidate[];
};

type RecipeStepCapture = {
  id: string;
  text: string;
  imageUrls: string[];
};

type CookpadRecipeExtraction = {
  isPremium: boolean;
  title: string;
  coverImageUrl?: string;
  steps: RecipeStepCapture[];
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

  resolveFetchRequests({ normalizedUrl }: DeterministicImportMatchInput) {
    const recipeId = getCookpadRecipeId(normalizedUrl);
    if (!recipeId) {
      throw new RecipeImportError("invalid_url", "Cookpad recipe URL is invalid.");
    }

    return [
      {
        id: COOKPAD_PRINT_PAGE_ID,
        url: createCookpadUrl(recipeId, true),
      },
      {
        id: COOKPAD_RECIPE_PAGE_ID,
        url: createCookpadUrl(recipeId, false),
      },
    ];
  },

  async convert(context: DeterministicImportContext) {
    const recipeId = getCookpadRecipeId(context.normalizedUrl);
    if (!recipeId) {
      throw new RecipeImportError("invalid_url", "Cookpad recipe URL is invalid.");
    }

    const printPage = requireCookpadPage(context, COOKPAD_PRINT_PAGE_ID, recipeId);
    const recipePage = requireCookpadPage(context, COOKPAD_RECIPE_PAGE_ID, recipeId);
    const [printExtraction, recipeExtraction] = await Promise.all([
      extractCookpadPrintRecipe(printPage),
      extractCookpadRecipePage(recipePage),
    ]);

    assertCookpadExtractionsMatch(printExtraction, recipeExtraction);

    const ingredientGroups = buildIngredientGroups(printExtraction.ingredientRows);
    const title = normalizeText(printExtraction.title);
    const steps = printExtraction.steps.map((step, index) => ({
      ...(normalizeText(step.text) ? { text: normalizeText(step.text) } : {}),
      images: (recipeExtraction.isPremium
        ? step.imageUrls
        : recipeExtraction.steps[index].imageUrls
      ).map((url) => ({
        type: "externalImageUrl" as const,
        url,
      })),
    }));

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
      ...(normalizeText(printExtraction.yieldText)
        ? { yieldText: normalizeText(printExtraction.yieldText) }
        : {}),
      ...(recipeExtraction.coverImageUrl
        ? {
            coverImage: {
              type: "externalImageUrl",
              url: recipeExtraction.coverImageUrl,
            } as const,
          }
        : {}),
      referenceImages: [],
      ingredientGroups,
      steps,
      ...(normalizeText(printExtraction.note) ? { note: normalizeText(printExtraction.note) } : {}),
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

const requireCookpadPage = (
  context: DeterministicImportContext,
  pageId: string,
  recipeId: string,
) => {
  const fetchedPage = context.pages.get(pageId);
  if (!fetchedPage || getCookpadRecipeId(fetchedPage.finalUrl) !== recipeId) {
    throw new RecipeImportError(
      "extraction_failed",
      "Cookpad fetched page did not match the requested recipe.",
    );
  }

  return fetchedPage;
};

const extractCookpadPrintRecipe = async (
  fetchedPage: FetchedImportPage,
): Promise<CookpadPrintExtraction> => {
  const extraction: CookpadPrintExtraction = {
    title: "",
    yieldText: "",
    ingredientRows: [],
    note: "",
    steps: [],
  };
  const ingredientStack: IngredientCapture[] = [];
  const stepStack: PrintStepCapture[] = [];
  const stepImageStack: ImageCapture[] = [];
  let imageCandidatePosition = 0;
  let recipeRootFound = false;

  const addCandidates = (capture: ImageCapture | undefined, rawValue: string | null) => {
    if (!capture || !rawValue) return;
    for (const rawUrl of parseSrcsetUrls(rawValue)) {
      const candidate = createImageCandidate(
        rawUrl,
        fetchedPage.finalUrl,
        imageCandidatePosition++,
      );
      if (candidate) capture.candidates.push(candidate);
    }
  };

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
    .on("#recipe-print .mise-icon-text", {
      text(text) {
        extraction.yieldText += text.text;
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
        const capture: PrintStepCapture = { text: "", imageUrls: [] };
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
    .on("#recipe-print ol.grid > li picture", {
      element(element) {
        const capture: ImageCapture = { candidates: [] };
        stepImageStack.push(capture);
        element.onEndTag(() => {
          const step = stepStack.at(-1);
          const imageUrl = selectBestImageUrl(capture.candidates);
          if (step && imageUrl && !step.imageUrls.includes(imageUrl)) {
            step.imageUrls.push(imageUrl);
          }
          removeCapture(stepImageStack, capture);
        });
      },
    })
    .on('#recipe-print ol.grid > li picture source[type="image/jpeg"]', {
      element(element) {
        addCandidates(stepImageStack.at(-1), element.getAttribute("srcset"));
      },
    })
    .on("#recipe-print ol.grid > li img", {
      element(element) {
        const pictureCapture = stepImageStack.at(-1);
        if (pictureCapture) {
          addCandidates(pictureCapture, element.getAttribute("src"));
          return;
        }

        const step = stepStack.at(-1);
        const candidate = createImageCandidate(
          element.getAttribute("src") ?? "",
          fetchedPage.finalUrl,
          imageCandidatePosition++,
        );
        if (step && candidate && !step.imageUrls.includes(candidate.url)) {
          step.imageUrls.push(candidate.url);
        }
      },
    })
    .transform(importPageBodyToResponse(fetchedPage))
    .text();

  if (!recipeRootFound) {
    throw new RecipeImportError("extraction_failed", "Cookpad print recipe container was missing.");
  }

  return extraction;
};

const extractCookpadRecipePage = async (
  fetchedPage: FetchedImportPage,
): Promise<CookpadRecipeExtraction> => {
  const extraction: CookpadRecipeExtraction = {
    isPremium: false,
    title: "",
    steps: [],
  };
  const titleStack: string[] = [];
  const stepStack: RecipeStepCapture[] = [];
  const coverImageStack: ImageCapture[] = [];
  const stepImageStack: ImageCapture[] = [];
  let imageCandidatePosition = 0;

  const addCandidates = (capture: ImageCapture | undefined, rawValue: string | null) => {
    if (!capture || !rawValue) return;
    for (const rawUrl of parseSrcsetUrls(rawValue)) {
      const candidate = createImageCandidate(
        rawUrl,
        fetchedPage.finalUrl,
        imageCandidatePosition++,
      );
      if (candidate) capture.candidates.push(candidate);
    }
  };

  await new HTMLRewriter()
    .on("#premium-recipe-label", {
      element() {
        extraction.isPremium = true;
      },
    })
    .on('h1[dir="auto"]', {
      element(element) {
        titleStack.push("");
        element.onEndTag(() => {
          const title = titleStack.pop() ?? "";
          if (!extraction.title && normalizeText(title)) extraction.title = title;
        });
      },
      text(text) {
        const index = titleStack.length - 1;
        if (index >= 0) titleStack[index] += text.text;
      },
    })
    .on(".tofu_image picture", {
      element(element) {
        const capture: ImageCapture = { candidates: [] };
        coverImageStack.push(capture);
        element.onEndTag(() => {
          if (!extraction.coverImageUrl) {
            extraction.coverImageUrl = selectBestImageUrl(capture.candidates);
          }
          removeCapture(coverImageStack, capture);
        });
      },
    })
    .on('.tofu_image picture source[type="image/jpeg"]', {
      element(element) {
        addCandidates(coverImageStack.at(-1), element.getAttribute("srcset"));
      },
    })
    .on(".tofu_image picture img", {
      element(element) {
        addCandidates(coverImageStack.at(-1), element.getAttribute("src"));
      },
    })
    .on('li[id^="step_"]', {
      element(element) {
        const capture: RecipeStepCapture = {
          id: element.getAttribute("id") ?? "",
          text: "",
          imageUrls: [],
        };
        stepStack.push(capture);
        element.onEndTag(() => {
          extraction.steps.push(capture);
          removeCapture(stepStack, capture);
        });
      },
    })
    .on('li[id^="step_"] p', {
      text(text) {
        const capture = stepStack.at(-1);
        if (capture) capture.text += text.text;
      },
    })
    .on('li[id^="step_"] picture', {
      element(element) {
        const capture: ImageCapture = { candidates: [] };
        stepImageStack.push(capture);
        element.onEndTag(() => {
          const step = stepStack.at(-1);
          const imageUrl = selectBestImageUrl(capture.candidates);
          if (step && imageUrl && !step.imageUrls.includes(imageUrl)) {
            step.imageUrls.push(imageUrl);
          }
          removeCapture(stepImageStack, capture);
        });
      },
    })
    .on('li[id^="step_"] picture source[type="image/jpeg"]', {
      element(element) {
        addCandidates(stepImageStack.at(-1), element.getAttribute("srcset"));
      },
    })
    .on('li[id^="step_"] picture img', {
      element(element) {
        addCandidates(stepImageStack.at(-1), element.getAttribute("src"));
      },
    })
    .transform(importPageBodyToResponse(fetchedPage))
    .text();

  return extraction;
};

const assertCookpadExtractionsMatch = (
  printExtraction: CookpadPrintExtraction,
  recipeExtraction: CookpadRecipeExtraction,
) => {
  if (recipeExtraction.isPremium) return;

  if (printExtraction.steps.length !== recipeExtraction.steps.length) {
    throw new RecipeImportError(
      "extraction_failed",
      "Cookpad recipe pages did not contain matching recipe content.",
    );
  }

  for (const [index, printStep] of printExtraction.steps.entries()) {
    const recipeStep = recipeExtraction.steps[index];
    const printFirstImageId = getCookpadStepImageId(printStep.imageUrls[0] ?? null);
    if (
      !recipeStep?.id ||
      normalizeText(printStep.text) !== normalizeText(recipeStep.text) ||
      (printFirstImageId &&
        getCookpadStepImageId(recipeStep.imageUrls[0] ?? null) !== printFirstImageId)
    ) {
      throw new RecipeImportError(
        "extraction_failed",
        "Cookpad recipe steps did not match between fetched pages.",
      );
    }
  }
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

const parseSrcsetUrls = (srcset: string) =>
  srcset
    .split(",")
    .map((value) => value.trim().split(/\s+/)[0])
    .filter(Boolean);

const createImageCandidate = (
  rawUrl: string,
  baseUrl: string,
  position: number,
): ImageCandidate | undefined => {
  const url = resolveImageUrl(rawUrl, baseUrl);
  if (!url) return undefined;

  const size = /\/(\d+)x(\d+)[^/]*?(?:q(\d+))?\//.exec(new URL(url).pathname);
  const width = Number(size?.[1] ?? 0);
  const height = Number(size?.[2] ?? 0);
  const quality = Number(size?.[3] ?? 0);

  return {
    url,
    area: width * height,
    isQuality80: quality === 80 || /q80(?:\/|$)/.test(new URL(url).pathname),
    position,
  };
};

const selectBestImageUrl = (candidates: ImageCandidate[]) =>
  candidates.reduce<ImageCandidate | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.area !== best.area) return candidate.area > best.area ? candidate : best;
    if (candidate.isQuality80 !== best.isQuality80) {
      return candidate.isQuality80 ? candidate : best;
    }
    return candidate.position > best.position ? candidate : best;
  }, undefined)?.url;

const getCookpadStepImageId = (rawUrl: string | null) => {
  if (!rawUrl) return undefined;
  try {
    return /\/steps\/([^/]+)\//.exec(new URL(rawUrl, `https://${COOKPAD_HOST}`).pathname)?.[1];
  } catch {
    return undefined;
  }
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

const importPageBodyToResponse = (page: FetchedImportPage) => {
  if (typeof page.body !== "string") return page.body.clone();

  return new Response(page.body, {
    headers: page.contentType ? { "content-type": page.contentType } : undefined,
  });
};
