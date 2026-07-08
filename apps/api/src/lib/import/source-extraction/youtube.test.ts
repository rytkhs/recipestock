import { describe, expect, it, vi } from "vitest";
import { type RecipeImportError } from "../types";
import {
  createYouTubeCanonicalUrl,
  getYouTubeVideoId,
  youtubeSourceExtractionAdapter,
} from "./youtube";
import { YouTubeDataError } from "./youtube-data";

const VIDEO_ID = "FyLCRXMANAM";
const CANONICAL_URL = "https://www.youtube.com/watch?v=FyLCRXMANAM";

describe("YouTube source extraction URL handling", () => {
  it.each([
    "https://www.youtube.com/watch?v=FyLCRXMANAM",
    "https://www.youtube.com/watch?v=FyLCRXMANAM&list=PL123&feature=shared",
    "https://youtu.be/FyLCRXMANAM?si=vxf25wqv_kohdf4L",
    "https://www.youtube.com/shorts/FyLCRXMANAM",
    "https://m.youtube.com/watch?v=FyLCRXMANAM",
  ])("%s からvideoIdを抽出する", (url) => {
    expect(getYouTubeVideoId(url)).toBe(VIDEO_ID);
    expect(youtubeSourceExtractionAdapter.match({ normalizedUrl: url, host: "youtube.com" })).toBe(
      true,
    );
    expect(createYouTubeCanonicalUrl(getYouTubeVideoId(url) ?? "")).toBe(CANONICAL_URL);
  });

  it("対象外URLにはmatchしない", () => {
    expect(getYouTubeVideoId("https://www.youtube.com/playlist?list=PL123")).toBeNull();
    expect(getYouTubeVideoId("https://example.com/watch?v=FyLCRXMANAM")).toBeNull();
    expect(getYouTubeVideoId("https://www.youtube.com/watch?v=too-short")).toBeNull();
  });

  it("canonical URLを生成する", () => {
    expect(createYouTubeCanonicalUrl(VIDEO_ID)).toBe(CANONICAL_URL);
  });
});

