/// <reference path="./html2md4llm.d.ts" />

import html2md4llm from "html2md4llm";
import {
  type FetchedImportPage,
  type RecipeImportImageCandidate,
  type RecipeImportStructuredEvidence,
} from "./lib/import/types";

type ExtractedRecipeStructuredInstruction = {
  text: string;
  imageUrls: string[];
};

type ExtractedRecipeStructuredEvidence = {
  format: "jsonLd" | "microdata" | "rdfa";
  name?: string;
  yieldText?: string;
  imageUrls: string[];
  rawIngredients: string[];
  rawInstructions: string[];
  structuredInstructions: ExtractedRecipeStructuredInstruction[];
};

export type RecipePageEvidence = {
  meta: Record<string, string | undefined>;
  markdownContent: string;
  recipeStructuredEvidence: RecipeImportStructuredEvidence[];
  imageCandidates: RecipeImportImageCandidate[];
};

export const extractRecipePageEvidence = async (
  page: FetchedImportPage,
  baseUrl: string,
): Promise<RecipePageEvidence> => {
  const imageRegistry = new ImportImageRegistry(baseUrl);
  const extraction = await extractHtmlImportData(page, baseUrl, imageRegistry);
  const markdownContent = normalizeMarkdownContent(extraction.markdownContent);
  const extractedRecipeStructuredEvidence = dedupeRecipeStructuredEvidence([
    ...extractRecipeJsonLdEvidence(extraction.jsonLd, baseUrl),
    ...extraction.recipeStructuredEvidence,
  ]);

  return {
    meta: extraction.meta,
    markdownContent,
    recipeStructuredEvidence: buildImportStructuredEvidence(
      extractedRecipeStructuredEvidence,
      imageRegistry,
    ),
    imageCandidates: imageRegistry.candidates,
  };
};

type HtmlRewriterElement = Parameters<
  NonNullable<HTMLRewriterElementContentHandlers["element"]>
>[0];

type HtmlElementEndTagRegistrar = (element: HtmlRewriterElement, callback: () => void) => void;

type RecipeStructuredEvidenceBuilder = {
  format: ExtractedRecipeStructuredEvidence["format"];
  name?: string;
  yieldText?: string;
  imageUrls: string[];
  rawIngredients: string[];
  rawInstructions: string[];
  structuredInstructions: ExtractedRecipeStructuredInstruction[];
};

type RecipeStructuredProperty = keyof Pick<
  ExtractedRecipeStructuredEvidence,
  "name" | "yieldText" | "imageUrls" | "rawIngredients" | "rawInstructions"
>;

type RecipeStructuredTextCapture = {
  builder: RecipeStructuredEvidenceBuilder;
  properties: RecipeStructuredProperty[];
  text: string;
};

type HtmlImportExtraction = {
  title: string;
  meta: Record<string, string | undefined>;
  h1: string[];
  markdownContent: string;
  jsonLd: string[];
  recipeStructuredEvidence: ExtractedRecipeStructuredEvidence[];
};

class ImportImageRegistry {
  readonly #baseUrl: string;
  readonly #candidates: RecipeImportImageCandidate[] = [];
  readonly #candidatesByUrl = new Map<string, RecipeImportImageCandidate>();

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  get candidates() {
    return this.#candidates;
  }

