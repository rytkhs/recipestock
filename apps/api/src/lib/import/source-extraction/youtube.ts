import { RecipeImportError } from "../types";
import {
  type SourceExtractionAdapter,
  type SourceExtractionContext,
  type SourceExtractionMatchInput,
} from "./types";
import { type YouTubeThumbnail } from "./youtube-data";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PAGE_ID = "youtube_thumbnail";

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
    if (!context.youtubeDataClient) {
      throw new RecipeImportError(
        "extraction_failed",
        "YouTube Data API client is not configured.",
      );
    }

    const video = await context.youtubeDataClient.getVideo({
      videoId,
      timeoutMs: context.timeoutMs,
    });
    if (!video) {
      throw new RecipeImportError(
        "extraction_failed",
        "YouTube video details could not be extracted.",
      );
    }

    if (video.videoId !== videoId) {
      throw new RecipeImportError(
        "extraction_failed",
        "YouTube video identity could not be verified.",
      );
    }

    const title = video.title.trim();
    if (!title) {
      throw new RecipeImportError(
        "extraction_failed",
        "YouTube video title could not be extracted.",
      );
    }

    const description = video.description.trim();
    const channelTitle = video.channelTitle.trim();
    const thumbnail = selectBestYouTubeThumbnail(video.thumbnails);
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
          channelTitle,
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

const selectBestYouTubeThumbnail = (value: YouTubeThumbnail[]): YouTubeThumbnail | undefined =>
  [...value].sort((left, right) => thumbnailArea(right) - thumbnailArea(left))[0];

const thumbnailArea = (thumbnail: YouTubeThumbnail) =>
  Math.max(0, thumbnail.width ?? 0) * Math.max(0, thumbnail.height ?? 0);

const buildYouTubeMarkdownContent = ({
  title,
  channelTitle,
  description,
}: {
  title: string;
  channelTitle: string;
  description: string;
}) => {
  const lines = [`# ${title}`, "", "Source: YouTube"];
  if (channelTitle) lines.push(`Channel: ${channelTitle}`);
  if (description) lines.push("", "## Description", "", description);

  return lines.join("\n").trim();
};
