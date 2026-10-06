import {
  decodeHtmlAttribute,
  decodeHtmlText,
  normalizeMultilineText,
  normalizeSingleLineText,
} from "../text";
import { type FetchedImportPage } from "../types";

export type HtmlRewriterElement = Parameters<
  NonNullable<HTMLRewriterElementContentHandlers["element"]>
>[0];

// HTMLRewriterは本文も属性値も文字参照を戻さずに渡すので、ページに表示される文字に戻してから使う。
export const normalizeHtmlText = (value: string) => normalizeSingleLineText(decodeHtmlText(value));

export const normalizeHtmlMultilineText = (value: string) =>
  normalizeMultilineText(decodeHtmlText(value));

export const getHtmlAttribute = (element: HtmlRewriterElement, name: string) => {
  const value = element.getAttribute(name);
  return value === null ? null : decodeHtmlAttribute(value);
};

/**
 * 画像や出典のURLはhttp(s)の絶対URLにする。相対URLはページのURLを基準に解決し、それ以外は捨てる。
 */
export const resolveHttpUrl = (rawUrl: unknown, baseUrl: string) => {
  if (typeof rawUrl !== "string" || !rawUrl) return undefined;

  try {
    const url = new URL(rawUrl, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export const importPageBodyToResponse = (page: FetchedImportPage) => {
  if (typeof page.body !== "string") return page.body.clone();

  return new Response(page.body, {
    headers: page.contentType ? { "content-type": page.contentType } : undefined,
  });
};

export const removeCapture = <T>(stack: T[], capture: T) => {
  const index = stack.lastIndexOf(capture);
  if (index >= 0) stack.splice(index, 1);
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const collectJsonLdRecipeNodes = (value: unknown): Record<string, unknown>[] => {
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