  getOrCreate(rawUrl: string | undefined, alt?: string): RecipeImportImageCandidate | undefined {
    if (!rawUrl) return undefined;

    let url: string;
    try {
      url = new URL(decodeHtml(rawUrl), this.#baseUrl).toString();
    } catch {
      return undefined;
    }

    const existingCandidate = this.#candidatesByUrl.get(url);
    if (existingCandidate) return existingCandidate;
    if (this.#candidates.length >= 100) return undefined;

    const id = `img_${String(this.#candidates.length + 1).padStart(3, "0")}`;
    const normalizedAlt = alt ? normalizeImageAlt(alt) : undefined;
    const candidate = {
      id,
      url,
      alt: normalizedAlt || undefined,
      position: this.#candidates.length,
    };
    this.#candidatesByUrl.set(url, candidate);
    this.#candidates.push(candidate);

    return candidate;
  }
}

const extractHtmlImportData = async (
  page: FetchedImportPage,
  baseUrl: string,
  imageRegistry: ImportImageRegistry,
): Promise<HtmlImportExtraction> => {
  const extraction: HtmlImportExtraction = {
    title: "",
    meta: {},
    h1: [],
    markdownContent: "",
    jsonLd: [],
    recipeStructuredEvidence: [],
  };
  let ignoredTextDepth = 0;
  let jsonLdText: string | null = null;
  const h1TextBuffers: { text: string }[] = [];
  const endTagCallbacks = new WeakMap<HtmlRewriterElement, Array<() => void>>();

  extraction.recipeStructuredEvidence = await extractRecipeHtmlStructuredEvidence(page, baseUrl);
  const onHtmlElementEnd: HtmlElementEndTagRegistrar = (element, callback) => {
    const callbacks = endTagCallbacks.get(element);
    if (callbacks) {
      callbacks.push(callback);
      return;
    }

    const elementCallbacks = [callback];
    endTagCallbacks.set(element, elementCallbacks);
    element.onEndTag(() => {
      for (let index = elementCallbacks.length - 1; index >= 0; index -= 1) {
        elementCallbacks[index]?.();
      }
    });
  };
  const ignoreElementText = {
    element(element: HtmlRewriterElement) {
      ignoredTextDepth += 1;
      onHtmlElementEnd(element, () => {
        ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
      });
    },
  };
  const h1Handler = {
    element(element: HtmlRewriterElement) {
      if (ignoredTextDepth > 0) return;

      const buffer = { text: "" };
      h1TextBuffers.push(buffer);
      onHtmlElementEnd(element, () => {
        const normalized = normalizeReadableText(buffer.text);
        if (normalized) {
          extraction.h1.push(normalized);
        }

        const bufferIndex = h1TextBuffers.lastIndexOf(buffer);
        if (bufferIndex >= 0) {
          h1TextBuffers.splice(bufferIndex, 1);
        }
      });
    },
    text(text: Parameters<NonNullable<HTMLRewriterElementContentHandlers["text"]>>[0]) {
      if (ignoredTextDepth > 0) return;

      const buffer = h1TextBuffers.at(-1);
      if (buffer) {
        buffer.text += text.text;
      }
    },
  };

  const htmlWithImageMarkers = await new HTMLRewriter()
    .on("title", {
      text(text) {
        extraction.title += text.text;
      },
    })
    .on("meta", {
      element(element) {
        const key = normalizeMetaKey(
          element.getAttribute("property") ?? element.getAttribute("name"),
        );
        const content = element.getAttribute("content");
        if (!key || !content || extraction.meta[key]) return;

        extraction.meta[key] = normalizeReadableText(content);
        if (key === "og:image" || key === "twitter:image") {
          imageRegistry.getOrCreate(content);
        }
      },
    })
    .on("h1", h1Handler)
    .on("script", {
      element(element) {
        ignoredTextDepth += 1;
        const type = element.getAttribute("type")?.toLowerCase().replace(/\s+/g, "");
        jsonLdText = type === "application/ld+json" && extraction.jsonLd.length < 5 ? "" : null;
        if (type !== "application/ld+json" || extraction.jsonLd.length >= 5) {
          onHtmlElementEnd(element, () => {
            ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
          });
          return;
        }

        onHtmlElementEnd(element, () => {
          ignoredTextDepth = Math.max(0, ignoredTextDepth - 1);
          const normalizedJsonLd = normalizeReadableText(jsonLdText ?? "");
          if (normalizedJsonLd && extraction.jsonLd.length < 5) {
            extraction.jsonLd.push(normalizedJsonLd);
          }
          jsonLdText = null;
        });
      },
      text(text) {
        if (jsonLdText === null) return;
        jsonLdText += text.text;
      },
    })
    .on("style", ignoreElementText)
    .on("noscript", ignoreElementText)
    .on("svg", ignoreElementText)
    .on("img", {
      element(element) {
        const rawUrl = element.getAttribute("src") ?? element.getAttribute("data-src") ?? undefined;
        const alt = element.getAttribute("alt") ?? undefined;
        const candidate = imageRegistry.getOrCreate(rawUrl, alt);
        element.replace(candidate ? formatMarkdownImage(candidate.url, alt) : "", {
          html: false,
        });
      },
    })
    .transform(importPageBodyToResponse(page))
    .text();

  extraction.markdownContent = html2md4llm(htmlWithImageMarkers, {
    strategy: "article",
    outputFormat: "markdown",
  });

  return {
    ...extraction,
    jsonLd: extraction.jsonLd.filter(Boolean).slice(0, 5),
    recipeStructuredEvidence: dedupeRecipeStructuredEvidence(
      extraction.recipeStructuredEvidence,
    ).slice(0, 20),
  };
};

const extractRecipeHtmlStructuredEvidence = async (
  page: FetchedImportPage,
  baseUrl: string,
): Promise<ExtractedRecipeStructuredEvidence[]> => {
  const recipes: ExtractedRecipeStructuredEvidence[] = [];
  const microdataRecipeStack: RecipeStructuredEvidenceBuilder[] = [];
  const rdfaRecipeStack: RecipeStructuredEvidenceBuilder[] = [];
  const structuredTextCaptures: RecipeStructuredTextCapture[] = [];
  const endTagCallbacks = new WeakMap<HtmlRewriterElement, Array<() => void>>();

  const onHtmlElementEnd: HtmlElementEndTagRegistrar = (element, callback) => {
    const callbacks = endTagCallbacks.get(element);
    if (callbacks) {
      callbacks.push(callback);
      return;
    }

    const elementCallbacks = [callback];
    endTagCallbacks.set(element, elementCallbacks);
    element.onEndTag(() => {
      for (let index = elementCallbacks.length - 1; index >= 0; index -= 1) {
        elementCallbacks[index]?.();
      }
    });
  };
  const appendStructuredEvidence = (builder: RecipeStructuredEvidenceBuilder) => {
    const evidence = normalizeRecipeStructuredEvidence(builder);
    if (!evidence || recipes.length >= 20) return;

    recipes.push(evidence);
  };

  await new HTMLRewriter()
    .on("*", {
      element(element) {
        const microdataRecipe = createMicrodataRecipeBuilder(element);
        if (microdataRecipe) {
          microdataRecipeStack.push(microdataRecipe);
          onHtmlElementEnd(element, () => {
            removeStackEntry(microdataRecipeStack, microdataRecipe);
            appendStructuredEvidence(microdataRecipe);
          });
        }

        const rdfaRecipe = createRdfaRecipeBuilder(element);
        if (rdfaRecipe) {
          rdfaRecipeStack.push(rdfaRecipe);
          onHtmlElementEnd(element, () => {
            removeStackEntry(rdfaRecipeStack, rdfaRecipe);
            appendStructuredEvidence(rdfaRecipe);
          });
        }

        captureMicrodataRecipeProperties(element, microdataRecipeStack.at(-1), {
          baseUrl,
          structuredTextCaptures,
          onHtmlElementEnd,
        });
        captureRdfaRecipeProperties(element, rdfaRecipeStack.at(-1), {
          baseUrl,
          structuredTextCaptures,
          onHtmlElementEnd,
        });
      },
    })
    .onDocument({
      text(text) {
        for (const capture of structuredTextCaptures) {
          capture.text += text.text;
        }
      },
    })
    .transform(importPageBodyToResponse(page))
    .text();

  return dedupeRecipeStructuredEvidence(recipes).slice(0, 20);
};

const createMicrodataRecipeBuilder = (
  element: HtmlRewriterElement,
): RecipeStructuredEvidenceBuilder | undefined => {
  if (!element.hasAttribute("itemscope")) return undefined;
  if (!hasSchemaRecipeType(element.getAttribute("itemtype"))) return undefined;

  return createRecipeStructuredEvidenceBuilder("microdata");
};

const createRdfaRecipeBuilder = (
  element: HtmlRewriterElement,
): RecipeStructuredEvidenceBuilder | undefined => {
  if (!hasSchemaRecipeType(element.getAttribute("typeof"))) return undefined;

  return createRecipeStructuredEvidenceBuilder("rdfa");
};

const createRecipeStructuredEvidenceBuilder = (
  format: ExtractedRecipeStructuredEvidence["format"],
): RecipeStructuredEvidenceBuilder => ({
  format,
  imageUrls: [],
  rawIngredients: [],
  rawInstructions: [],
  structuredInstructions: [],
});

const removeStackEntry = <T>(stack: T[], entry: T) => {
  const index = stack.lastIndexOf(entry);
  if (index >= 0) {
    stack.splice(index, 1);
  }
};

const captureMicrodataRecipeProperties = (
  element: HtmlRewriterElement,
  builder: RecipeStructuredEvidenceBuilder | undefined,
  {
    baseUrl,
    structuredTextCaptures,
    onHtmlElementEnd,
  }: {
    baseUrl: string;
    structuredTextCaptures: RecipeStructuredTextCapture[];
    onHtmlElementEnd: HtmlElementEndTagRegistrar;
  },
) => {
  if (!builder) return;

  const properties = normalizeRecipeStructuredProperties(element.getAttribute("itemprop"));
  if (properties.length === 0) return;

  const value = extractStructuredElementValue(element);
  if (value) {
    appendRecipeStructuredValue(builder, properties, value, baseUrl);
    return;
  }

  startRecipeStructuredTextCapture(element, builder, properties, structuredTextCaptures, {
    onHtmlElementEnd,
  });
};

const captureRdfaRecipeProperties = (
  element: HtmlRewriterElement,
  builder: RecipeStructuredEvidenceBuilder | undefined,
  {
    baseUrl,
    structuredTextCaptures,
    onHtmlElementEnd,
  }: {
    baseUrl: string;
    structuredTextCaptures: RecipeStructuredTextCapture[];
    onHtmlElementEnd: HtmlElementEndTagRegistrar;
  },
) => {
  if (!builder) return;

  const properties = normalizeRecipeStructuredProperties(element.getAttribute("property"));
  if (properties.length === 0) return;

  const value = extractStructuredElementValue(element);
  if (value) {
    appendRecipeStructuredValue(builder, properties, value, baseUrl);
    return;
  }

  startRecipeStructuredTextCapture(element, builder, properties, structuredTextCaptures, {
    onHtmlElementEnd,
  });
};

const startRecipeStructuredTextCapture = (
  element: HtmlRewriterElement,
  builder: RecipeStructuredEvidenceBuilder,
  properties: RecipeStructuredProperty[],
  structuredTextCaptures: RecipeStructuredTextCapture[],
  { onHtmlElementEnd }: { onHtmlElementEnd: HtmlElementEndTagRegistrar },
) => {
  const capture: RecipeStructuredTextCapture = { builder, properties, text: "" };
  structuredTextCaptures.push(capture);
  onHtmlElementEnd(element, () => {
    const normalizedText = normalizeReadableText(capture.text);
    if (normalizedText) {
      appendRecipeStructuredValue(builder, properties, normalizedText, "");
    }

    const captureIndex = structuredTextCaptures.lastIndexOf(capture);
    if (captureIndex >= 0) {
      structuredTextCaptures.splice(captureIndex, 1);
    }
  });
};

const extractStructuredElementValue = (element: HtmlRewriterElement) =>
  firstReadableAttribute(element, ["content", "src", "href", "data", "value", "datetime"]);

const firstReadableAttribute = (element: HtmlRewriterElement, attributes: string[]) => {
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    const normalized = value ? normalizeReadableText(value) : "";
    if (normalized) return normalized;
  }

  return undefined;
};

const appendRecipeStructuredValue = (
  builder: RecipeStructuredEvidenceBuilder,
  properties: RecipeStructuredProperty[],
  value: string,
  baseUrl: string,
) => {
  for (const property of properties) {
    if (property === "name") {
      builder.name ??= value;
    } else if (property === "yieldText") {
      builder.yieldText ??= value;
    } else if (property === "imageUrls") {
      const imageUrl = resolveStructuredImageUrl(value, baseUrl);
      if (imageUrl) builder.imageUrls.push(imageUrl);
    } else if (property === "rawIngredients") {
      builder.rawIngredients.push(value);
    } else if (property === "rawInstructions") {
      builder.rawInstructions.push(value);
    }
  }
};

const normalizeRecipeStructuredEvidence = (
  builder: RecipeStructuredEvidenceBuilder,
): ExtractedRecipeStructuredEvidence | undefined => {
  const evidence = {
    format: builder.format,
    name: builder.name ? normalizeReadableText(builder.name) : undefined,
    yieldText: builder.yieldText ? normalizeReadableText(builder.yieldText) : undefined,
    imageUrls: dedupeStrings(builder.imageUrls.map(normalizeReadableText).filter(Boolean)),
    rawIngredients: dedupeStrings(
      builder.rawIngredients.map(normalizeReadableText).filter(Boolean),
    ),
    rawInstructions: dedupeStrings(
      builder.rawInstructions.map(normalizeReadableText).filter(Boolean),
    ),
    structuredInstructions: builder.structuredInstructions,
  } satisfies ExtractedRecipeStructuredEvidence;

  if (
    !evidence.name &&
    !evidence.yieldText &&
    evidence.imageUrls.length === 0 &&
    evidence.rawIngredients.length === 0 &&
    evidence.rawInstructions.length === 0 &&
    evidence.structuredInstructions.length === 0
  ) {
    return undefined;
  }

  return evidence;
};

const normalizeRecipeStructuredProperties = (value: string | null): RecipeStructuredProperty[] => {
  const properties: RecipeStructuredProperty[] = [];

  for (const token of splitHtmlTokens(value)) {
    const property = normalizeRecipeStructuredProperty(token);
    if (property && !properties.includes(property)) {
      properties.push(property);
    }
  }

  return properties;
};

const normalizeRecipeStructuredProperty = (value: string): RecipeStructuredProperty | undefined => {
  const term = normalizeSchemaTerm(value);
  if (term === "name") return "name";
  if (term === "recipeyield") return "yieldText";
  if (term === "image") return "imageUrls";
  if (term === "recipeingredient") return "rawIngredients";
  if (term === "recipeinstructions" || term === "text" || term === "itemlistelement") {
    return "rawInstructions";
  }

  return undefined;
};

const hasSchemaRecipeType = (value: string | null) =>
  splitHtmlTokens(value).some((token) => normalizeSchemaTerm(token) === "recipe");

const normalizeSchemaTerm = (value: string) => {
  const normalized = value.trim().replace(/\/$/, "");
  const lower = normalized.toLowerCase();

  if (lower.startsWith("http://schema.org/")) {
    return lower.slice("http://schema.org/".length);
  }
  if (lower.startsWith("https://schema.org/")) {
    return lower.slice("https://schema.org/".length);
  }
  if (lower.startsWith("schema:")) {
    return lower.slice("schema:".length);
  }

  return lower;
};

const splitHtmlTokens = (value: string | null) => (value ? value.trim().split(/\s+/) : []);

const resolveStructuredImageUrl = (rawUrl: string, baseUrl: string) => {
  try {
    return new URL(decodeHtml(rawUrl), baseUrl || undefined).toString();
  } catch {
    return undefined;
  }
};

const importPageBodyToResponse = (page: FetchedImportPage) => {
  if (typeof page.body !== "string") {
    return page.body.clone();
  }

  return new Response(page.body, {
    headers: page.contentType ? { "content-type": page.contentType } : undefined,
  });
};

const normalizeMetaKey = (key: string | null) => {
  if (!key) return undefined;

  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey === "description" ||
    normalizedKey === "og:title" ||
    normalizedKey === "og:description" ||
    normalizedKey === "og:site_name" ||
    normalizedKey === "og:image" ||
    normalizedKey === "twitter:title" ||
    normalizedKey === "twitter:description" ||
    normalizedKey === "twitter:image"
  ) {
    return normalizedKey;
  }

