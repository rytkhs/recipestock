import { type FetchedImportPage, RecipeImportError } from "../types";
import {
  type SourceExtractionAdapter,
  type SourceExtractionContext,
  type SourceExtractionMatchInput,
} from "./types";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PAGE_ID = "youtube_thumbnail";

type YouTubePlayerResponse = {
  videoDetails?: {
    videoId?: unknown;
    title?: unknown;
    shortDescription?: unknown;
    author?: unknown;
    lengthSeconds?: unknown;
    isLiveContent?: unknown;
    thumbnail?: {
      thumbnails?: unknown;
    };
  };
};

type YouTubeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

export const youtubeSourceExtractionAdapter: SourceExtractionAdapter = {
  id: "youtube",

  match(input: SourceExtractionMatchInput) {
    return getYouTubeVideoId(input.normalizedUrl) !== null;
  },

  async extract(context: SourceExtractionContext) {
    const videoId = getYouTubeVideoId(context.normalizedUrl);
    if (!videoId) {
      throw new RecipeImportError("invalid_url", "YouTube URL is invalid.");
    }

    const canonicalUrl = createYouTubeCanonicalUrl(videoId);
    const page = await context.fetchHtml(canonicalUrl);
    const html = await readFetchedPageText(page);
    const playerResponse = extractYouTubePlayerResponse(html);
    const videoDetails = playerResponse.videoDetails;
    if (!videoDetails || typeof videoDetails !== "object") {
      throw new RecipeImportError(
        "extraction_failed",
        "YouTube video details could not be extracted.",
      );
    }

    const extractedVideoId = normalizeString(videoDetails.videoId);
    if (extractedVideoId && extractedVideoId !== videoId) {
      throw new RecipeImportError(
        "extraction_failed",
        "YouTube video identity could not be verified.",
      );
    }

    const title = normalizeString(videoDetails.title);
    if (!title) {
      throw new RecipeImportError(
        "extraction_failed",
        "YouTube video title could not be extracted.",
      );
    }

    const description = normalizeString(videoDetails.shortDescription);
    const author = normalizeString(videoDetails.author);
    const thumbnail = selectBestYouTubeThumbnail(videoDetails.thumbnail?.thumbnails);
    const imageCandidates = thumbnail
      ? [
          {
            id: YOUTUBE_PAGE_ID,
            url: thumbnail.url,
            alt: `${title} thumbnail`,
            position: 0,
          },
        ]
      : [];

    return {
      promptProfile: "social",
      input: {
        source: {
          finalUrl: canonicalUrl,
          host: "youtube.com",
        },
        markdownContent: buildYouTubeMarkdownContent({
          title,
          author,
          description,
        }),
      },
      imageCandidates,
      ...(thumbnail
        ? {
            imagePlacement: {
              coverImageUrl: thumbnail.url,
              referenceImageUrls: [],
            },
          }
        : {}),
      source: {
        sourceUrl: canonicalUrl,
        sourceName: "YouTube",
      },
      warnings: [],
    };
  },
};

export const getYouTubeVideoId = (rawUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.port || url.username || url.password) return null;

  if (YOUTUBE_SHORT_HOSTS.has(url.hostname)) {
    return normalizeYouTubeVideoId(url.pathname.split("/").filter(Boolean)[0]);
  }

  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  const pathnameParts = url.pathname.split("/").filter(Boolean);
  if (pathnameParts[0] === "shorts") {
    return normalizeYouTubeVideoId(pathnameParts[1]);
  }

  if (url.pathname === "/watch") {
    return normalizeYouTubeVideoId(url.searchParams.get("v"));
  }

  return null;
};

export const createYouTubeCanonicalUrl = (videoId: string) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

const normalizeYouTubeVideoId = (value: string | null | undefined) => {
  if (!value || !YOUTUBE_VIDEO_ID.test(value)) return null;
  return value;
};

const readFetchedPageText = async (page: FetchedImportPage) => {
  if (typeof page.body === "string") return page.body;
  return page.body.text();
};

const extractYouTubePlayerResponse = (html: string): YouTubePlayerResponse => {
  const assignmentMarkers = [
    "ytInitialPlayerResponse =",
    "ytInitialPlayerResponse=",
    "window.ytInitialPlayerResponse =",
    "window.ytInitialPlayerResponse=",
  ];

  for (const marker of assignmentMarkers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) continue;

    const jsonStart = html.indexOf("{", markerIndex + marker.length);
    const jsonText = jsonStart >= 0 ? extractBalancedJsonObject(html, jsonStart) : null;
    if (!jsonText) continue;

    try {
      return JSON.parse(jsonText) as YouTubePlayerResponse;
    } catch {}
  }

  throw new RecipeImportError(
    "extraction_failed",
    "YouTube player response could not be extracted.",
  );
};

const extractBalancedJsonObject = (text: string, startIndex: number): string | null => {
  if (text[startIndex] !== "{") return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
};

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const selectBestYouTubeThumbnail = (value: unknown): YouTubeThumbnail | undefined => {
  if (!Array.isArray(value)) return undefined;

  const thumbnails = value.flatMap((thumbnail): YouTubeThumbnail[] => {
    if (!thumbnail || typeof thumbnail !== "object") return [];
    const record = thumbnail as Record<string, unknown>;
    const url = normalizeString(record.url);
    if (!url) return [];

    return [
      {
        url,
        width: typeof record.width === "number" ? record.width : undefined,
        height: typeof record.height === "number" ? record.height : undefined,
      },
    ];
  });

  return thumbnails.sort((left, right) => thumbnailArea(right) - thumbnailArea(left))[0];
};

const thumbnailArea = (thumbnail: YouTubeThumbnail) =>
  Math.max(0, thumbnail.width ?? 0) * Math.max(0, thumbnail.height ?? 0);

const buildYouTubeMarkdownContent = ({
  title,
  author,
  description,
}: {
  title: string;
  author: string;
  description: string;
}) => {
  const lines = [`# ${title}`, "", "Source: YouTube"];
  if (author) lines.push(`Channel: ${author}`);
  if (description) lines.push("", "## Description", "", description);

  return lines.join("\n").trim();
};
