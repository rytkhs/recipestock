import { isHttpFetchUrlAllowed } from "../../url-safety";
import { type FetchedImportPage, RecipeImportError } from "./types";

const HTML_SNIFF_BYTES = 4 * 1024;
const HTML_MARKER_PATTERN = /<!doctype\s+html\b|<html\b|<head\b|<body\b/i;

export const assertImportUrlAllowed = (sourceUrl: string) => {
  if (!isHttpFetchUrlAllowed(sourceUrl)) {
    throw new RecipeImportError("invalid_url", "Import URL is invalid.");
  }
};

export const assertImportContentTypeMayBeHtml = (contentType: string) => {
  if (classifyImportContentType(contentType) === "unsupported") {
    throwUnsupportedPage();
  }
};

export const assertFetchedPageIsHtml = async (page: FetchedImportPage) => {
  const contentTypeClassification = classifyImportContentType(page.contentType);
  if (contentTypeClassification === "html") return;
  if (contentTypeClassification === "unsupported") {
    throwUnsupportedPage();
  }

  const prefix = await readBodyPrefix(page.body);
  if (!HTML_MARKER_PATTERN.test(prefix)) {
    throwUnsupportedPage();
  }
};

const classifyImportContentType = (contentType: string): "html" | "ambiguous" | "unsupported" => {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    return "html";
  }
  if (mediaType === "" || mediaType === "text/plain" || mediaType === "application/octet-stream") {
    return "ambiguous";
  }

  return "unsupported";
};

const readBodyPrefix = async (body: FetchedImportPage["body"]) => {
  if (typeof body === "string") {
    const bytes = new TextEncoder().encode(body);
    return new TextDecoder().decode(bytes.slice(0, HTML_SNIFF_BYTES));
  }

  const response = body.clone();
  if (!response.body) {
    const bytes = new TextEncoder().encode(await response.text());
    return new TextDecoder().decode(bytes.slice(0, HTML_SNIFF_BYTES));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let remainingBytes = HTML_SNIFF_BYTES;

  try {
    while (remainingBytes > 0) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value.slice(0, remainingBytes);
      chunks.push(chunk);
      remainingBytes -= chunk.byteLength;
    }

    if (remainingBytes === 0) {
      void reader.cancel();
    }
  } finally {
    reader.releaseLock();
  }

  const prefixBytes = new Uint8Array(HTML_SNIFF_BYTES - remainingBytes);
  let offset = 0;
  for (const chunk of chunks) {
    prefixBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(prefixBytes);
};

const throwUnsupportedPage = (): never => {
  throw new RecipeImportError("unsupported_page", "Import URL is not an HTML page.");
};