  return undefined;
};

const normalizeReadableText = (value: string) =>
  decodeHtml(value).replace(/\s+/g, " ").trim().slice(0, 24_000);

const normalizeImageAlt = (value: string) => normalizeReadableText(value).slice(0, 120);

const formatMarkdownImage = (url: string, alt?: string) => {
  const normalizedAlt = alt ? normalizeImageAlt(alt) : "";
  return `\n![${escapeMarkdownImageAlt(normalizedAlt)}](<${url}>)\n`;
};

const escapeMarkdownImageAlt = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

const normalizeMarkdownContent = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 24_000);

const extractRecipeJsonLdEvidence = (
  documents: string[],
  baseUrl: string,
): ExtractedRecipeStructuredEvidence[] => {
  const recipes: ExtractedRecipeStructuredEvidence[] = [];
  const seen = new Set<string>();

  for (const document of documents) {
    try {
      for (const node of collectRecipeJsonLdNodes(JSON.parse(document))) {
        const recipe = normalizeRecipeJsonLdNode(node, baseUrl);
        const key = JSON.stringify(recipe);
        if (seen.has(key)) continue;

        seen.add(key);
        recipes.push(recipe);
      }
    } catch {}
  }

  return recipes;
};

const collectRecipeJsonLdNodes = (value: unknown): Record<string, unknown>[] => {
  const recipes: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    if (isJsonLdRecipeNode(record)) {
      recipes.push(record);
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(value);
  return recipes;
};

const normalizeRecipeJsonLdNode = (
  record: Record<string, unknown>,
  baseUrl: string,
): ExtractedRecipeStructuredEvidence => {
  const structuredInstructions = extractJsonLdStructuredInstructions(
    record.recipeInstructions,
    baseUrl,
  );

  return {
    format: "jsonLd",
    name: firstReadableText(record.name),
    yieldText: firstReadableText(record.recipeYield),
    imageUrls: extractJsonLdImageUrls(record.image, baseUrl),
    rawIngredients: extractReadableTexts(record.recipeIngredient),
    rawInstructions: structuredInstructions.map((instruction) => instruction.text),
    structuredInstructions,
  };
};

const isJsonLdRecipeNode = (record: Record<string, unknown>): boolean => {
  const type = record["@type"];
  const typeValues = Array.isArray(type) ? type : [type];
  return typeValues.some((entry) => typeof entry === "string" && entry.toLowerCase() === "recipe");
};

const extractReadableTexts = (value: unknown): string[] => {
  const texts: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string" || typeof node === "number") {
      texts.push(String(node));
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    if (typeof record.text === "string") {
      texts.push(record.text);
      return;
    }
    if (typeof record.name === "string") {
      texts.push(record.name);
    }
  };

  visit(value);
  return dedupeStrings(texts.map(normalizeReadableText).filter(Boolean));
};

