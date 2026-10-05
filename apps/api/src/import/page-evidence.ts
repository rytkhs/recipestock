import {
  forEachHtmlElement,
  getHtmlAttribute,
  getHtmlTextContent,
  type HtmlDocument,
  type HtmlElement,
  isHtmlElement,
  parseHtmlDocument,
  renderHtmlFragmentText,
  renderHtmlText,
} from "./html";
import { decodeHtmlAttribute, normalizeSingleLineText } from "./text";
import {
  type FetchedImportPage,
  type RecipeImportImageCandidate,
  type RecipeImportStructuredEvidence,
} from "./types";

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
  title: string;
  meta: Record<string, string | undefined>;
  markdownContent: string;
  recipeStructuredEvidence: RecipeImportStructuredEvidence[];
  imageCandidates: RecipeImportImageCandidate[];
};

const MAX_MARKDOWN_CONTENT_LENGTH = 24_000;
// 構造化証拠はそのままプロンプトに入る。Recipeノードを多く持つページで膨らまないよう、合計の長さに上限を置く。
// 実ページで測った1件の最大は8,914字。
const MAX_STRUCTURED_EVIDENCE_LENGTH = 24_000;
const MAX_JSON_LD_DOCUMENTS = 5;

/**
 * ページを1回だけパースし、markdown・構造化証拠・タイトル・画像候補を同じ木から作る。
 * テキストはどれも`renderHtmlText`の同じ規則で作るので、経路ごとに文字や区切りがずれない。
 */
export const extractRecipePageEvidence = async (
  page: FetchedImportPage,
  baseUrl: string,
): Promise<RecipePageEvidence> => {
  const document = parseHtmlDocument(await readImportPageHtml(page));
  const imageRegistry = new ImportImageRegistry(baseUrl);
  const meta = extractMeta(document, imageRegistry);
  const markdownContent = renderHtmlText(document, {
    format: "markdown",
    renderImage: (element) => {
      const alt = getHtmlAttribute(element, "alt");
      const candidate = imageRegistry.getOrCreate(
        getHtmlAttribute(element, "src") ?? getHtmlAttribute(element, "data-src"),
        alt,
      );
      return candidate ? formatMarkdownImage(candidate.url, alt) : undefined;
    },
  }).slice(0, MAX_MARKDOWN_CONTENT_LENGTH);
  const recipeStructuredEvidence = takeRecipesWithinLength(
    dedupeRecipeStructuredEvidence([
      ...extractRecipeJsonLdEvidence(document, baseUrl),
      ...extractRecipeHtmlStructuredEvidence(document, baseUrl),
    ]),
  );

  return {
    title: extractDocumentTitle(document),
    meta,
    markdownContent,
    recipeStructuredEvidence: buildImportStructuredEvidence(
      recipeStructuredEvidence,
      imageRegistry,
    ),
    imageCandidates: imageRegistry.candidates,
  };
};

