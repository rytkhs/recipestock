import { type RecipeDraftContent } from "@recipestock/schemas";
import { type FetchedImportPage, RecipeImportError } from "../types";
import {
  type DeterministicImportAdapter,
  type DeterministicImportContext,
  type DeterministicImportMatchInput,
} from "./types";

const KURASHIRU_HOST = "kurashiru.com";
const KURASHIRU_RECIPE_PAGE_ID = "recipe";
const KURASHIRU_RECIPE_PATH =
  /^\/recipes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/print)?\/?$/i;

const createKurashiruRecipeUrl = (recipeId: string) =>
  `https://www.${KURASHIRU_HOST}/recipes/${recipeId}`;

export const kurashiruImportAdapter: DeterministicImportAdapter = {
  id: "kurashiru",

  match({ normalizedUrl }: DeterministicImportMatchInput) {
    return getKurashiruRecipeId(normalizedUrl) !== null;
  },

  resolveFetchRequests({ normalizedUrl }: DeterministicImportMatchInput) {
    const recipeId = getKurashiruRecipeId(normalizedUrl);
    if (!recipeId) {
      throw new RecipeImportError("invalid_url", "Kurashiru recipe URL is invalid.");
    }

    return [
      {
        id: KURASHIRU_RECIPE_PAGE_ID,
        url: createKurashiruRecipeUrl(recipeId),
      },
    ];
  },

  async convert(context: DeterministicImportContext) {
    const recipeId = getKurashiruRecipeId(context.normalizedUrl);
    if (!recipeId) {
      throw new RecipeImportError("invalid_url", "Kurashiru recipe URL is invalid.");
    }

    const page = requireKurashiruPage(context, recipeId);
    const extraction = await extractKurashiruPage(page);
    const canonicalRecipeId = extraction.canonicalUrl
      ? getKurashiruRecipeId(extraction.canonicalUrl, false)
      : null;
    if (canonicalRecipeId !== recipeId) {
      throw new RecipeImportError(
        "extraction_failed",
        "Kurashiru recipe identity could not be verified.",
      );
    }

    const recipeJsonLd = findRecipeJsonLd(extraction.jsonLdDocuments, page.finalUrl);
    if (recipeJsonLd?.recipeId && recipeJsonLd.recipeId !== recipeId) {
      throw new RecipeImportError(
        "extraction_failed",
        "Kurashiru structured data did not match the requested recipe.",
      );
    }

    const data = findKurashiruRecipeData(extraction.environmentDocuments, recipeId);
    const attributes = asRecord(data.attributes);
    if (
      data.type !== "videos" ||
      normalizeText(attributes["publish-status"]) !== "published" ||
      normalizeText(attributes["content-type"]) !== "normal"
    ) {
      throw new RecipeImportError(
        "extraction_failed",
        "Kurashiru recipe is not a supported published recipe.",
      );
    }

    const title = normalizeText(attributes.title);
    const { ingredientGroups, ingredientNamesById } = buildIngredientGroups(
      asArray(attributes.ingredients),
    );
    const steps = buildSteps(asArray(attributes.instructions), asArray(attributes.points));
    if (!title || ingredientGroups.length === 0 || steps.length === 0) {
      throw new RecipeImportError(
        "extraction_failed",
        "Kurashiru recipe structure could not be extracted.",
      );
    }

    const coverImageUrl = [
      attributes["thumbnail-square-large-url"],
      extraction.ogImageUrl,
      recipeJsonLd?.imageUrl,
      attributes["thumbnail-square-normal-url"],
    ]
      .map((value) => resolveHttpUrl(value, page.finalUrl))
      .find(Boolean);
    const yieldText = normalizeText(attributes.servings);
    const note = buildNote(attributes, asArray(attributes.points), ingredientNamesById);
    const recipeDraftContent: RecipeDraftContent = {
      title,
      ...(yieldText ? { yieldText } : {}),
      ...(coverImageUrl
        ? {
            coverImage: {
              type: "externalImageUrl",
              url: coverImageUrl,
            } as const,
          }
        : {}),
      sourceMedia: [],
      ingredientGroups,
      steps,
      ...(note ? { note } : {}),
    };

    return {
      recipeDraftContent,
      source: {
        sourceUrl: createKurashiruRecipeUrl(recipeId),
        sourceName: "クラシル",
      },
      warnings: [],
    };
  },
};

type KurashiruPageExtraction = {
  canonicalUrl?: string;
  ogImageUrl?: string;
  jsonLdDocuments: string[];
  environmentDocuments: string[];
};

type KurashiruJsonLdRecipe = {
  recipeId?: string;
  imageUrl?: string;
};