const firstReadableText = (value: unknown) => extractReadableTexts(value)[0];

const extractJsonLdStructuredInstructions = (
  value: unknown,
  baseUrl: string,
): ExtractedRecipeStructuredInstruction[] => {
  const instructions: ExtractedRecipeStructuredInstruction[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const text = normalizeReadableText(node);
      if (text) {
        instructions.push({ text, imageUrls: [] });
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.name === "string" && isJsonLdHowToStepNode(record)
          ? record.name
          : undefined;

    if (text) {
      const normalizedText = normalizeReadableText(text);
      if (normalizedText) {
        instructions.push({
          text: normalizedText,
          imageUrls: extractJsonLdImageUrls(record.image, baseUrl),
        });
      }
    }

    visit(record.itemListElement);
    visit(record.steps);
  };

  visit(value);
  return dedupeStructuredInstructions(instructions);
};

const dedupeStructuredInstructions = (
  instructions: ExtractedRecipeStructuredInstruction[],
): ExtractedRecipeStructuredInstruction[] => {
  const byText = new Map<string, Set<string>>();
  const orderedTexts: string[] = [];

  for (const instruction of instructions) {
    const text = normalizeReadableText(instruction.text);
    if (!text) continue;

    let imageUrls = byText.get(text);
    if (!imageUrls) {
      imageUrls = new Set<string>();
      byText.set(text, imageUrls);
      orderedTexts.push(text);
    }

    for (const imageUrl of instruction.imageUrls) {
      imageUrls.add(imageUrl);
    }
  }

  return orderedTexts.map((text) => ({
    text,
    imageUrls: [...(byText.get(text) ?? [])],
  }));
};

const isJsonLdHowToStepNode = (record: Record<string, unknown>): boolean => {
  const type = record["@type"];
  const typeValues = Array.isArray(type) ? type : [type];
  return typeValues.some(
    (entry) => typeof entry === "string" && entry.toLowerCase() === "howtostep",
  );
};

const extractJsonLdImageUrls = (value: unknown, baseUrl: string): string[] => {
  const urls: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      urls.push(node);
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    visit(record.url);
    visit(record.contentUrl);
  };

  visit(value);
  return dedupeStrings(
    urls.flatMap((rawUrl) => {
      try {
        return new URL(decodeHtml(rawUrl), baseUrl).toString();
      } catch {
        return [];
      }
    }),
  );
};