const readImportPageHtml = async (page: FetchedImportPage) =>
  typeof page.body === "string" ? page.body : page.body.clone().text();

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
    // 下書きの外部画像はhttp(s)しか受け付けないので、それ以外のURLは候補にしない。
    const url = resolveHttpUrl(rawUrl, this.#baseUrl);
    if (!url) return undefined;

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

const resolveHttpUrl = (rawUrl: string | undefined, baseUrl: string | undefined) => {
  if (!rawUrl) return undefined;

  try {
    const url = new URL(rawUrl, baseUrl || undefined);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

// ブラウザのdocument.titleと同じく、最初のHTMLのtitleだけを使う。SVGのtitleは名前空間が違うので入らない。
const extractDocumentTitle = (document: HtmlDocument) => {
  let title: HtmlElement | undefined;
  forEachHtmlElement(document, (element) => {
    if (!title && element.tagName === "title") title = element;
  });

  return title ? normalizeSingleLineText(getHtmlTextContent(title)) : "";
};

const META_KEYS = new Set([
  "description",
  "og:title",
  "og:description",
  "og:site_name",
  "og:image",
  "twitter:title",
  "twitter:description",
  "twitter:image",
]);

const extractMeta = (document: HtmlDocument, imageRegistry: ImportImageRegistry) => {
  const meta: Record<string, string | undefined> = {};

  forEachHtmlElement(document, (element) => {
    if (element.tagName !== "meta") return;

    const key = (getHtmlAttribute(element, "property") ?? getHtmlAttribute(element, "name"))
      ?.toLowerCase()
      .trim();
    const content = normalizeSingleLineText(getHtmlAttribute(element, "content") ?? "");
    if (!key || !META_KEYS.has(key) || !content || meta[key]) return;

    meta[key] = content;
    if (key === "og:image" || key === "twitter:image") {
      imageRegistry.getOrCreate(content);
    }
  });

  return meta;
};

const normalizeImageAlt = (value: string) => normalizeSingleLineText(value).slice(0, 120);

const formatMarkdownImage = (url: string, alt?: string) => {
  const normalizedAlt = alt ? normalizeImageAlt(alt) : "";
  return `![${escapeMarkdownImageAlt(normalizedAlt)}](<${url}>)`;
};

const escapeMarkdownImageAlt = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

// ---- microdata / RDFa ----

type RecipeStructuredProperty = keyof Pick<
  ExtractedRecipeStructuredEvidence,
  "name" | "yieldText" | "imageUrls" | "rawIngredients" | "rawInstructions"
>;

const extractRecipeHtmlStructuredEvidence = (
  document: HtmlDocument,
  baseUrl: string,
): ExtractedRecipeStructuredEvidence[] => {
  const recipes: ExtractedRecipeStructuredEvidence[] = [];
  const appendStructuredEvidence = (builder: ExtractedRecipeStructuredEvidence) => {
    const evidence = normalizeRecipeStructuredEvidence(builder);
    if (evidence) recipes.push(evidence);
  };

  const visit = (
    parent: HtmlDocument | HtmlElement,
    microdataRecipe: ExtractedRecipeStructuredEvidence | undefined,
    rdfaRecipe: ExtractedRecipeStructuredEvidence | undefined,
  ) => {
    for (const element of parent.childNodes) {
      if (!isHtmlElement(element)) continue;

      const ownMicrodataRecipe = isMicrodataRecipeScope(element)
        ? createRecipeStructuredEvidenceBuilder("microdata")
        : undefined;
      const ownRdfaRecipe = hasSchemaRecipeType(getHtmlAttribute(element, "typeof"))
        ? createRecipeStructuredEvidenceBuilder("rdfa")
        : undefined;
      const currentMicrodataRecipe = ownMicrodataRecipe ?? microdataRecipe;
      const currentRdfaRecipe = ownRdfaRecipe ?? rdfaRecipe;

      captureRecipeStructuredProperties(element, currentMicrodataRecipe, "itemprop", baseUrl);
      captureRecipeStructuredProperties(element, currentRdfaRecipe, "property", baseUrl);
      visit(element, currentMicrodataRecipe, currentRdfaRecipe);

      if (ownMicrodataRecipe) appendStructuredEvidence(ownMicrodataRecipe);
      if (ownRdfaRecipe) appendStructuredEvidence(ownRdfaRecipe);
    }
  };
  visit(document, undefined, undefined);

  return dedupeRecipeStructuredEvidence(recipes);
};

const isMicrodataRecipeScope = (element: HtmlElement) =>
  getHtmlAttribute(element, "itemscope") !== undefined &&
  hasSchemaRecipeType(getHtmlAttribute(element, "itemtype"));

const createRecipeStructuredEvidenceBuilder = (
  format: ExtractedRecipeStructuredEvidence["format"],
): ExtractedRecipeStructuredEvidence => ({
  format,
  imageUrls: [],
  rawIngredients: [],
  rawInstructions: [],
  structuredInstructions: [],
});

const captureRecipeStructuredProperties = (
  element: HtmlElement,
  builder: ExtractedRecipeStructuredEvidence | undefined,
  attributeName: "itemprop" | "property",
  baseUrl: string,
) => {
  if (!builder) return;

  const properties = normalizeRecipeStructuredProperties(getHtmlAttribute(element, attributeName));
  if (properties.length === 0) return;

  const attributeValue = extractStructuredElementValue(element);
  if (attributeValue) {
    appendRecipeStructuredValue(builder, properties, attributeValue, baseUrl);
    return;
  }

  const text = renderHtmlText(element, { format: "plain" });
  if (text) {
    appendRecipeStructuredValue(builder, properties, text, "");
  }
};

const extractStructuredElementValue = (element: HtmlElement) => {
  for (const attribute of ["content", "src", "href", "data", "value", "datetime"]) {
    const value = normalizeSingleLineText(getHtmlAttribute(element, attribute) ?? "");
    if (value) return value;
  }

  return undefined;
};

const appendRecipeStructuredValue = (
  builder: ExtractedRecipeStructuredEvidence,
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
      const imageUrl = resolveHttpUrl(value, baseUrl);
      if (imageUrl) builder.imageUrls.push(imageUrl);
    } else if (property === "rawIngredients") {
      builder.rawIngredients.push(value);
    } else if (property === "rawInstructions") {
      builder.rawInstructions.push(value);
    }
  }
};

const normalizeRecipeStructuredEvidence = (
  builder: ExtractedRecipeStructuredEvidence,
): ExtractedRecipeStructuredEvidence | undefined => {
  const evidence = {
    format: builder.format,
    name: builder.name ? normalizeSingleLineText(builder.name) || undefined : undefined,
    yieldText: builder.yieldText
      ? normalizeSingleLineText(builder.yieldText) || undefined
      : undefined,
    imageUrls: dedupeStrings(builder.imageUrls),
    rawIngredients: dedupeStrings(builder.rawIngredients.filter(Boolean)),
    rawInstructions: dedupeStrings(builder.rawInstructions.filter(Boolean)),
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

const normalizeRecipeStructuredProperties = (
  value: string | undefined,
): RecipeStructuredProperty[] => {
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

const hasSchemaRecipeType = (value: string | undefined) =>
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

const splitHtmlTokens = (value: string | undefined) => (value ? value.trim().split(/\s+/) : []);

// ---- JSON-LD ----

const extractRecipeJsonLdEvidence = (
  document: HtmlDocument,
  baseUrl: string,
): ExtractedRecipeStructuredEvidence[] => {
  const recipes: ExtractedRecipeStructuredEvidence[] = [];
  const seen = new Set<string>();

  for (const source of collectJsonLdSources(document)) {
    let value: unknown;
    try {
      value = parseJsonLd(source);
    } catch {
      continue;
    }

    for (const node of collectRecipeJsonLdNodes(value)) {
      const recipe = normalizeRecipeJsonLdNode(node, baseUrl);
      const key = JSON.stringify(recipe);
      if (seen.has(key)) continue;

      seen.add(key);
      recipes.push(recipe);
    }
  }

  return recipes;
};

// scriptの中身は文字参照を戻さない生のテキストなので、そのままJSONとして読む。
const collectJsonLdSources = (document: HtmlDocument) => {
  const sources: string[] = [];

  forEachHtmlElement(document, (element) => {
    if (element.tagName !== "script" || sources.length >= MAX_JSON_LD_DOCUMENTS) return;

    const type = getHtmlAttribute(element, "type")?.toLowerCase().replace(/\s+/g, "");
    const source = getHtmlTextContent(element).trim();
    if (type === "application/ld+json" && source) sources.push(source);
  });

  return sources;
};

// 文字列の中に生の改行を入れるページがある（ミツカン）。文字列の外では改行やタブはJSONの空白と同じなので、
// 空白にしてから読む。
const parseJsonLd = (source: string): unknown => JSON.parse(source.replace(/[\t\n\r]+/g, " "));

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
    name: firstJsonLdLine(record.name),
    yieldText: firstJsonLdLine(record.recipeYield),
    imageUrls: extractJsonLdImageUrls(record.image, baseUrl),
    rawIngredients: extractJsonLdTexts(record.recipeIngredient),
    rawInstructions: structuredInstructions.map((instruction) => instruction.text),
    structuredInstructions,
  };
};

const isJsonLdRecipeNode = (record: Record<string, unknown>): boolean => {
  const type = record["@type"];
  const typeValues = Array.isArray(type) ? type : [type];
  return typeValues.some((entry) => typeof entry === "string" && entry.toLowerCase() === "recipe");
};

// JSON-LDの文字列は本来テキストだが、HTMLのタグや文字参照をそのまま書くページがある（Nadiaの手順のリンクなど）。
// テキストをHTMLとして読むと文字が消える（グループの印の`<A>`、`x<y`の後ろ）ので、HTMLとして読むのは、
// 終了タグか<br>があって作り手がHTMLを書いたと分かる文字列だけにする。それ以外の`<`は文字として残す。
// どちらもページの本文と同じ規則でテキストにする。
const JSON_LD_HTML_PATTERN = /<\/[a-z]|<br\b/i;

const toJsonLdText = (value: string) =>
  renderHtmlFragmentText(JSON_LD_HTML_PATTERN.test(value) ? value : value.replaceAll("<", "&lt;"));

const collectJsonLdStrings = (value: unknown): string[] => {
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
  return texts;
};

const extractJsonLdTexts = (value: unknown) =>
  dedupeStrings(collectJsonLdStrings(value).map(toJsonLdText).filter(Boolean));

const firstJsonLdLine = (value: unknown) =>
  collectJsonLdStrings(value)
    .map((text) => normalizeSingleLineText(toJsonLdText(text)))
    .find(Boolean);

const extractJsonLdStructuredInstructions = (
  value: unknown,
  baseUrl: string,
): ExtractedRecipeStructuredInstruction[] => {
  const instructions: ExtractedRecipeStructuredInstruction[] = [];
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const text = toJsonLdText(node);
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
      const normalizedText = toJsonLdText(text);
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

  for (const instruction of instructions) {
    let imageUrls = byText.get(instruction.text);
    if (!imageUrls) {
      imageUrls = new Set<string>();
      byText.set(instruction.text, imageUrls);
    }

    for (const imageUrl of instruction.imageUrls) {
      imageUrls.add(imageUrl);
    }
  }

  return [...byText].map(([text, imageUrls]) => ({ text, imageUrls: [...imageUrls] }));
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
  // URLに`&amp;`のような文字参照を書くページがあるので、属性値と同じ規則で戻す。
  return dedupeStrings(
    urls.flatMap((rawUrl) => resolveHttpUrl(decodeHtmlAttribute(rawUrl), baseUrl) ?? []),
  );
};

// ---- 共通 ----

// 材料や手順の一部だけを残すと誤った証拠になるので、レシピの途中では切らない。
// 上限を超えたレシピから後ろを落とす。1件目まで落とすと構造化証拠がなくなるので、1件目は長さにかかわらず残す。
const takeRecipesWithinLength = (recipes: ExtractedRecipeStructuredEvidence[]) => {
  const kept: ExtractedRecipeStructuredEvidence[] = [];
  let length = 0;

  for (const recipe of recipes) {
    length += JSON.stringify(recipe).length;
    if (kept.length > 0 && length > MAX_STRUCTURED_EVIDENCE_LENGTH) break;

    kept.push(recipe);
  }

  return kept;
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
) =>
  normalizeSingleLineText([recipe.name, instruction.text].filter(Boolean).join(" ")).slice(0, 160);

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

const dedupeStrings = (values: string[]) => [...new Set(values)];
