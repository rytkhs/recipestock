import { type FetchedImportPage, RecipeImportError } from "../types";
import {
  type SourceExtractionAdapter,
  type SourceExtractionContext,
  type SourceExtractionMatchInput,
} from "./types";

const X_TWITTER_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com"]);
const X_TWITTER_STATUS_ID = /^[0-9]+$/;
const X_TWITTER_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const X_TWITTER_SUFFIX_ROUTES = new Set(["photo", "video"]);
const X_SOURCE_NAME = "X";

type XTwitterSource =
  | {
      canonicalUrl: string;
      statusId: string;
      username: string;
      kind: "userStatus";
    }
  | {
      canonicalUrl: string;
      statusId: string;
      kind: "webStatus";
    };

type XTwitterMedia = {
  url: string;
  kind: "image" | "videoThumbnail";
};

type XTwitterCanonicalSource =
  | {
      statusId: string;
      username: string;
      kind: "userStatus";
    }
  | {
      statusId: string;
      kind: "webStatus";
    };

export const xTwitterSourceExtractionAdapter: SourceExtractionAdapter = {
  id: "x-twitter",

  match(input: SourceExtractionMatchInput) {
    return getXTwitterSource(input.normalizedUrl) !== null;
  },

  async extract(context: SourceExtractionContext) {
    const source = getXTwitterSource(context.normalizedUrl);
    if (!source) {
      throw new RecipeImportError("invalid_url", "X/Twitter URL is invalid.");
    }

    const page = await context.fetchHtml(source.canonicalUrl);
    const html = await readFetchedPageText(page);
    const meta = extractMeta(html);
    const primaryPostText = normalizePostText(meta["og:description"] ?? meta.description);
    if (!primaryPostText && isPrivateOrUnavailableHtml(html)) {
      throw new RecipeImportError(
        "private_or_login_required",
        "X/Twitter post is private, unavailable, or requires login.",
      );
    }

    const postText = primaryPostText || normalizePostText(meta["twitter:description"]);
    if (!postText) {
      throw new RecipeImportError(
        "extraction_failed",
        "X/Twitter post text could not be extracted.",
      );
    }

    const media = extractXTwitterMedia(html);
    const imageCandidates = media.map((item, index) => ({
      id: item.kind === "image" ? `x_image_${index}` : `x_video_thumbnail_${index}`,
      url: item.url,
      alt:
        item.kind === "image" ? `X post image ${index + 1}` : `X post video thumbnail ${index + 1}`,
      position: index,
    }));
    const imageUrls = media.filter((item) => item.kind === "image").map((item) => item.url);
    const firstVideoThumbnail = media.find((item) => item.kind === "videoThumbnail")?.url;
    const coverImageUrl = imageUrls[0] ?? firstVideoThumbnail;
    const sourceMediaUrls = imageUrls.length > 0 ? imageUrls : [];

    return {
      input: {
        source: {
          finalUrl: source.canonicalUrl,
          host: "x.com",
        },
        markdownContent: buildXTwitterMarkdownContent(postText),
        recipeStructuredEvidence: [],
      },
      imageCandidates,
      ...(coverImageUrl || sourceMediaUrls.length > 0
        ? {
            imagePlacement: {
              ...(coverImageUrl ? { coverImageUrl } : {}),
              sourceMediaUrls,
            },
          }
        : {}),
      source: {
        sourceUrl: source.canonicalUrl,
        sourceName: X_SOURCE_NAME,
      },
      warnings: [],
    };
  },
};

export const getXTwitterSource = (rawUrl: string): XTwitterSource | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!X_TWITTER_HOSTS.has(url.hostname)) return null;
  if (url.port || url.username || url.password) return null;

  const pathnameParts = url.pathname.split("/").filter(Boolean);

  if (pathnameParts[0] === "i" && pathnameParts[1] === "web" && pathnameParts[2] === "status") {
    const statusId = normalizeStatusId(pathnameParts[3]);
    if (!statusId || !hasValidStatusSuffix(pathnameParts.slice(4))) return null;

    return {
      canonicalUrl: createXTwitterCanonicalUrl({ statusId, kind: "webStatus" }),
      statusId,
      kind: "webStatus",
    };
  }

  const username = pathnameParts[0];
  if (!username || !X_TWITTER_USERNAME.test(username)) return null;
  if (pathnameParts[1] !== "status") return null;

  const statusId = normalizeStatusId(pathnameParts[2]);
  if (!statusId || !hasValidStatusSuffix(pathnameParts.slice(3))) return null;

  return {
    canonicalUrl: createXTwitterCanonicalUrl({ username, statusId, kind: "userStatus" }),
    username,
    statusId,
    kind: "userStatus",
  };
};