const buildImportStructuredEvidence = (
  recipes: ExtractedRecipeStructuredEvidence[],
  imageRegistry: ImportImageRegistry,
): RecipeImportStructuredEvidence[] =>
  recipes.map((recipe) => ({
    format: recipe.format,
    name: recipe.name,
    yieldText: recipe.yieldText,
    imageUrls: recipe.imageUrls.flatMap((url) => {
      const candidate = imageRegistry.getOrCreate(url, recipe.name);
      return candidate ? [candidate.url] : [];
    }),
    rawIngredients: recipe.rawIngredients,
    rawInstructions: recipe.rawInstructions,
    structuredInstructions: recipe.structuredInstructions.map((instruction) => ({
      text: instruction.text,
      imageUrls: instruction.imageUrls.flatMap((url) => {
        const candidate = imageRegistry.getOrCreate(
          url,
          buildStructuredInstructionImageAlt(recipe, instruction),
        );
        return candidate ? [candidate.url] : [];
      }),
    })),
  }));

const buildStructuredInstructionImageAlt = (
  recipe: ExtractedRecipeStructuredEvidence,
  instruction: ExtractedRecipeStructuredInstruction,
) => normalizeReadableText([recipe.name, instruction.text].filter(Boolean).join(" ")).slice(0, 160);

const dedupeRecipeStructuredEvidence = (
  recipes: ExtractedRecipeStructuredEvidence[],
): ExtractedRecipeStructuredEvidence[] => {
  const seen = new Set<string>();
  const deduped: ExtractedRecipeStructuredEvidence[] = [];

  for (const recipe of recipes) {
    const key = JSON.stringify({
      name: recipe.name,
      yieldText: recipe.yieldText,
      imageUrls: recipe.imageUrls,
      rawIngredients: recipe.rawIngredients,
      rawInstructions: recipe.rawInstructions,
      structuredInstructions: recipe.structuredInstructions,
    });
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(recipe);
  }

  return deduped;
};

const dedupeStrings = (values: string[]) => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
};

const decodeHtml = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
