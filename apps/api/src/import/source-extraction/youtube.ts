import { RecipeImportError } from "../types";
import {
  type SourceExtractionAdapter,
  type SourceExtractionContext,
  type SourceExtractionMatchInput,
} from "./types";
import { YouTubeDataError, type YouTubeThumbnail } from "./youtube-data";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PAGE_ID = "youtube_thumbnail";
const YOUTUBE_SOURCE_NAME = "YouTube";

export const youtubeSourceExtractionAdapter: SourceExtractionAdapter = {
  id: "youtube",
  sourceName: YOUTUBE_SOURCE_NAME,

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
      throw new RecipeImportError("unknown", "YouTube Data API client is not configured.");
    }

    // YouTube Data APIは、非公開の動画と削除された動画を返さない。
    const video = await getYouTubeVideoMetadata(context, videoId);
    if (!video) {
      throw new RecipeImportError(
        "private_or_login_required",
        "YouTube video is private or unavailable.",
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
        sourceName: YOUTUBE_SOURCE_NAME,
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

const getYouTubeVideoMetadata = async (context: SourceExtractionContext, videoId: string) => {
  try {
    return await context.youtubeDataClient?.getVideo({
      videoId,
      timeoutMs: context.timeoutMs,
    });
  } catch (error) {
    if (error instanceof YouTubeDataError) {
      throw toYouTubeDataImportError(error);
    }

    throw error;
  }
};

/**
 * 通信の失敗と割り当ての超過は、時間を置いて同じURLで試し直せば読める。
 * 応答を読めないのはこちらの不具合なので、利用者に直し方を示さない。
 */
const toYouTubeDataImportError = (error: YouTubeDataError) => {
  const message = `YouTube Data API failed: ${error.code}.`;

  if (error.code === "invalid_response") {
    return new RecipeImportError("unknown", message);
  }

  return new RecipeImportError("fetch_failed", message);
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