export const createXTwitterCanonicalUrl = (source: XTwitterCanonicalSource) => {
  if (source.kind === "webStatus") {
    return `https://x.com/i/web/status/${encodeURIComponent(source.statusId)}`;
  }

  return `https://x.com/${encodeURIComponent(source.username)}/status/${encodeURIComponent(
    source.statusId,
  )}`;
};

const normalizeStatusId = (value: string | undefined) =>
  value && X_TWITTER_STATUS_ID.test(value) ? value : null;

const hasValidStatusSuffix = (parts: string[]) => {
  if (parts.length === 0) return true;
  if (parts.length !== 2) return false;

  return X_TWITTER_SUFFIX_ROUTES.has(parts[0] ?? "") && /^[1-9][0-9]*$/.test(parts[1] ?? "");
};

const readFetchedPageText = async (page: FetchedImportPage) => {
  if (typeof page.body === "string") return page.body;
  return page.body.text();
};

const extractMeta = (html: string): Record<string, string | undefined> => {
  const meta: Record<string, string | undefined> = {};
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metaTags) {
    const key = normalizeMetaKey(
      getHtmlAttribute(tag, "property") ?? getHtmlAttribute(tag, "name"),
    );
    const content = getHtmlAttribute(tag, "content");
    if (!key || !content || meta[key]) continue;

    meta[key] = decodeHtml(content);
  }

  return meta;
};

const getHtmlAttribute = (tag: string, name: string) => {
  const quotedPattern = new RegExp(`\\s${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const quotedMatch = quotedPattern.exec(tag);
  if (quotedMatch?.[2] !== undefined) return quotedMatch[2];

  const unquotedPattern = new RegExp(`\\s${name}\\s*=\\s*([^\\s"'=<>\`]+)`, "i");
  return unquotedPattern.exec(tag)?.[1];
};

const normalizeMetaKey = (value: string | undefined) => value?.trim().toLowerCase();

const extractXTwitterMedia = (html: string): XTwitterMedia[] => {
  const normalizedHtml = decodeHtml(html)
    .replace(/\\\//g, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003F/gi, "?")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003D/gi, "=");
  const mediaUrlPattern =
    /https:\/\/pbs\.twimg\.com\/(?:media|amplify_video_thumb)\/[^\s"'<>\\)]+/g;
  const seenUrls = new Set<string>();
  const media: XTwitterMedia[] = [];

  for (const match of normalizedHtml.matchAll(mediaUrlPattern)) {
    const item = normalizeXTwitterMediaUrl(match[0]);
    if (!item || seenUrls.has(item.url)) continue;

    seenUrls.add(item.url);
    media.push(item);
  }

  return media;
};

const normalizeXTwitterMediaUrl = (rawUrl: string): XTwitterMedia | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") return null;

  if (url.pathname.startsWith("/media/")) {
    return { url: url.toString(), kind: "image" };
  }

  if (url.pathname.startsWith("/amplify_video_thumb/")) {
    return { url: url.toString(), kind: "videoThumbnail" };
  }

  return null;
};

const normalizePostText = (value: string | undefined) => {
  if (!value) return "";

  return decodeHtml(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const decodeHtml = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (_entity, body: string) => {
    const normalized = body.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos" || normalized === "#39") return "'";
    if (normalized.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }

    if (normalized.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }

    return _entity;
  });

const isPrivateOrUnavailableHtml = (html: string) => {
  const text = decodeHtml(html).toLowerCase();

  return (
    text.includes("this post is unavailable") ||
    text.includes("this account's posts are protected") ||
    text.includes("these posts are protected") ||
    text.includes("log in to x") ||
    text.includes("sign in to x") ||
    text.includes("you’re unable to view this post") ||
    text.includes("you're unable to view this post")
  );
};

const buildXTwitterMarkdownContent = (postText: string) =>
  ["# X post", "", postText].join("\n").trim();
