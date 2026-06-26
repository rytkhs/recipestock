import { type YtDlpMetadata, YtDlpMetadataError } from "../../../ytdlp-metadata";
import { RecipeImportError, type RecipeImportImageCandidate } from "../types";
import {
  type SourceExtractionAdapter,
  type SourceExtractionContext,
  type SourceExtractionMatchInput,
} from "./types";

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const INSTAGRAM_SHORTCODE = /^[A-Za-z0-9_-]+$/;
const INSTAGRAM_SOURCE_NAME = "Instagram";

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

  async extract(context: SourceExtractionContext) {
    const source = getInstagramSource(context.normalizedUrl);
    if (!source) {
      throw new RecipeImportError("invalid_url", "Instagram URL is invalid.");
    }

    if (!context.ytdlpMetadataClient) {
      throw new RecipeImportError("unknown", "yt-dlp metadata client is not configured.");
    }

    let extracted: YtDlpMetadata;
    try {
      extracted = await context.ytdlpMetadataClient.extract({
        platform: "instagram",
        url: source.canonicalUrl,
        timeoutMs: context.timeoutMs,
      });
    } catch (error) {
      throw mapYtDlpMetadataError(error);
    }

    assertExtractedSourceMatchesInput(source, extracted);

    const title = normalizeString(extracted.metadata.title) || "Instagram post";
    const author = normalizeString(extracted.metadata.uploader);
    const caption = normalizeString(extracted.metadata.description);
    if (!caption) {
      throw new RecipeImportError("extraction_failed", "Instagram caption could not be extracted.");
    }

    const imageCandidates = buildInstagramImageCandidates(extracted.images, title);

    return {
      input: {
        source: {
          finalUrl: source.canonicalUrl,
          host: "instagram.com",
        },
        markdownContent: buildInstagramMarkdownContent({
          title,
          author,
          canonicalUrl: source.canonicalUrl,
          caption,
          imageUrls: imageCandidates.map((candidate) => candidate.url),
        }),
        recipeStructuredEvidence: [],
      },
      imageCandidates,
      source: {
        sourceUrl: source.canonicalUrl,
        sourceName: INSTAGRAM_SOURCE_NAME,
      },
      warnings: [],
    };
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

const assertExtractedSourceMatchesInput = (source: InstagramSource, extracted: YtDlpMetadata) => {
  if (
    extracted.source.canonicalUrl !== source.canonicalUrl ||
    extracted.source.shortcode !== source.shortcode ||
    extracted.source.mediaKind !== source.mediaKind
  ) {
    throw new RecipeImportError(
      "extraction_failed",
      "Instagram metadata identity could not be verified.",
    );
  }
};

const normalizeString = (value: string | null | undefined) => value?.trim() ?? "";

const buildInstagramImageCandidates = (images: YtDlpMetadata["images"], title: string) => {
  const seenUrls = new Set<string>();
  const candidates: RecipeImportImageCandidate[] = [];

  for (const image of images) {
    if (seenUrls.has(image.url)) continue;
    seenUrls.add(image.url);

    const position = candidates.length;
    candidates.push({
      id: `instagram_image_${position}`,
      url: image.url,
      alt: `${title} image ${position + 1}`,
      position,
    });
  }

  return candidates;
};

const buildInstagramMarkdownContent = ({
  title,
  author,
  canonicalUrl,
  caption,
  imageUrls,
}: {
  title: string;
  author: string;
  canonicalUrl: string;
  caption: string;
  imageUrls: string[];
}) => {
  const lines = [`# ${title}`, "", `Source: ${INSTAGRAM_SOURCE_NAME}`, `URL: ${canonicalUrl}`];
  if (author) lines.push(`Author: ${author}`);
  lines.push("", "## Caption", "", caption);

  if (imageUrls.length > 0) {
    lines.push("", "## Images", "");
    for (const [index, imageUrl] of imageUrls.entries()) {
      lines.push(`![Instagram image ${index + 1}](<${imageUrl}>)`);
    }
  }

  return lines.join("\n").trim();
};

const mapYtDlpMetadataError = (error: unknown) => {
  if (!(error instanceof YtDlpMetadataError)) return error;

  if (error.code === "invalid_request") {
    return new RecipeImportError("invalid_url", "Instagram URL is invalid.");
  }

  if (error.code === "timeout") {
    return new RecipeImportError("fetch_failed", "Instagram metadata extraction timed out.");
  }

  if (error.code === "private_or_login_required") {
    return new RecipeImportError(
      "private_or_login_required",
      "Instagram post is private, unavailable, or requires login.",
    );
  }

  return new RecipeImportError("extraction_failed", error.message);
};
