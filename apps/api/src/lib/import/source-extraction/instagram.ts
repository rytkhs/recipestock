import { RecipeImportError } from "../types";
import { type SourceExtractionAdapter, type SourceExtractionMatchInput } from "./types";

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const INSTAGRAM_SHORTCODE = /^[A-Za-z0-9_-]+$/;

type InstagramMediaKind = "post" | "reel";

type InstagramSource = {
  canonicalUrl: string;
  shortcode: string;
  mediaKind: InstagramMediaKind;
};

export const instagramSourceExtractionAdapter: SourceExtractionAdapter = {
  id: "instagram",

  match(input: SourceExtractionMatchInput) {
    return getInstagramSource(input.normalizedUrl) !== null;
  },

  async extract() {
    throw new RecipeImportError(
      "extraction_failed",
      "Instagram source extraction is not implemented yet.",
    );
  },
};

export const getInstagramSource = (rawUrl: string): InstagramSource | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!INSTAGRAM_HOSTS.has(url.hostname)) return null;
  if (url.port || url.username || url.password) return null;

  const pathnameParts = url.pathname.split("/").filter(Boolean);
  if (pathnameParts.length !== 2) return null;

  const [route, shortcode] = pathnameParts;
  if (route !== "p" && route !== "reel") return null;
  if (!INSTAGRAM_SHORTCODE.test(shortcode)) return null;

  const source = {
    shortcode,
    mediaKind: route === "reel" ? "reel" : "post",
  } satisfies Omit<InstagramSource, "canonicalUrl">;

  return {
    ...source,
    canonicalUrl: createInstagramCanonicalUrl(source),
  };
};

export const createInstagramCanonicalUrl = ({
  shortcode,
  mediaKind,
}: Omit<InstagramSource, "canonicalUrl">) => {
  const route = mediaKind === "reel" ? "reel" : "p";
  return `https://www.instagram.com/${route}/${encodeURIComponent(shortcode)}/`;
};