describe("YouTube source extraction adapter", () => {
  it("YouTube Data API metadataからAI inputと最大サムネイルcover配置を作る", async () => {
    const fetchHtml = createFetchHtml();
    const youtubeDataClient = createYouTubeDataClient({
      title: "鶏むねキャベツ鍋",
      channelTitle: "Recipe Channel",
      description: "材料\nキャベツ 500g\n鶏むね肉 350g\n作り方\n煮る",
      thumbnails: [
        { url: "https://i.ytimg.com/vi/FyLCRXMANAM/default.jpg", width: 120, height: 90 },
        {
          url: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
          width: 1280,
          height: 720,
        },
      ],
    });
    const result = await youtubeSourceExtractionAdapter.extract({
      normalizedUrl: "https://youtu.be/FyLCRXMANAM?si=vxf25wqv_kohdf4L",
      host: "youtu.be",
      timeoutMs: 1000,
      fetchHtml,
      youtubeDataClient,
    });

    expect(fetchHtml).not.toHaveBeenCalled();
    expect(youtubeDataClient.getVideo).toHaveBeenCalledWith({ videoId: VIDEO_ID, timeoutMs: 1000 });
    expect(result).toEqual({
      promptProfile: "social",
      input: {
        source: {
          finalUrl: CANONICAL_URL,
          host: "youtube.com",
        },
        markdownContent: [
          "# 鶏むねキャベツ鍋",
          "",
          "Source: YouTube",
          "Channel: Recipe Channel",
          "",
          "## Description",
          "",
          "材料\nキャベツ 500g\n鶏むね肉 350g\n作り方\n煮る",
        ].join("\n"),
      },
      imageCandidates: [
        {
          id: "youtube_thumbnail",
          url: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
          alt: "鶏むねキャベツ鍋 thumbnail",
          position: 0,
        },
      ],
      imagePlacement: {
        coverImageUrl: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
        referenceImageUrls: [],
      },
      source: {
        sourceUrl: CANONICAL_URL,
        sourceName: "YouTube",
      },
      warnings: [],
    });
  });

  it("説明欄が空でもtitleとthumbnailで成功する", async () => {
    const fetchHtml = createFetchHtml();
    const result = await youtubeSourceExtractionAdapter.extract({
      normalizedUrl: CANONICAL_URL,
      host: "youtube.com",
      timeoutMs: 1000,
      fetchHtml,
      youtubeDataClient: createYouTubeDataClient({
        title: "説明欄なしShorts",
        channelTitle: "Recipe Channel",
        description: "",
        thumbnails: [
          { url: "https://i.ytimg.com/vi/FyLCRXMANAM/hqdefault.jpg", width: 480, height: 360 },
        ],
      }),
    });

    expect(fetchHtml).not.toHaveBeenCalled();
    expect(result.input.markdownContent).toBe(
      ["# 説明欄なしShorts", "", "Source: YouTube", "Channel: Recipe Channel"].join("\n"),
    );
    expect(result.input.markdownContent).not.toContain("## Description");
    expect(result.input.markdownContent).not.toContain("hqdefault.jpg");
    expect(result.imagePlacement).toEqual({
      coverImageUrl: "https://i.ytimg.com/vi/FyLCRXMANAM/hqdefault.jpg",
      referenceImageUrls: [],
    });
  });

  it("YouTube Data API client未設定はextraction_failedにする", async () => {
    const fetchHtml = createFetchHtml();
    await expect(
      youtubeSourceExtractionAdapter.extract({
        normalizedUrl: CANONICAL_URL,
        host: "youtube.com",
        timeoutMs: 1000,
        fetchHtml,
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);

    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it("動画metadataが見つからない場合はextraction_failedにする", async () => {
    await expect(
      youtubeSourceExtractionAdapter.extract({
        normalizedUrl: CANONICAL_URL,
        host: "youtube.com",
        timeoutMs: 1000,
        fetchHtml: createFetchHtml(),
        youtubeDataClient: {
          getVideo: vi.fn(async () => null),
        },
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("YouTube Data API errorはRecipeImportErrorへ変換する", async () => {
    await expect(
      youtubeSourceExtractionAdapter.extract({
        normalizedUrl: CANONICAL_URL,
        host: "youtube.com",
        timeoutMs: 1000,
        fetchHtml: createFetchHtml(),
        youtubeDataClient: {
          getVideo: vi.fn(async () => {
            throw new YouTubeDataError("quota_exceeded", "quota exceeded");
          }),
        },
      }),
    ).rejects.toMatchObject({
      name: "RecipeImportError",
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("videoId不一致はextraction_failedにする", async () => {
    await expect(
      youtubeSourceExtractionAdapter.extract({
        normalizedUrl: CANONICAL_URL,
        host: "youtube.com",
        timeoutMs: 1000,
        fetchHtml: createFetchHtml(),
        youtubeDataClient: createYouTubeDataClient({
          videoId: "LZ7gPKzDrzY",
          title: "別動画",
          description: "材料",
        }),
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });
});

const createFetchHtml = () =>
  vi.fn(async () => ({
    finalUrl: CANONICAL_URL,
    contentType: "text/html; charset=utf-8",
    body: "",
  }));

const createYouTubeDataClient = ({
  videoId = VIDEO_ID,
  title,
  description = "",
  channelTitle = "",
  thumbnails = [],
}: {
  videoId?: string;
  title: string;
  description?: string;
  channelTitle?: string;
  thumbnails?: Array<{ url: string; width?: number; height?: number }>;
}) => ({
  getVideo: vi.fn(async () => ({
    videoId,
    canonicalUrl: createYouTubeCanonicalUrl(videoId),
    title,
    description,
    channelTitle,
    thumbnails,
  })),
});