const getKurashiruRecipeId = (rawUrl: string, allowPrint = true) => {
  const url = new URL(rawUrl);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (url.hostname !== KURASHIRU_HOST && url.hostname !== `www.${KURASHIRU_HOST}`) ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null;
  }

  const pattern = allowPrint
    ? KURASHIRU_RECIPE_PATH
    : /^\/recipes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
  return pattern.exec(url.pathname)?.[1]?.toLowerCase() ?? null;
};

const requireKurashiruPage = (
  context: DeterministicImportContext,
  recipeId: string,
): FetchedImportPage => {
  const page = context.pages.get(KURASHIRU_RECIPE_PAGE_ID);
  if (!page || getKurashiruRecipeId(page.finalUrl, false) !== recipeId) {
    throw new RecipeImportError(
      "extraction_failed",
      "Kurashiru fetched page did not match the requested recipe.",
    );
  }
  return page;
};

const extractKurashiruPage = async (page: FetchedImportPage): Promise<KurashiruPageExtraction> => {
  const extraction: KurashiruPageExtraction = {
    jsonLdDocuments: [],
    environmentDocuments: [],
  };
  const scriptStack: Array<{ isJsonLd: boolean; text: string }> = [];

  await new HTMLRewriter()
    .on('link[rel="canonical"]', {
      element(element) {
        extraction.canonicalUrl = resolveHttpUrl(element.getAttribute("href"), page.finalUrl);
      },
    })
    .on('meta[property="og:image"]', {
      element(element) {
        extraction.ogImageUrl = resolveHttpUrl(element.getAttribute("content"), page.finalUrl);
      },
    })
    .on("script", {
      element(element) {
        const capture = {
          isJsonLd: element.getAttribute("type") === "application/ld+json",
          text: "",
        };
        scriptStack.push(capture);
        element.onEndTag(() => {
          removeCapture(scriptStack, capture);
          if (capture.isJsonLd) {
            if (capture.text) extraction.jsonLdDocuments.push(capture.text);
          } else if (capture.text.includes("window.__delyKurashiruEnvironment")) {
            extraction.environmentDocuments.push(capture.text);
          }
        });
      },
      text(text) {
        const capture = scriptStack.at(-1);
        if (capture) capture.text += text.text;
      },
    })
    .transform(importPageBodyToResponse(page))
    .text();

  return extraction;
};

const findKurashiruRecipeData = (documents: string[], recipeId: string) => {
  const candidates: Record<string, unknown>[] = [];
  for (const document of documents) {
    for (const environment of extractEnvironmentObjects(document)) {
      const ssrContext = asRecord(environment.ssrContext);
      const direct = asRecord(asRecord(ssrContext[`/wapi/videos/${recipeId}`]).data);
      if (isMatchingRecipeData(direct, recipeId)) return direct;

      for (const value of Object.values(ssrContext)) {
        const data = asRecord(asRecord(value).data);
        if (
          isMatchingRecipeData(data, recipeId) &&
          !candidates.some((candidate) => candidate === data)
        ) {
          candidates.push(data);
        }
      }
    }
  }

  if (candidates.length !== 1) {
    throw new RecipeImportError(
      "extraction_failed",
      "Kurashiru SSR recipe data could not be identified.",
    );
  }
  return candidates[0];
};

const extractEnvironmentObjects = (script: string): Record<string, unknown>[] => {
  const marker = "window.__delyKurashiruEnvironment";
  const results: Record<string, unknown>[] = [];
  let searchFrom = 0;

  while (searchFrom < script.length) {
    const markerIndex = script.indexOf(marker, searchFrom);
    if (markerIndex < 0) break;
    const commaIndex = script.indexOf(",", markerIndex + marker.length);
    const objectStart = commaIndex < 0 ? -1 : script.indexOf("{", commaIndex + 1);
    if (objectStart < 0) break;
    const json = scanJsonObject(script, objectStart);
    if (json) {
      try {
        const parsed = JSON.parse(json);
        if (isRecord(parsed)) results.push(parsed);
      } catch {}
      searchFrom = objectStart + json.length;
    } else {
      searchFrom = objectStart + 1;
    }
  }

  return results;
};

const scanJsonObject = (input: string, start: number) => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index++) {
    const character = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }

  return undefined;
};

const isMatchingRecipeData = (data: Record<string, unknown>, recipeId: string) =>
  data.type === "videos" && normalizeText(data.id).toLowerCase() === recipeId;

