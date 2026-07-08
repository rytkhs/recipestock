import { z } from "zod";

const YOUTUBE_DATA_API_URL = "https://www.googleapis.com/youtube/v3/videos";

const youtubeThumbnailSchema = z.strictObject({
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const youtubeDataVideoSchema = z.strictObject({
  id: z.string(),
  snippet: z.strictObject({
    title: z.string(),
    description: z.string().optional().default(""),
    channelTitle: z.string().optional().default(""),
    thumbnails: z.record(z.string(), youtubeThumbnailSchema).optional().default({}),
  }),
});

const youtubeDataResponseSchema = z.strictObject({
  items: z.array(youtubeDataVideoSchema),
});

export type YouTubeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

export type YouTubeVideoMetadata = {
  videoId: string;
  canonicalUrl: string;
  title: string;
  description: string;
  channelTitle: string;
  thumbnails: YouTubeThumbnail[];
};

export type YouTubeDataClient = {
  getVideo(input: { videoId: string; timeoutMs: number }): Promise<YouTubeVideoMetadata | null>;
};

export type YouTubeDataErrorCode =
  | "request_failed"
  | "quota_exceeded"
  | "timeout"
  | "invalid_response";

export class YouTubeDataError extends Error {
  readonly code: YouTubeDataErrorCode;

  constructor(code: YouTubeDataErrorCode, message: string) {
    super(message);
    this.name = "YouTubeDataError";
    this.code = code;
  }
}

export const createYouTubeDataClient = ({
  apiKey,
  fetcher = fetch,
}: {
  apiKey: string;
  fetcher?: typeof fetch;
}): YouTubeDataClient => ({
  async getVideo({ videoId, timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => {
        controller.abort();
      },
      Math.max(1, timeoutMs),
    );

    try {
      const response = await fetcher(createYouTubeDataApiUrl({ apiKey, videoId }), {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new YouTubeDataError(
          await classifyYouTubeDataError(response),
          "YouTube video metadata could not be fetched.",
        );
      }

      const payload = youtubeDataResponseSchema.safeParse(await readJsonResponse(response));
      if (!payload.success) {
        throw new YouTubeDataError("invalid_response", "YouTube Data API response was invalid.");
      }

      const video = payload.data.items[0];
      if (!video) return null;

      return {
        videoId: video.id,
        canonicalUrl: createYouTubeCanonicalUrl(video.id),
        title: video.snippet.title.trim(),
        description: video.snippet.description.trim(),
        channelTitle: video.snippet.channelTitle.trim(),
        thumbnails: Object.values(video.snippet.thumbnails),
      };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new YouTubeDataError("timeout", "YouTube Data API request timed out.");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  },
});

const createYouTubeDataApiUrl = ({ apiKey, videoId }: { apiKey: string; videoId: string }) => {
  const url = new URL(YOUTUBE_DATA_API_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", videoId);
  url.searchParams.set("fields", "items(id,snippet(title,description,channelTitle,thumbnails))");
  url.searchParams.set("key", apiKey);
  return url.toString();
};

const createYouTubeCanonicalUrl = (videoId: string) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

const readJsonResponse = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    throw new YouTubeDataError("invalid_response", "YouTube Data API response was invalid.");
  }
};

const classifyYouTubeDataError = async (response: Response): Promise<YouTubeDataErrorCode> => {
  if (response.status === 403) {
    try {
      const payload = await response.clone().json();
      if (hasQuotaExceededReason(payload)) return "quota_exceeded";
    } catch {}

    return "quota_exceeded";
  }

  return "request_failed";
};

const hasQuotaExceededReason = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const errors = (value as { error?: { errors?: unknown } }).error?.errors;
  if (!Array.isArray(errors)) return false;

  return errors.some((error) => {
    if (!error || typeof error !== "object") return false;
    const reason = (error as { reason?: unknown }).reason;
    return reason === "quotaExceeded" || reason === "dailyLimitExceeded";
  });
};

const isAbortError = (error: unknown) => error instanceof Error && error.name === "AbortError";