const buildIngredientGroups = (items: unknown[]) => {
  const headingById = new Map<string, string>();
  for (const item of items) {
    const row = asRecord(item);
    if (row.type === "heading") {
      const label = normalizeText(row.title);
      if (label) headingById.set(String(row.id), label);
    }
  }

  const groups: RecipeDraftContent["ingredientGroups"] = [];
  const ingredientNamesById = new Map<string, string>();
  for (const item of items) {
    const row = asRecord(item);
    if (row.type !== "ingredients") continue;

    const groupId = row["group-id"];
    const groupName = normalizeText(row["group-name"]);
    const label =
      groupId !== null && groupId !== undefined
        ? headingById.get(String(groupId)) || groupName || undefined
        : groupName || undefined;
    const name = normalizeText(label ? row["actual-name"] || row.name : row.name);
    if (!name) continue;

    const amountDescription = asRecord(row.amount).description;
    const amount = normalizeText(row["quantity-amount"]) || normalizeText(amountDescription) || "";
    const previousGroup = groups.at(-1);
    const group =
      previousGroup && previousGroup.label === label
        ? previousGroup
        : {
            ...(label ? { label } : {}),
            ingredients: [],
          };
    if (group !== previousGroup) groups.push(group);
    group.ingredients.push({ name, amount });
    if (row.id !== null && row.id !== undefined) ingredientNamesById.set(String(row.id), name);
  }

  return {
    ingredientGroups: groups.filter((group) => group.ingredients.length > 0),
    ingredientNamesById,
  };
};

const buildSteps = (instructions: unknown[], points: unknown[]): RecipeDraftContent["steps"] => {
  const pointsByInstructionId = new Map<string, string[]>();
  for (const item of points) {
    const point = asRecord(item);
    if (point.type !== "instructions") continue;
    const instructionId = point["instruction-id"];
    const text = normalizeMultiline(point.text);
    if (instructionId === null || instructionId === undefined || !text) continue;
    const values = pointsByInstructionId.get(String(instructionId)) ?? [];
    values.push(text);
    pointsByInstructionId.set(String(instructionId), values);
  }

  return instructions.flatMap((item) => {
    const instruction = asRecord(item);
    const text = normalizeMultiline(instruction.body);
    if (!text) return [];
    const supplements =
      instruction.id === null || instruction.id === undefined
        ? []
        : (pointsByInstructionId.get(String(instruction.id)) ?? []);
    return [
      {
        text: [text, ...supplements.map((point) => `ポイント: ${point}`)].join("\n\n"),
        images: [],
      },
    ];
  });
};

const buildNote = (
  attributes: Record<string, unknown>,
  points: unknown[],
  ingredientNamesById: ReadonlyMap<string, string>,
) => {
  const sections: string[] = [];
  const memo = normalizeMultiline(attributes.memo);
  if (memo) sections.push(`コツ・ポイント\n${memo}`);

  const ingredientPoints = points.flatMap((item) => {
    const point = asRecord(item);
    if (point.type !== "ingredients") return [];
    const text = normalizeMultiline(point.text);
    if (!text) return [];
    const ingredientId = point["ingredient-id"];
    const ingredientName =
      ingredientId === null || ingredientId === undefined
        ? "材料"
        : (ingredientNamesById.get(String(ingredientId)) ?? "材料");
    return [`- ${ingredientName}: ${stripMarkdownLinks(text)}`];
  });
  if (ingredientPoints.length > 0) {
    sections.push(`材料のポイント\n${ingredientPoints.join("\n")}`);
  }

  return sections.join("\n\n");
};

const findRecipeJsonLd = (
  documents: string[],
  baseUrl: string,
): KurashiruJsonLdRecipe | undefined => {
  for (const document of documents) {
    try {
      for (const node of collectJsonLdRecipeNodes(JSON.parse(document))) {
        const mainEntity = asRecord(node.mainEntityOfPage);
        const identityUrl =
          typeof node.mainEntityOfPage === "string"
            ? node.mainEntityOfPage
            : typeof mainEntity["@id"] === "string"
              ? mainEntity["@id"]
              : typeof mainEntity.url === "string"
                ? mainEntity.url
                : undefined;
        return {
          recipeId: identityUrl
            ? (getKurashiruRecipeId(new URL(identityUrl, baseUrl).toString(), false) ?? undefined)
            : undefined,
          imageUrl: extractFirstImageUrl(node.image, baseUrl),
        };
      }
    } catch {}
  }
  return undefined;
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

const extractFirstImageUrl = (value: unknown, baseUrl: string): string | undefined => {
  if (typeof value === "string") return resolveHttpUrl(value, baseUrl);
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractFirstImageUrl(item, baseUrl);
      if (url) return url;
    }
  }
  if (isRecord(value)) {
    return (
      extractFirstImageUrl(value.url, baseUrl) ?? extractFirstImageUrl(value.contentUrl, baseUrl)
    );
  }
  return undefined;
};

const stripMarkdownLinks = (value: string) => value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

const normalizeText = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : "";

const normalizeMultiline = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
};

const resolveHttpUrl = (rawUrl: unknown, baseUrl: string) => {
  if (typeof rawUrl !== "string" || !rawUrl) return undefined;
  try {
    const url = new URL(rawUrl, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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
